// Research and get back: someone says "stand-in, research <topic> and get back to me" (or "Eswar, look into ...").
// Anyone in the meeting can ask. The stand-in answers in the Meet chat only (no camera change, no voice):
//   1 an immediate one-line acknowledgement,
//   2 it finds a Wikipedia page (through the relay's allowlist),
//   3 the model writes up to 4 sentences, each with the exact words from the page that support it,
//   4 a sentence is kept only if its quote is really in the page. Anything else is dropped,
//   5 one labelled chat message with the kept sentences and the source link. If nothing survives, it says it found nothing reliable.
(function () {
  const NS = (window.__standin = window.__standin || {});
  const seen = {};
  let running = false;

  function triggerRe() {
    return new RegExp('\\b(?:' + DC().aliases() + ')\\b[?,:.\\s-]*(?:can you |could you |please )*(?:do some research (?:on|about|into)|research|look into|look up|find out (?:about|more about)?|dig into)\\b[\\s,]*(?:(?:on|about|for|into|the|something|some)\\b[\\s,]*)*([^.?!\\n]{4,160})', 'i');
  }
  // Also "research <topic> and get back to me" with no name at all (the captions often drop the name).
  function bareRe() {
    return /(?:^|[.?!]\s+)(?:(?:can|could) you |please )*(?:do some research (?:on|about|into)|research|look into|look up|dig into)\s+((?:on |about |for |into |the |something |some )*[^.?!\n]{4,160}?)\s*(?:,?\s*(?:and|then)\s+)?(?:get|come) back to (?:me|us)\b/i;
  }
  function detect(text) {
    const t = String(text || '');
    const m = t.match(triggerRe()) || t.match(bareRe());
    if (!m) return '';
    return DC().cut(m[1].replace(/\b(?:and|then)?\s*(?:get|come) back to (?:me|us)\b.*$/i, '').replace(/\b(?:and|then)\s*(?:let|tell) (?:me|us) know\b.*$/i, ''), 160).replace(/[,;:\s]+$/, '').replace(/\s+please$/i, '');
  }
  function DC() { return NS.dataChart; }
  function step(n, t) { NS.log('research [' + n + '/5]: ' + t); }

  function prompt(topic, pageText) {
    return {
      system:
        'Write a short factual answer to the request using ONLY the page text. Up to 4 sentences. Do not add anything from memory. ' +
        'Every sentence must come with a quote: the exact words copied from the page text that support it. ' +
        'Reply with JSON only: {"sentences":[{"text":"<one sentence>","quote":"<exact words from the page, at least 6 characters>"}]}. ' +
        'If the page does not answer the request, reply {"sentences":[]}.',
      user: 'Request: ' + topic + '\n\nPage text:\n' + pageText.slice(0, 12000),
    };
  }
  // Keep only sentences whose quote is word for word in the page. Returns the kept sentences.
  function checkAnswer(o, pageText) {
    if (!o || !Array.isArray(o.sentences)) return [];
    const hay = DC().norm(pageText);
    const out = [];
    o.sentences.slice(0, 4).forEach(function (s) {
      const q = DC().norm(s && s.quote), t = DC().cut(s && s.text, 300);
      if (t && q.length >= 6 && hay.indexOf(q) >= 0) out.push(t);
    });
    return out;
  }

  async function run(topic) {
    if (running) { NS.log('research: already working on one request'); return { ok: false, reason: 'busy' }; }
    running = true;
    const t0 = performance.now();
    try {
      step(1, 'request: ' + topic);
      try { await NS.chat.post('Noted. I will look up "' + topic + '" and post what I find here shortly.'); } catch (e) { NS.log('research: chat post failed: ' + e.message); }
      if (NS.relayReady && !(await NS.relayReady())) {
        await NS.chat.post('I cannot reach my lookup service right now, so Eswar will follow up on "' + topic + '" himself.');
        return { ok: false, reason: 'relay not running' };
      }
      const pg = await DC().wikiPage(DC().cut(topic, 100).replace(/[^\w\s'-]/g, ' '));
      step(2, pg ? 'page: ' + pg.title : 'no page found');
      let kept = [];
      if (pg) {
        const p = prompt(topic, pg.text);
        const raw = await DC().llmJson(p.system, p.user);
        const m = String(raw).match(/\{[\s\S]*\}/);
        let o = null;
        try { o = m ? JSON.parse(m[0]) : null; } catch (e) { o = null; }
        step(3, 'model gave ' + ((o && o.sentences && o.sentences.length) || 0) + ' sentences');
        kept = checkAnswer(o, pg.text);
        step(4, kept.length + ' sentences kept after the quote check');
      }
      let msg;
      if (kept.length) msg = 'Research on "' + topic + '": ' + kept.join(' ') + ' Source: Wikipedia, "' + pg.title + '" (' + pg.url + '). Not checked by Eswar yet.';
      else msg = 'I looked for "' + topic + '" but found nothing reliable I can quote, so I will not guess. Eswar will follow up.';
      await NS.chat.post(msg);
      step(5, 'posted in ' + Math.round(performance.now() - t0) + ' ms');
      const res = { ok: kept.length > 0, topic: topic, kept: kept, source: pg && pg.url, at: NS.isoLocal() };
      NS.researchHistory.unshift(res);
      return res;
    } catch (e) {
      NS.log('research failed: ' + e.message);
      try { await NS.chat.post('My lookup on "' + topic + '" failed, so Eswar will follow up himself.'); } catch (e2) { /* ignore */ }
      return { ok: false, reason: e.message };
    } finally { running = false; }
  }

  function handleSpeech(text) {
    if (NS.config.research === false || !DC()) return false;
    const topic = detect(text);
    if (!topic) return false;
    const key = DC().norm(topic), now = Date.now();
    if (seen[key] && now - seen[key] < (NS.config.chartRepeatMs || 300000)) return true;
    seen[key] = now;
    NS.log('heard a research request: ' + topic);
    run(topic);
    return true;
  }
  NS.researchHistory = NS.researchHistory || [];
  NS.research = { detect: detect, run: run, handleSpeech: handleSpeech, checkAnswer: checkAnswer };
})();
