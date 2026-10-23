// Chat-only stand-in: listens to Meet captions, answers in the Meet chat when someone asks you a question.
(function () {
  const NS = (window.__standin = window.__standin || {});
  if (NS.started) { console.log('stand-in is already running'); return; }
  NS.started = true;
  NS.config.output = 'chat';
  NS.config.override = false;
  NS.config.realVoice = false;

  let pill = null;
  function drawPill(on) {
    if (!pill) {
      pill = document.createElement('div');
      pill.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;background:#14130f;color:#fff;font:14px system-ui,sans-serif;padding:8px 12px;border-radius:8px;display:flex;gap:10px;align-items:center';
      pill.appendChild(document.createElement('span'));
      const b = document.createElement('button');
      b.style.cssText = 'font:inherit;padding:2px 8px;border-radius:4px;border:0;cursor:pointer';
      b.onclick = function () { on = !NS.listening; NS.listening ? window.standin.stop() : window.standin.start(); };
      pill.appendChild(b);
      document.body.appendChild(pill);
    }
    pill.firstChild.textContent = 'AI stand-in: ' + (NS.listening ? 'listening' : 'paused');
    pill.lastChild.textContent = NS.listening ? 'Pause' : 'Start';
  }

  window.standin = {
    start: function () { NS.captions.start(); NS.listening = true; drawPill(); NS.log('listening to captions; answers go to the Meet chat'); },
    stop: function () { NS.captions.stop(); NS.listening = false; drawPill(); NS.log('paused'); },
    ask: function (text) { return NS.ask(text, text); }, // type a test question
    chatCheck: function () { return NS.chat.check(); },
    status: function () { return { listening: !!NS.listening, brain: NS.config.brain, threshold: NS.config.threshold, sent: NS.chat.sent.length }; },
    config: NS.config,
    save: NS.saveConfig,
  };
  if (NS.config.autoRelay) NS.openBridge();
  window.standin.start();
})();
