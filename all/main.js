// All-in-one stand-in: captions in -> answer in the Meet chat AND as slides on your camera. Control panel with Yes/No override.
(function () {
  const NS = (window.__standin = window.__standin || {});
  if (NS.started) { console.log('stand-in is already running'); return; }
  NS.started = true;
  NS.config.output = 'all';
  NS.config.realVoice = false;
  NS.config.override = true;
  NS.config.enabled = true;

  function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }
  const BTN = 'font:inherit;padding:4px 10px;border:1px solid #1f5fd1;background:#1f5fd1;color:#fff;border-radius:6px;cursor:pointer';
  let ui = null;
  function buildPanel() {
    if (ui || !document.body) return;
    const host = el('div', 'position:fixed;left:12px;bottom:12px;z-index:2147483647;font:14px/1.35 system-ui,sans-serif;background:#fff;color:#14181f;border:1px solid #d9dee6;border-radius:12px;padding:12px;width:300px;box-shadow:0 4px 16px rgba(0,0,0,.25)');
    host.id = 'standin-all-panel';
    const title = el('div', 'font-weight:700;font-size:16px', 'AI stand-in for ' + NS.config.userName);
    const status = el('div', 'color:#5a6472;font-size:12px;margin-top:2px');
    const row1 = el('div', 'display:flex;gap:8px;align-items:center;margin-top:8px');
    const toggle = el('button', BTN, 'Pause');
    toggle.id = 'standin-toggle';
    const relay = el('button', BTN, 'Connect relay');
    relay.id = 'standin-relay';
    row1.append(toggle, relay);
    const row2 = el('div', 'display:flex;gap:8px;align-items:center;margin-top:8px');
    const thr = el('input'); thr.type = 'range'; thr.min = '50'; thr.max = '95'; thr.step = '1'; thr.value = NS.config.threshold; thr.id = 'standin-thr';
    thr.setAttribute('aria-label', 'Answer at confidence'); thr.style.flex = '1';
    const thrv = el('span', '', NS.config.threshold + '%');
    row2.append(el('span', '', 'Answer at'), thr, thrv);
    const row3 = el('div', 'display:flex;gap:8px;margin-top:8px');
    const q = el('input', 'flex:1;min-width:0;padding:6px;border:1px solid #d9dee6;border-radius:6px'); q.type = 'text'; q.id = 'standin-q';
    q.placeholder = 'Test question or: stand-in, chart ...'; q.setAttribute('aria-label', 'Test question');
    const ask = el('button', BTN, 'Ask'); ask.id = 'standin-ask';
    row3.append(q, ask);
    const last = el('div', 'margin-top:8px;font-size:13px'); last.id = 'standin-last';
    const ovText = el('div', 'font-weight:700;color:#a35a00');
    const ovRow = el('div', 'display:flex;gap:8px;margin-top:6px');
    const yes = el('button', BTN, 'Yes'), no = el('button', BTN, 'No');
    yes.id = 'standin-yes'; no.id = 'standin-no';
    ovRow.append(yes, no);
    const ov = el('div', 'display:none;margin-top:8px;padding:8px;border:2px solid #a35a00;border-radius:8px'); ov.id = 'standin-override';
    ov.append(ovText, ovRow);
    const row4 = el('div', 'display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap');
    const save = el('button', BTN, 'Save captions (.md)'); save.id = 'standin-save';
    const saved = el('span', 'color:#5a6472;font-size:12px');
    const clear = el('button', BTN, 'Clear camera'); clear.id = 'standin-clear';
    const chk = el('button', BTN, 'Check notes'); chk.id = 'standin-notes';
    row4.append(save, clear, chk, saved);
    chk.onclick = function () { saved.textContent = 'Checking notes...'; NS.context.explain(q.value.replace(/^\s*eswar[,:]?\s*/i, '').trim()).then(function (r) { saved.textContent = r.text; NS.log('notes check: ' + r.text); }); };
    clear.onclick = function () { NS.slides.clear(); saved.textContent = 'Camera cleared.'; };
    save.onclick = function () { saved.textContent = NS.downloadTranscript() ? 'Saved.' : 'No captions yet.'; };
    host.append(title, status, row1, row2, row3, row4, ov, last);
    document.body.appendChild(host);
    ui = { status: status, toggle: toggle, last: last, ov: ov, ovText: ovText, relay: relay };

    toggle.onclick = function () { NS.listening ? window.standin.stop() : window.standin.start(); };
    relay.onclick = function () { last.textContent = NS.openBridge(true) ? 'Relay window opened. Leave it open.' : 'Pop-up blocked. Allow pop-ups for Meet and press again.'; };
    thr.oninput = function () { NS.config.threshold = Number(thr.value); thrv.textContent = thr.value + '%'; NS.saveConfig(); };
    ask.onclick = function () {
      const v = q.value.trim(); if (!v) return;
      // A chart phrase typed here, for example: stand-in, chart India GDP growth
      const rtopic = NS.research && NS.research.detect(v);
      if (rtopic) { last.textContent = 'Researching: ' + rtopic + ' (answer goes to the chat)'; NS.research.run(rtopic); return; }
      const topic = NS.dataChart.detect(v);
      if (topic) { last.textContent = 'Looking up: ' + topic; NS.dataChart.run(topic); return; }
      NS.ask(v, '').then(function (r) {
        if (!r.handled) last.textContent = 'Ignored (' + r.reason + '). Start with your name, for example: "' + NS.config.userName + ', how is the project going?"';
      });
    };
    yes.onclick = function () { NS.override('yes'); };
    no.onclick = function () { NS.override('no'); };
    NS.events.addEventListener('override-request', function (ev) { ovText.textContent = 'Asked: ' + ev.detail.question; ov.style.display = 'block'; });
    NS.events.addEventListener('override-done', function () { ov.style.display = 'none'; });
    NS.events.addEventListener('decision', function (ev) {
      const r = ev.detail;
      const label = r.action === 'held' ? 'Held for you' : r.action === 'answered' ? 'Answered (open)' : r.decision.answer.toUpperCase();
      const used = NS.lastContext && NS.lastContext.used.filter(function (f, k, a) { return a.indexOf(f) === k; });
      last.textContent = label + ' · ' + r.decision.confidence + '% · ' + r.question + (used && used.length ? ' · notes used: ' + used.join(', ') : '');
    });
    NS.events.addEventListener('chart', function (ev) { last.textContent = 'Chart shown · ' + ev.detail.chart.title + ' · ' + ev.detail.chart.source; });
    drawStatus();
  }
  function drawStatus() {
    if (!ui) return;
    ui.status.textContent = (NS.listening ? 'Listening to captions' : 'Paused') + '. Answers go to the chat and the camera.';
    ui.toggle.textContent = NS.listening ? 'Pause' : 'Start';
  }

  window.standin = {
    start: function () { NS.captions.start(); NS.listening = true; drawStatus(); NS.log('listening to captions; answers go to the Meet chat and the camera'); },
    stop: function () { NS.captions.stop(); NS.listening = false; drawStatus(); NS.log('paused'); },
    ask: function (text) { return NS.ask(text, text); },
    // Show a chart of public data on the camera now, for example standin.chart('India GDP growth since 2015').
    chart: function (topic) { return NS.dataChart.run(topic); },
    research: function (topic) { return NS.research.run(topic); },
    // Shows what the stand-in knows and what this question would send: standin.explain('how is the Veeva project going').then(console.log)
    explain: function (q) { return NS.context.explain(q); },
    transcript: function () { return NS.transcriptMarkdown(); },
    saveTranscript: function () { return NS.downloadTranscript(); },
    chatCheck: function () { return NS.chat.check(); },
    status: function () { return { listening: !!NS.listening, brain: NS.config.brain, threshold: NS.config.threshold, sent: NS.chat.sent.length, charts: NS.chartHistory.length, cameraCalls: NS.cameraCalls, slides: NS.slides.state() }; },
    config: NS.config,
    save: NS.saveConfig,
  };
  NS.slides.init();
  buildPanel();
  if (!ui) document.addEventListener('DOMContentLoaded', buildPanel, { once: true });
  if (NS.config.autoRelay) NS.openBridge();
  window.standin.start();
  NS.log('Now turn your Meet camera off and on once, so Meet picks up the slide camera.');
})();
