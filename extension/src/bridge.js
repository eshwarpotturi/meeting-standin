// Runs in the extension's own world. Passes messages between the Meet page and the background script.
window.addEventListener('message', function (ev) {
  const d = ev.data;
  if (ev.source !== window || !d || d.source !== 'standin') return;
  if (d.type === 'save-key') {
    chrome.storage.local.set({ apiKey: d.key });
    return;
  }
  if (d.type === 'llm') {
    chrome.runtime.sendMessage({ type: 'llm', body: d.body }, function (res) {
      const err = chrome.runtime.lastError;
      window.postMessage(
        {
          source: 'standin-bridge',
          id: d.id,
          ok: !err && res && res.ok,
          text: res && res.text,
          error: err ? err.message : res && res.error,
        },
        '*'
      );
    });
  }
});
