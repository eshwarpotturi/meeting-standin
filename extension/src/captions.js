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
