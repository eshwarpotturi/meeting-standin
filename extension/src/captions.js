// Reads Meet's live captions from the page. Captions must be switched on in Meet.
// Uses the same page structure as Anand's meetcaptions bookmarklet (tools.s-anand.net/meetcaptions):
// region [role=region][aria-label=Captions], one item per speaker turn (.nMcdL) with the speaker (.NWpY1d) and the text (.ygicle).
// If Meet changes that layout, it falls back to reading the whole region as one block of text.
// Meet's page layout can change without warning.
(function () {
  const NS = (window.__standin = window.__standin || {});
  const SEL = { region: '[role="region"][aria-label="Captions"]', item: '.nMcdL', speaker: '.NWpY1d', text: '.ygicle', avatar: 'img[data-iml], img[src*="googleusercontent.com"]' };
  const turns = new Map(); // element -> { speaker, text, handled, timer, firstAt }
  let observer = null;
  let startedAt = Date.now();
  let blockLast = '';
  let blockTimer = null;
  NS.transcript = []; // [{ speaker, text, at }] merged like Anand's file

  function norm(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
  function regionEl() {
    const all = Array.from(document.querySelectorAll('[role="region"][aria-label="Captions"], [aria-label*="aption" i]'));
    return all.find(function (e) { return norm(e.innerText); }) || all[0] || null;
  }
  function items() {
    const r = document.querySelector(SEL.region);
    if (!r) return [];
    const byClass = Array.from(r.querySelectorAll(SEL.item));
    if (byClass.length) return byClass;
    return Array.from(r.children).filter(function (e) { return e.querySelector(SEL.avatar); });
  }
  function readTurn(el) {
    const sp = el.querySelector(SEL.speaker) || el.querySelector('span');
    let tx = el.querySelector(SEL.text);
    if (!tx) {
      const divs = Array.from(el.children).filter(function (c) { return c.tagName === 'DIV' && !c.querySelector(SEL.avatar); });
      tx = divs[divs.length - 1];
    }
    const speaker = norm(sp && sp.textContent), text = norm(tx && tx.textContent);
    return speaker && text ? { speaker: speaker, text: text } : null;
  }
  function isSelf(speaker) {
    const s = speaker.toLowerCase();
    return NS.config.ignoreOwnSpeech !== false && (s === 'you' || s === NS.config.userName.toLowerCase() + ' (you)');
  }

  // Add to the transcript: same speaker keeps growing one entry (as in Anand's file).
  function record(speaker, text) {
    const last = NS.transcript[NS.transcript.length - 1];
    if (last && last.speaker === speaker) {
      if (text === last.text || last.text.endsWith(text)) return;
      if (text.indexOf(last.text) === 0) { last.text = text; return; }
      last.text += '\n\n' + text;
      return;
    }
    NS.transcript.push({ speaker: speaker, text: text, at: Date.now() - startedAt });
  }
  function recentLines() {
    return NS.transcript.slice(-6).map(function (t) { return t.speaker + ': ' + t.text.replace(/\s+/g, ' ').slice(-300); }).join('\n');
  }
  function mmss(ms) { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  NS.transcriptMarkdown = function () {
    const head = '# ' + (norm(document.title.replace(/^Meet\s*[-–]\s*/, '')) || 'Meeting') + '\n\n- **Started**: ' + new Date(startedAt).toLocaleString() + '\n\n---\n';
    return head + NS.transcript.map(function (t) { return '\n## ' + t.speaker + ' [' + mmss(t.at) + ']\n\n' + t.text + '\n'; }).join('');
  };
  NS.downloadTranscript = function () {
    if (!NS.transcript.length) return false;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([NS.transcriptMarkdown()], { type: 'text/markdown' }));
    a.download = 'meet-captions-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.md';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    return true;
  };

  function fire(speaker, text) {
    NS.log('caption' + (speaker ? ' (' + speaker + ')' : '') + ': ' + text.slice(-120));
    NS.handleUtterance(text, recentLines()).catch(function (e) { NS.log('caption handling failed: ' + e.message); });
  }

  function scan() {
    const list = items();
    if (list.length) {
      list.forEach(function (el) {
        const t = readTurn(el);
        if (!t) return;
        let st = turns.get(el);
        if (!st) { st = { speaker: t.speaker, text: '', handled: '', timer: null }; turns.set(el, st); }
        if (t.text === st.text) return;
        st.text = t.text; st.speaker = t.speaker;
        record(t.speaker, t.text);
        clearTimeout(st.timer);
        // Wait for the speaker to finish before treating it as a question.
        st.timer = setTimeout(function () {
          if (st.text === st.handled) return;
          st.handled = st.text;
          if (isSelf(st.speaker)) return;
          fire(st.speaker, st.text);
        }, NS.config.captionDebounceMs);
      });
      return;
    }
    // Fallback: no turn structure found, read the region as one block.
    const el = regionEl();
    if (!el) return;
    const text = norm(el.innerText);
    if (!text || text === blockLast) return;
    blockLast = text;
    record('', text);
    clearTimeout(blockTimer);
    blockTimer = setTimeout(function () { fire('', text); }, NS.config.captionDebounceMs);
  }

  NS.captions = {
    start: function () {
      if (observer) return;
      // Whatever was said before now or while paused is not answered.
      turns.clear();
      items().forEach(function (el) {
        const t = readTurn(el);
        if (t) turns.set(el, { speaker: t.speaker, text: t.text, handled: t.text, timer: null });
      });
      const r = regionEl();
      blockLast = r && !items().length ? norm(r.innerText) : '';
      if (!NS.transcript.length) startedAt = Date.now();
      observer = new MutationObserver(scan);
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      NS.log('listening to captions');
    },
    stop: function () {
      if (observer) observer.disconnect();
      observer = null;
      clearTimeout(blockTimer);
      turns.forEach(function (st) { clearTimeout(st.timer); });
    },
  };
})();
