// Holds the API key and calls Claude. The key stays in the extension, never in the Meet page.
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== 'llm') return false;
  chrome.storage.local.get('apiKey', function (store) {
    if (!store.apiKey) {
      sendResponse({ ok: false, error: 'No API key saved' });
      return;
    }
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': store.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(msg.body),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + r.status);
          return j;
        });
      })
      .then(function (j) {
        const text = (j.content || [])
          .filter(function (c) { return c.type === 'text'; })
          .map(function (c) { return c.text; })
          .join('');
        sendResponse({ ok: true, text: text });
      })
      .catch(function (e) {
        sendResponse({ ok: false, error: e.message });
      });
  });
  return true; // keep the channel open for the async reply
});
