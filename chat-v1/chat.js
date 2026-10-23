// Posts the stand-in's answer into the Google Meet chat. No face, no voice.
// NOTE: Meet's page layout can change without warning. This finds the chat box by its label.
(function () {
  const NS = (window.__standin = window.__standin || {});
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const visible = function (el) { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); };
  const label = function (el) { return (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || ''); };

  function findInput() {
    return Array.prototype.find.call(document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]'), function (el) {
      return visible(el) && /message/i.test(label(el));
    });
  }
  function findChatButton() {
    return Array.prototype.find.call(document.querySelectorAll('button, [role="button"]'), function (b) {
      return /^chat with everyone/i.test(b.getAttribute('aria-label') || '');
    });
  }
  function findSend() {
    return Array.prototype.find.call(document.querySelectorAll('button, [role="button"]'), function (b) {
      return visible(b) && /^send/i.test(b.getAttribute('aria-label') || '') && b.tagName === 'BUTTON';
    });
  }
  function setValue(el, text) {
    el.focus();
    if (el.isContentEditable) {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
      return;
    }
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function pressEnter(el) {
    ['keydown', 'keypress', 'keyup'].forEach(function (t) {
      el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    });
  }
  async function ensureOpen() {
    let input = findInput();
    if (input) return input;
    const btn = findChatButton();
    if (btn) btn.click();
    for (let i = 0; i < 30; i++) {
      await sleep(100);
      input = findInput();
      if (input) return input;
    }
    throw new Error('Meet chat box not found. Open the chat panel once and try again.');
  }

  const sent = [];
  NS.chat = {
    sent: sent,
    // Always labelled, so nobody mistakes it for the person.
    prefix: function () { return '[AI stand-in for ' + NS.config.userName + '] '; },
    post: async function (text) {
      const line = NS.chat.prefix() + text;
      const input = await ensureOpen();
      setValue(input, line);
      await sleep(80);
      const send = findSend();
      if (send && !send.disabled) send.click();
      else pressEnter(input);
      await sleep(150);
      sent.push(line);
      NS.log('posted to chat: ' + line);
    },
    // Quick self-check: can the stand-in find the Meet chat?
    check: function () { return { chatBox: !!findInput(), chatButton: !!findChatButton() }; },
  };
})();
