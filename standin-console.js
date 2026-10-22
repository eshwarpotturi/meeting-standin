// Logging: every line has a timestamp. Pass done/total for anything that runs in steps.
(function () {
  const NS = (window.__standin = window.__standin || {});

  function isoLocal() {
    const d = new Date();
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
    const mm = String(Math.abs(off) % 60).padStart(2, '0');
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, -1) + sign + hh + ':' + mm;
  }

  NS.isoLocal = isoLocal;
  NS.logLines = [];
  NS.log = function (msg, done, total) {
    const prog = total != null ? ' [' + done + '/' + total + ']' : '';
    const line = isoLocal() + prog + ' [standin] ' + msg;
    NS.logLines.push(line);
    if (NS.logLines.length > 500) NS.logLines.shift();
    console.log(line);
  };
})();

// Settings. Saved in the page's local storage; the Meet tab only.
(function () {
  const NS = (window.__standin = window.__standin || {});
  const KEY = 'standin.config';

  const defaults = {
    enabled: true, // swap camera and mic. Reload the call to change.
    userName: 'Eswar',
    names: ['eswar', 'ishwar', 'eshwar', 'iswar', 'pothuri', 'poturi', 'sai'],
    threshold: 75, // answer only at or above this confidence (0-100)
    disclosure: true, // first reply says it is an AI stand-in
    brain: 'stub', // 'stub' (demo rules), 'claude' (extension + API key) or 'relay' (relay.ps1 on this laptop)
    relayUrl: 'http://127.0.0.1:8765',
    realVoice: true, // use the Windows voice through the relay when it is running
    override: true, // when it would hold a yes/no question, show Yes/No buttons in the panel for a few seconds
    overrideWaitMs: 20000,
    autoRelay: true, // if the relay is running, use it instead of the demo rules
    model: 'claude-sonnet-5-5',
    heldLine: 'I will confirm after the meeting.',
    captionDebounceMs: 1200,
    duplicateWindowMs: 15000,
    // Context pack: what Claude may use. Plain text for 'claude'; rules for 'stub'.
    contextPack: '',
    stubRules: [],
  };

  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch (e) {
    saved = {};
  }

  NS.config = Object.assign({}, defaults, saved);
  NS.saveConfig = function () {
    try {
      localStorage.setItem(KEY, JSON.stringify(NS.config));
    } catch (e) {
      /* storage can be blocked; the stand-in still works for this call */
    }
  };
})();

// Fake microphone. Meet receives a stream made here; nothing touches the real mic.
// Speech: dummy "babble" voice by default. Set NS.tts = async (text) => AudioBuffer to use a real voice.
(function () {
  const NS = (window.__standin = window.__standin || {});

  let ctx = null;
  let dest = null;
  let master = null;
  let analyser = null;
  let stream = null;
  let meterTimer = null;

  NS.speaking = false;
  NS.level = 0; // 0..1, drives the avatar's mouth
  NS.tts = null;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    dest = ctx.createMediaStreamDestination();
    master = ctx.createGain();
    master.gain.value = 1;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    master.connect(dest);
    master.connect(analyser);
    // A silent source keeps the stream alive between answers.
    const silent = ctx.createConstantSource();
    const g = ctx.createGain();
    g.gain.value = 0;
    silent.connect(g);
    g.connect(dest);
    silent.start();
    stream = dest.stream;
    const buf = new Uint8Array(analyser.fftSize);
    meterTimer = setInterval(function () {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      NS.level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
    }, 40);
    NS.log('fake microphone ready');
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') return ctx.resume();
    return Promise.resolve();
  }

  // Turn encoded audio (wav) into a buffer the call can play. Used by the real voice.
  NS.decodeAudio = function (arrayBuffer) {
    ensure();
    return ctx.decodeAudioData(arrayBuffer);
  };

  NS.audioStream = function () {
    ensure();
    resume();
    return stream;
  };

  // Dummy voice: syllable bursts through two band-pass filters. Not words; it shows timing and level.
  function babble(text) {
    const words = text.split(/\s+/).filter(Boolean);
    const vowels = [
      [700, 1200],
      [500, 1800],
      [350, 2200],
      [450, 900],
    ];
    let t = ctx.currentTime + 0.05;
    let count = 0;
    words.forEach(function (w) {
      const syl = Math.max(1, Math.round(w.length / 3));
      for (let s = 0; s < syl; s++) {
        const f = vowels[(count + s) % vowels.length];
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 110 + ((count * 7) % 25);
        const b1 = ctx.createBiquadFilter();
        b1.type = 'bandpass';
        b1.frequency.value = f[0];
        b1.Q.value = 4;
        const b2 = ctx.createBiquadFilter();
        b2.type = 'bandpass';
        b2.frequency.value = f[1];
        b2.Q.value = 4;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.9, t + 0.03);
        env.gain.linearRampToValueAtTime(0, t + 0.15);
        osc.connect(b1);
        osc.connect(b2);
        b1.connect(env);
        b2.connect(env);
        env.connect(master);
        osc.start(t);
        osc.stop(t + 0.17);
        t += 0.17;
        count++;
      }
      t += 0.07;
    });
    return t - ctx.currentTime;
  }

  // Speak a line into the call. Resolves when the line has finished.
  NS.speak = async function (text) {
    ensure();
    await resume();
    NS.speaking = true;
    let seconds;
    try {
      let buffer = null;
      if (typeof NS.tts === 'function') {
        try {
          buffer = await NS.tts(text);
        } catch (e) {
          NS.log('voice service failed, using dummy voice: ' + e.message);
        }
      }
      if (buffer) {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(master);
        src.start();
        seconds = buffer.duration;
      } else {
        seconds = babble(text);
      }
      await new Promise(function (r) {
        setTimeout(r, seconds * 1000 + 100);
      });
    } finally {
      NS.speaking = false;
    }
    return seconds;
  };
})();

// Fake camera. A canvas is drawn 30 times a second and sent to Meet as the camera.
// Dummy avatar (a simple drawn person). Poses: idle (always), nod, shake.
(function () {
  const NS = (window.__standin = window.__standin || {});
  const W = 1280;
  const H = 720;
  let POSE_MS = 1400;

  const COLORS = {
    bg: '#12303A',
    skin: '#F2C6A0',
    hair: '#3B2A20',
    shirt: '#2F6FED',
    mouth: '#8A2F2F',
    eye: '#1A1A1A',
    pill: '#FFD23F',
    pillText: '#1A1A1A',
  };

  const avatar = (NS.avatar = {
    pose: 'idle',
    poseStart: 0,
    subtitle: '',
    label: 'AI stand-in',
    w: W,
    h: H,
  });

  // Recorded clips. Optional: idle (loops), nod, shake, speak (loops while talking). Missing ones fall back to the drawn head.
  const clips = {};
  avatar.clips = clips;
  avatar.loadClip = function (name, file) {
    return new Promise(function (resolve, reject) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.loop = name === 'idle' || name === 'speak';
      v.preload = 'auto';
      v.src = typeof file === 'string' ? file : URL.createObjectURL(file);
      v.onloadeddata = function () {
        clips[name] = v;
        if (name === 'idle' || name === 'speak') v.play().catch(function () {});
        NS.log('clip loaded: ' + name + ' (' + Math.round(v.duration * 10) / 10 + ' s)');
        resolve(v);
      };
      v.onerror = function () {
        NS.log('clip failed: ' + name);
        reject(new Error('could not read ' + name));
      };
    });
  };
  avatar.clearClips = function () {
    Object.keys(clips).forEach(function (k) {
      try { clips[k].pause(); } catch (e) { /* ignore */ }
      delete clips[k];
    });
  };
  let activeClip = null;
  function clipFrame() {
    // Choose the clip for the moment: pose clip, then speak clip, then idle.
    let name = null;
    if (avatar.pose !== 'idle' && clips[avatar.pose]) name = avatar.pose;
    else if (NS.speaking && clips.speak) name = 'speak';
    else if (clips.idle) name = 'idle';
    if (!name) return null;
    const v = clips[name];
    if (activeClip !== name) {
      activeClip = name;
      if (name === 'nod' || name === 'shake') v.currentTime = 0;
      v.play().catch(function () {});
    }
    return v;
  }

  let canvas = null;
  let ctx = null;
  let stream = null;
  let timer = null;

  avatar.setPose = function (pose) {
    avatar.pose = pose;
    avatar.poseStart = performance.now();
    POSE_MS = clips[pose] && clips[pose].duration ? Math.max(1400, clips[pose].duration * 1000) : 1400;
    NS.log('pose: ' + pose);
  };
  avatar.setSubtitle = function (text) {
    avatar.subtitle = text || '';
  };

  function wrap(text, maxChars) {
    const words = text.split(/\s+/);
    const lines = [];
    let cur = '';
    words.forEach(function (w) {
      if ((cur + ' ' + w).trim().length > maxChars) {
        lines.push(cur);
        cur = w;
      } else {
        cur = (cur + ' ' + w).trim();
      }
    });
    if (cur) lines.push(cur);
    return lines.slice(-3);
  }

  function draw(now) {
    const t = now / 1000;
    let dx = Math.sin(t * 0.8) * 4;
    let dy = Math.sin(t * 1.3) * 5; // breathing
    let p = 0;
    if (avatar.pose !== 'idle') {
      p = (now - avatar.poseStart) / POSE_MS;
      if (p >= 1) {
        avatar.pose = 'idle';
        p = 0;
      } else if (avatar.pose === 'nod') {
        dy += Math.sin(p * Math.PI * 4) * H * 0.035 * (1 - 0.4 * p);
      } else if (avatar.pose === 'shake') {
        dx += Math.sin(p * Math.PI * 4) * W * 0.03 * (1 - 0.4 * p);
      }
    }

    const clip = clipFrame();
    if (clip && clip.videoWidth) {
      // Recorded clip, scaled to fit the frame
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const k = Math.min(W / clip.videoWidth, H / clip.videoHeight);
      const w = clip.videoWidth * k;
      const h = clip.videoHeight * k;
      ctx.drawImage(clip, (W - w) / 2, (H - h) / 2, w, h);
    } else {
      // Background and shoulders
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = COLORS.shirt;
      ctx.beginPath();
      ctx.ellipse(W / 2 + dx * 0.3, H + 40, 330, 210, 0, 0, Math.PI * 2);
      ctx.fill();

      // Head
      const cx = W / 2 + dx;
      const cy = H * 0.4 + dy;
      const r = H * 0.2;
      ctx.fillStyle = COLORS.skin;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      // Hair cap
      ctx.fillStyle = COLORS.hair;
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.25, r * 1.02, Math.PI * 1.02, Math.PI * 1.98);
      ctx.fill();

      // Eyes, with a blink every few seconds
      const blink = Math.floor(t) % 4 === 0 && t % 1 < 0.12;
      ctx.fillStyle = COLORS.eye;
      const eyeH = blink ? 2 : r * 0.12;
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.38, cy - r * 0.05, r * 0.09, eyeH, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + r * 0.38, cy - r * 0.05, r * 0.09, eyeH, 0, 0, Math.PI * 2);
      ctx.fill();

      // Mouth follows the voice level
      const open = NS.speaking ? Math.min(1, NS.level * 1.5 + 0.15) : 0;
      ctx.fillStyle = COLORS.mouth;
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.5, r * 0.22, 3 + open * r * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();


    }

    // Label: always on, so nobody mistakes this for the real person.
    ctx.font = '600 34px system-ui, sans-serif';
    const lw = ctx.measureText(avatar.label).width + 40;
    ctx.fillStyle = COLORS.pill;
    ctx.beginPath();
    ctx.roundRect(24, H - 76, lw, 52, 26);
    ctx.fill();
    ctx.fillStyle = COLORS.pillText;
    ctx.textBaseline = 'middle';
    ctx.fillText(avatar.label, 44, H - 50);

    // Subtitle: what the stand-in is saying
    if (avatar.subtitle) {
      const lines = wrap(avatar.subtitle, 48);
      ctx.font = '500 34px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const boxH = lines.length * 44 + 20;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(W * 0.12, H - 100 - boxH, W * 0.76, boxH);
      ctx.fillStyle = '#FFFFFF';
      lines.forEach(function (ln, i) {
        ctx.fillText(ln, W / 2, H - 100 - boxH + 32 + i * 44);
      });
      ctx.textAlign = 'left';
    }
  }

  function ensure() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');
    draw(performance.now());
    stream = canvas.captureStream(30);
    timer = setInterval(function () {
      draw(performance.now());
    }, 33);
    NS.log('fake camera ready (' + W + 'x' + H + ')');
  }

  NS.videoStream = function () {
    ensure();
    return stream;
  };
  NS.stopAvatar = function () {
    if (timer) clearInterval(timer);
    timer = null;
  };
})();

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

// Reads Meet's live captions from the page. Captions must be switched on in Meet.
// NOTE: Meet's page layout can change without warning. This looks for any region labelled "captions".
(function () {
  const NS = (window.__standin = window.__standin || {});
  let last = '';
  let timer = null;
  let observer = null;

  function region() {
    return document.querySelector('[aria-label*="aption" i]');
  }

  function scan() {
    const el = region();
    if (!el) return;
    const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!text || text === last) return;
    last = text;
    clearTimeout(timer);
    // Wait for the speaker to finish before treating it as a question.
    timer = setTimeout(function () {
      NS.log('caption: ' + text.slice(-120));
      NS.handleUtterance(text, text).catch(function (e) {
        NS.log('caption handling failed: ' + e.message);
      });
    }, NS.config.captionDebounceMs);
  }

  NS.captions = {
    start: function () {
      if (observer) return;
      observer = new MutationObserver(scan);
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      NS.log('listening to captions');
    },
    stop: function () {
      if (observer) observer.disconnect();
      observer = null;
      clearTimeout(timer);
    },
  };
})();

// Replace the camera and microphone before Meet asks for them.
(function () {
  const NS = (window.__standin = window.__standin || {});
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  NS.callsIntercepted = 0;

  navigator.mediaDevices.getUserMedia = async function (constraints) {
    const wantsVideo = !!(constraints && constraints.video);
    const wantsAudio = !!(constraints && constraints.audio);
    if (!NS.config.enabled || (!wantsVideo && !wantsAudio)) {
      NS.log('passing camera and mic request to the real devices');
      return real(constraints);
    }
    NS.callsIntercepted++;
    const tracks = [];
    // Clones, so that turning the camera off in Meet does not kill the shared source.
    if (wantsVideo) NS.videoStream().getVideoTracks().forEach(function (t) { tracks.push(t.clone()); });
    if (wantsAudio) NS.audioStream().getAudioTracks().forEach(function (t) { tracks.push(t.clone()); });
    NS.log('gave Meet the stand-in camera/mic (video=' + wantsVideo + ', audio=' + wantsAudio + ')');
    return new MediaStream(tracks);
  };
})();

// Small control panel, bottom-left of the Meet page. Plain words.
// Built with DOM calls only: Meet blocks innerHTML (Trusted Types).
(function () {
  const NS = (window.__standin = window.__standin || {});

  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }

  const CSS =
    '.box{font:14px/1.35 system-ui,sans-serif;background:#fff;color:#14181f;border:1px solid #d9dee6;border-radius:12px;padding:12px;width:300px;box-shadow:0 4px 16px rgba(0,0,0,.2)}' +
    '.row{display:flex;gap:8px;align-items:center;margin-top:8px}' +
    'h3{margin:0;font-size:16px}.muted{color:#5a6472;font-size:12px}' +
    'input[type=text],input[type=password]{flex:1;min-width:0;padding:6px;border:1px solid #d9dee6;border-radius:6px;font-size:14px}' +
    'button{padding:6px 10px;border:1px solid #1f5fd1;background:#1f5fd1;color:#fff;border-radius:6px;font-size:14px;cursor:pointer}' +
    '.ans{font-weight:700}.held{color:#a35a00}.ok{color:#12794a}';

  function build() {
    if (document.getElementById('standin-panel')) return;
    const host = el('div', { id: 'standin-panel', style: 'position:fixed;left:12px;bottom:12px;z-index:2147483647;' });
    const root = host.attachShadow({ mode: 'open' });

    const state = el('div', { class: 'muted' });
    const thr = el('input', { type: 'range', min: '50', max: '95', step: '1', 'aria-label': 'Answer at confidence' });
    const thrv = el('span');
    const q = el('input', { type: 'text', placeholder: 'Test question for you', 'aria-label': 'Test question' });
    const ask = el('button', { text: 'Ask' });
    const key = el('input', { type: 'password', placeholder: 'Claude API key', 'aria-label': 'Claude API key' });
    const save = el('button', { text: 'Save' });
    const relayBtn = el('button', { text: 'Connect relay' });
    const clipRow = el('div', { class: 'row', style: 'flex-wrap:wrap' });
    ['idle', 'nod', 'shake', 'speak'].forEach(function (name) {
      const inp = el('input', { type: 'file', accept: 'video/*', style: 'display:none' });
      const b = el('button', { text: name });
      b.addEventListener('click', function () { inp.click(); });
      inp.addEventListener('change', function () {
        if (!inp.files[0]) return;
        NS.avatar.loadClip(name, inp.files[0]).then(function () {
          b.textContent = name + ' ✓';
        }).catch(function () {
          b.textContent = name + ' ✗';
        });
      });
      clipRow.appendChild(b);
      clipRow.appendChild(inp);
    });
    const last = el('div', { style: 'margin-top:8px' });
    const ovText = el('div', { class: 'ans held' });
    const ovYes = el('button', { text: 'Yes' });
    const ovNo = el('button', { text: 'No' });
    const ov = el('div', { style: 'display:none;margin-top:8px;padding:8px;border:2px solid #a35a00;border-radius:8px' }, [
      ovText,
      el('div', { class: 'row' }, [ovYes, ovNo]),
    ]);

    const box = el('div', { class: 'box' }, [
      el('h3', { text: 'AI stand-in' }),
      state,
      el('div', { class: 'row' }, [el('span', { text: 'Answer at' }), thr, thrv]),
      el('div', { class: 'row' }, [q, ask]),
      el('div', { class: 'row' }, [key, save]),
      el('div', { class: 'row' }, [relayBtn, el('span', { class: 'muted', text: 'Opens the relay window (live brain)' })]),
      el('div', { class: 'muted', text: 'Your recorded clips (optional):' }),
      clipRow,
      ov,
      last,
    ]);
    root.appendChild(el('style', { text: CSS }));
    root.appendChild(box);
    document.documentElement.appendChild(host);

    state.textContent = NS.config.enabled
      ? 'Standing in. Your camera and mic are replaced. Reload the call to change.'
      : 'Off. Your real camera and mic are used.';
    thr.value = NS.config.threshold;
    thrv.textContent = NS.config.threshold + '%';
    thr.addEventListener('input', function () {
      NS.config.threshold = Number(thr.value);
      thrv.textContent = NS.config.threshold + '%';
      NS.saveConfig();
    });
    ask.addEventListener('click', function () {
      const v = q.value.trim();
      if (!v) return;
      NS.ask(v, '').then(function (r) {
        if (!r.handled) last.textContent = 'Ignored (' + r.reason + '). Start with your name, for example: "' + NS.config.userName + ', should we go ahead?"';
      });
    });
    relayBtn.addEventListener('click', function () {
      last.textContent = NS.openBridge(true) ? 'Relay window opened. Leave it open.' : 'Pop-up blocked. Allow pop-ups for Meet and press again.';
    });
    save.addEventListener('click', function () {
      window.postMessage({ source: 'standin', type: 'save-key', key: key.value }, '*');
      key.value = '';
      last.textContent = 'Key sent to the extension. It is not stored on the page.';
    });
    ovYes.addEventListener('click', function () { NS.override('yes'); });
    ovNo.addEventListener('click', function () { NS.override('no'); });
    NS.events.addEventListener('override-request', function (ev) {
      ovText.textContent = 'Asked: ' + ev.detail.question;
      ov.style.display = 'block';
    });
    NS.events.addEventListener('override-done', function () { ov.style.display = 'none'; });
    NS.events.addEventListener('decision', function (ev) {
      const r = ev.detail;
      const cls = r.action === 'held' ? 'held' : 'ok';
      const label = r.action === 'held' ? 'Held for you' : r.decision.answer.toUpperCase();
      last.replaceChildren(
        el('div', { class: 'ans ' + cls, text: label + ' · ' + r.decision.confidence + '%' }),
        el('div', { text: r.question }),
        el('div', { class: 'muted', text: r.decision.reason })
      );
    });
  }

  NS.buildPanel = function () {
    try {
      if (document.body) build();
      else document.addEventListener('DOMContentLoaded', build, { once: true });
    } catch (e) {
      NS.log('panel failed, stand-in still works: ' + e.message);
    }
  };
})();

(function () {
  const NS = (window.__standin = window.__standin || {});
  NS.status = function () {
    return {
      enabled: NS.config.enabled,
      aiLabel: !!NS.avatar.label,
      pose: NS.avatar.pose,
      speaking: NS.speaking,
      intercepted: NS.callsIntercepted,
      threshold: NS.config.threshold,
    };
  };
  NS.log('loaded (enabled=' + NS.config.enabled + ', brain=' + NS.config.brain + ')');
  NS.buildPanel();
  if (NS.config.autoRelay) NS.openBridge();
  NS.captions.start();
})();


// Demo rules: used only when the relay is not running. Replace with your own.
(function () {
  const NS = window.__standin;
  if (!NS.config.stubRules || !NS.config.stubRules.length) {
    NS.config.stubRules = [
      { when: 'go ahead|proceed|ship', answer: 'yes', confidence: 90, reason: 'The plan is signed off.' },
      { when: 'refund|delete|cancel', answer: 'no', confidence: 85, reason: 'That needs approval first.' },
    ];
  }
  NS.log('paste-in version ready. Join the call; if your camera is already on, turn it off and on once.');
})();
