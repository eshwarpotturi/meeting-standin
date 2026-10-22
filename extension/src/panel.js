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
