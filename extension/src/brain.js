// The brain: spot a question meant for the user, decide, apply the confidence gate, then act.
(function () {
  const NS = (window.__standin = window.__standin || {});
  const AUX = '(do|does|did|is|are|was|were|am|can|could|will|would|should|shall|have|has|had|may|might|must)';
  const SUBJ = '(we|you|i|it|this|that|the|they|there|he|she|everyone|anyone|all|a|an|my|our|your|these|those)';
  const AUX_RE = new RegExp('^' + AUX + '\\s+' + SUBJ + '\\b');
  const DET_RE = new RegExp('^' + AUX + '\\s+(the|a|an|my|our|your|these|those|everyone|anyone|all|there)\\b');
  const WH_RE = /^(what|how|why|when|where|who|which|whom|whose)\b/;
  const OPEN_PHRASES = /(walk us through|walk me through|explain|tell us|tell me|describe|your thoughts|what do you think|how do you see|give us an update|any update)/;
  const YN_PHRASES = /(sound good|good to go|okay with|ok with|fine with|do you agree|are you ready|ready to go|make sense|works? for you)/;
  const FILLERS = new Set(['so', 'okay', 'ok', 'well', 'now', 'right', 'hey', 'hi', 'quick', 'also', 'next', 'and', 'but', 'then', 'thanks', 'thank']);

  function editDistance(a, b) {
    const m = a.length;
    const n = b.length;
    const d = [];
    for (let i = 0; i <= m; i++) d[i] = [i];
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[m][n];
  }

  function isName(word) {
    const w = word.toLowerCase();
    return NS.config.names.some(function (n) {
      if (w === n) return true;
      return w.length >= 5 && n.length >= 5 && editDistance(w, n) <= 1;
    });
  }

  function sentencesOf(text) {
    const parts = text.match(/[^.?!]+[.?!]*/g) || [];
    return parts.map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function hasName(s) {
    return (s.match(/[A-Za-z]+/g) || []).some(isName);
  }

  function otherVocative(s) {
    const m = s.match(/^\s*([A-Z][a-z]+),/);
    return !!m && !FILLERS.has(m[1].toLowerCase()) && !isName(m[1]);
  }

  // Returns 'yesno', 'open' or 'none' for one sentence that contains the user's name.
  function classify(sentence) {
    const raw = sentence.toLowerCase();
    const core = raw.replace(/[a-z]+/g, function (w) { return isName(w) ? '' : w; });
    const clauses = core
      .split(/[,;:—-]/)
      .map(function (c) { return c.replace(/[?!.]/g, '').trim(); })
      .filter(Boolean);
    const endsQ = /\?\s*$/.test(sentence.trim());
    // "Did Eswar send it?" asks about him, not to him.
    if (new RegExp('(^|[,;:\\u2014-]\\s*)' + AUX + '\\s+(' + NS.config.names.join('|') + ')\\b', 'i').test(raw)) return 'none';
    if (OPEN_PHRASES.test(core)) return 'open';
    if (clauses.some(function (c) { return WH_RE.test(c); })) return 'open';
    if (
      YN_PHRASES.test(core) ||
      clauses.some(function (c) {
        if (!AUX_RE.test(c)) return false;
        // "has the latest numbers" is a statement unless it ends with a question mark.
        return endsQ || !DET_RE.test(c);
      })
    ) return 'yesno';
    return endsQ ? 'open' : 'none';
  }

  function wordCount(s) {
    return (s.match(/[A-Za-z]+/g) || []).length;
  }

  // text -> { addressed, kind, question }
  function detect(text) {
    const none = { addressed: false, kind: 'none', question: '' };
    const sents = sentencesOf(text || '');
    for (let i = 0; i < sents.length; i++) {
      const s = sents[i];
      if (!hasName(s) || otherVocative(s)) continue;
      let kind = classify(s);
      let q = s;
      const nameOnly = (s.match(/[A-Za-z]+/g) || []).filter(function (w) { return !isName(w); }).length === 0;
      if (nameOnly || (kind === 'none' && wordCount(s) <= 3)) {
        // The name alone ("Eswar?"): the question is the sentence before or after it.
        const prev = sents[i - 1];
        const next = sents[i + 1];
        if (prev && !otherVocative(prev) && classify(prev) !== 'none') {
          kind = classify(prev);
          q = prev;
        } else if (next && !otherVocative(next) && classify(next) !== 'none') {
          kind = classify(next);
          q = next;
        }
      }
      if (kind !== 'none') return { addressed: true, kind: kind, question: q };
    }
    return none;
  }

  // ---- Deciding ----

  function parseDecision(text) {
    const bad = { answer: 'unsure', confidence: 0, reason: 'I could not read the answer.' };
    if (!text) return bad;
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) return bad;
    try {
      const o = JSON.parse(m[0]);
      const answer = String(o.answer || '').toLowerCase();
      if (answer !== 'yes' && answer !== 'no' && answer !== 'unsure') return bad;
      let conf = Number(o.confidence);
      if (!isFinite(conf)) return bad;
      conf = Math.max(0, Math.min(100, Math.round(conf)));
      const reason = String(o.reason || '').trim().slice(0, 200);
      return { answer: answer, confidence: answer === 'unsure' ? Math.min(conf, 50) : conf, reason: reason || 'No reason given.' };
    } catch (e) {
      return bad;
    }
  }

  function stubDecide(q) {
    const rules = NS.config.stubRules || [];
    for (let i = 0; i < rules.length; i++) {
      if (new RegExp(rules[i].when, 'i').test(q)) {
        return { answer: rules[i].answer, confidence: rules[i].confidence, reason: rules[i].reason };
      }
    }
    return { answer: 'unsure', confidence: 40, reason: 'None of my notes cover this.' };
  }

  function buildPrompt(q, recent) {
    const name = NS.config.userName;
    const system =
      'You are the decision brain of a labelled AI stand-in that attends a meeting for ' + name + '. ' +
      'You answer only yes/no questions put to ' + name + '. Use only the context pack below. ' +
      'If the context pack does not clearly settle the question, answer "unsure" with low confidence. ' +
      'Confidence is how sure you are that ' + name + ' himself would give this answer. ' +
      'Reply with JSON only: {"answer":"yes"|"no"|"unsure","confidence":0-100,"reason":"one plain sentence, first person, at most 25 words"}.';
    const user =
      'Context pack:\n' + (NS.config.contextPack || '(empty)') +
      '\n\nRecent meeting lines:\n' + (recent || '(none)') +
      '\n\nQuestion for ' + name + ': ' + q;
    return { model: NS.config.model, max_tokens: 200, system: system, messages: [{ role: 'user', content: user }] };
  }

  // Page -> extension bridge -> background -> Anthropic API. The key never enters the Meet page.
  let nextId = 1;
  NS.llm = function (body) {
    return new Promise(function (resolve, reject) {
      const id = nextId++;
      const timer = setTimeout(function () {
        window.removeEventListener('message', onMsg);
        reject(new Error('timed out'));
      }, 20000);
      function onMsg(ev) {
        const d = ev.data;
        if (!d || d.source !== 'standin-bridge' || d.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        if (d.ok) resolve(d.text);
        else reject(new Error(d.error || 'failed'));
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'standin', type: 'llm', id: id, body: body }, '*');
    });
  };

  // Relay: a small program on this laptop (relay.ps1) that holds the key and calls the model.
  // Chrome stops Meet from calling this laptop directly (local-network permission). So we open a small
  // relay window from the relay itself and pass messages to it. No direct call, no permission needed.
  const bridge = { win: null, pending: {}, nextId: 1, listening: false };
  function relayOrigin() {
    try {
      return new URL(NS.config.relayUrl).origin;
    } catch (e) {
      return '';
    }
  }
  function onBridgeMessage(ev) {
    if (ev.origin !== relayOrigin()) return;
    const d = ev.data;
    if (!d || d.source !== 'standin-bridge-res') return;
    const p = bridge.pending[d.id];
    if (!p) return;
    delete bridge.pending[d.id];
    clearTimeout(p.timer);
    if (d.ok) p.resolve(d);
    else p.reject(new Error(d.error || 'relay error'));
  }
  NS.openBridge = function (reload) {
    if (!bridge.listening) {
      window.addEventListener('message', onBridgeMessage);
      bridge.listening = true;
    }
    if (bridge.win && !bridge.win.closed) {
      if (reload) {
        try { bridge.win.location.href = NS.config.relayUrl + '/bridge'; } catch (e) { /* ignore */ }
        lastRelayCheck = 0;
        relayUp = false;
      }
      return true;
    }
    bridge.win = window.open(NS.config.relayUrl + '/bridge', 'standin-relay', 'popup,width=420,height=260');
    if (!bridge.win) {
      NS.log('relay window blocked: allow pop-ups for Meet, then press Connect relay in the panel');
      return false;
    }
    NS.log('relay window opened');
    return true;
  };
  function bridgeSend(kind, body, ms) {
    return new Promise(function (resolve, reject) {
      if (!bridge.win || bridge.win.closed) return reject(new Error('relay window is not open'));
      const id = bridge.nextId++;
      const timer = setTimeout(function () {
        delete bridge.pending[id];
        reject(new Error('relay did not answer'));
      }, ms);
      bridge.pending[id] = { resolve: resolve, reject: reject, timer: timer };
      try {
        bridge.win.postMessage({ source: 'standin-bridge-req', id: id, kind: kind, body: body }, relayOrigin());
      } catch (e) {
        clearTimeout(timer);
        delete bridge.pending[id];
        reject(e);
      }
    });
  }
  let lastRelayCheck = 0;
  let relayUp = false;
  async function checkRelay() {
    // While the relay is up, no checks. While it is down, at most one check every 15 seconds.
    if (relayUp && bridge.win && !bridge.win.closed) return true;
    if (Date.now() - lastRelayCheck < 15000) return false;
    lastRelayCheck = Date.now();
    try {
      await bridgeSend('ping', null, 3000);
      relayUp = true;
    } catch (e) {
      relayUp = false;
    }
    NS.log(relayUp ? 'relay found: live brain on' : 'relay not found: using demo answers');
    return relayUp;
  }
  async function relayDecide(q, recent) {
    const d = await bridgeSend('decide', { question: q, recent: recent || '', userName: NS.config.userName }, 12000);
    return parseDecision(JSON.stringify(d.json));
  }

  // Real voice: the relay turns the line into speech with the Windows voice. If the relay is down, the dummy voice is used.
  NS.tts = async function (text) {
    if (!NS.config.realVoice || !relayUp || !bridge.win || bridge.win.closed) return null;
    const d = await bridgeSend('tts', { text: text }, 8000);
    const bin = atob(d.json.wav);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return NS.decodeAudio(bytes.buffer);
  };

  async function decide(q, recent) {
    const cfg = NS.config;
    let useRelay = cfg.brain === 'relay';
    if (!useRelay && cfg.brain === 'stub' && cfg.autoRelay) useRelay = await checkRelay();
    if (useRelay) {
      try {
        return await relayDecide(q, recent);
      } catch (e) {
        NS.log('relay failed: ' + e.message);
        return { answer: 'unsure', confidence: 0, reason: 'My notes were not reachable.' };
      }
    }
    if (cfg.brain === 'claude') {
      try {
        const text = await NS.llm(buildPrompt(q, recent));
        return parseDecision(text);
      } catch (e) {
        NS.log('brain failed: ' + e.message);
        return { answer: 'unsure', confidence: 0, reason: 'My notes were not reachable.' };
      }
    }
    return stubDecide(q);
  }

  // ---- Acting ----

  const events = (NS.events = new EventTarget());
  NS.history = [];
  const recentQuestions = [];
  let busy = false;
  let disclosed = false;

  function emit(type, detail) {
    events.dispatchEvent(new CustomEvent(type, { detail: detail }));
  }

  async function say(text) {
    NS.avatar.setSubtitle(text);
    const p = NS.speak(text);
    NS.lastSpeech = p;
    try {
      await p;
    } finally {
      NS.avatar.setSubtitle('');
    }
  }

  // Handle one utterance. Resolves when the decision is made and the stand-in has started to act.
  NS.handleUtterance = async function (text, recent) {
    const t0 = performance.now();
    const d = detect(text);
    if (!d.addressed) return { handled: false, reason: 'not for me' };

    const now = Date.now();
    const key = d.question.toLowerCase().replace(/[^a-z ]/g, '').trim();
    while (recentQuestions.length && now - recentQuestions[0].at > NS.config.duplicateWindowMs) recentQuestions.shift();
    if (recentQuestions.some(function (r) { return r.key === key; })) return { handled: false, reason: 'duplicate' };
    if (busy) return { handled: false, reason: 'busy' };
    recentQuestions.push({ key: key, at: now });
    busy = true;
    let keepBusy = false;
    try {
      NS.log('question for me (' + d.kind + '): ' + d.question);
      emit('question', { question: d.question, kind: d.kind });
      let decision;
      if (d.kind === 'open') {
        decision = { answer: 'unsure', confidence: 0, reason: 'This is an open question.' };
      } else {
        decision = await decide(d.question, recent || '');
      }
      const tDecided = performance.now();
      const yes = decision.answer === 'yes' || decision.answer === 'no';
      const answers = yes && decision.confidence >= NS.config.threshold;
      const result = {
        handled: true,
        question: d.question,
        kind: d.kind,
        decision: decision,
        action: answers ? (decision.answer === 'yes' ? 'nod' : 'shake') : 'held',
        decidedMs: Math.round(tDecided - t0),
        at: NS.isoLocal(),
      };
      let line;
      if (answers) {
        NS.avatar.setPose(decision.answer === 'yes' ? 'nod' : 'shake');
        line = (decision.answer === 'yes' ? 'Yes. ' : 'No. ') + decision.reason;
      } else {
        const askYou = NS.config.override && d.kind !== 'open';
        line = askYou ? 'Let me check with ' + NS.config.userName + '.' : NS.config.heldLine;
        if (askYou) result.override = 'asked';
        emit('held', result);
      }
      if (NS.config.disclosure && !disclosed) {
        disclosed = true;
        line = 'I am an AI stand-in for ' + NS.config.userName + '. ' + line;
        result.disclosed = true;
      }
      result.line = line;
      result.actedMs = Math.round(performance.now() - t0);
      NS.history.unshift(result);
      NS.log(
        'decision ' + decision.answer + ' ' + decision.confidence + '% -> ' + result.action + ' in ' + result.actedMs + ' ms'
      );
      emit('decision', result);
      say(line).catch(function (e) {
        NS.log('speech failed: ' + e.message);
      });
      if (result.override === 'asked') {
        keepBusy = true;
        NS.lastOverride = overrideFollowUp(result);
      }
      return result;
    } finally {
      if (!keepBusy) busy = false;
    }
  };

  // Manual override. The panel shows Yes / No for a few seconds; you click one.
  // No click in time: the stand-in says the usual "I will confirm after the meeting." Nothing leaves this laptop.
  let pendingOverride = null;
  NS.override = function (answer) {
    if (!pendingOverride) return false;
    pendingOverride(answer);
    return true;
  };
  async function overrideFollowUp(result) {
    let answer = 'none';
    try {
      await NS.lastSpeech;
      emit('override-request', { question: result.question, waitMs: NS.config.overrideWaitMs });
      answer = await new Promise(function (resolve) {
        const timer = setTimeout(function () { resolve('none'); }, NS.config.overrideWaitMs);
        pendingOverride = function (a) { clearTimeout(timer); resolve(a); };
      });
    } catch (e) {
      NS.log('override failed: ' + e.message);
    }
    pendingOverride = null;
    emit('override-done', {});
    try {
      if (answer === 'yes' || answer === 'no') {
        NS.log('override: ' + answer);
        NS.avatar.setPose(answer === 'yes' ? 'nod' : 'shake');
        result.override = answer;
        result.action = answer === 'yes' ? 'nod' : 'shake';
        result.decision = { answer: answer, confidence: 100, reason: NS.config.userName + ' answered himself.' };
        emit('decision', result);
        await say((answer === 'yes' ? 'Yes. ' : 'No. ') + NS.config.userName + ' has confirmed.');
      } else {
        result.override = 'no reply';
        NS.log('override: no answer in time');
        await say(NS.config.heldLine);
      }
    } catch (e) {
      NS.log('speech failed: ' + e.message);
    } finally {
      busy = false;
    }
    return answer;
  }

  NS.ask = NS.handleUtterance; // for typed test questions and tests
  NS.brain = { detect: detect, parseDecision: parseDecision, buildPrompt: buildPrompt };
})();
