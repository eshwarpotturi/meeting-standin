// Your context: every .md and .txt file in brain-test\brain-context (any sub-folders) is available to the stand-in.
// The relay serves the folder (POST /context). For each question this page picks the most relevant pieces, so the notes can be as large
// as you like, and the model only sees the part that matches the question.
//   core files     any file whose name starts with "00" is always included (who you are, standing rules).
//   index          the list of file names with their first line, so the model knows what exists.
//   matching       words in the question are matched against every piece, with a tolerance for misheard words (Viva ~ Veeva).
(function () {
  const NS = (window.__standin = window.__standin || {});
  const STOP = new Set('the and for are was were with that this have has had you your from what when where which who whom how why did does not but can could would should will about into over than then them they their there here been being his her its our out any all one two just also more most some such only very like going get got tell tells told say said want need please eswar stand standing project projects'.split(' '));
  let files = [], chunks = [], idf = {}, loadedAt = 0, loading = null, lastError = '';

  function words(s) {
    return (String(s || '').toLowerCase().match(/[a-z0-9][a-z0-9.%$'-]*[a-z0-9%]|[a-z0-9]/g) || []).filter(function (w) { return w.length >= 3 && !STOP.has(w); });
  }
  function skeleton(w) { return w[0] + w.slice(1).replace(/[aeiouhwy]/g, '').replace(/(.)\1+/g, '$1'); }
  function lev1(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }
  // How well does a question word match a word in a piece? 1 exact, 0.7 one typo, 0.5 sounds alike (same first letter and consonants).
  function match(q, t) {
    if (q === t) return 1;
    if (q.length >= 5 && t.length >= 5 && lev1(q, t)) return 0.7;
    if (q.length >= 4 && t.length >= 4 && q[0] === t[0] && skeleton(q).length >= 2 && skeleton(q) === skeleton(t)) return 0.5;
    return 0;
  }

  function splitFile(f) {
    let text = String(f.text || '').replace(/\r/g, '');
    const fm = text.match(/^---\n[\s\S]*?\n---\n/);
    let desc = '';
    if (fm) { const d = fm[0].match(/description:\s*(.+)/); desc = d ? d[1].trim() : ''; text = text.slice(fm[0].length); }
    const title = (text.match(/^#\s+(.+)$/m) || [])[1] || '';
    const first = desc || title || text.trim().split('\n')[0].slice(0, 120);
    const out = [];
    let cur = '';
    text.split(/\n{2,}/).forEach(function (para) {
      para = para.trim(); if (!para) return;
      if (cur && cur.length + para.length > 1100) { out.push(cur); cur = ''; }
      cur += (cur ? '\n\n' : '') + para;
      while (cur.length > 1600) { out.push(cur.slice(0, 1400)); cur = cur.slice(1400); }
    });
    if (cur) out.push(cur);
    return { first: first, chunks: out };
  }

  function build(list) {
    files = []; chunks = [];
    list.forEach(function (f) {
      if (!f || !f.file || typeof f.text !== 'string') return;
      const s = splitFile(f);
      const core = /(^|[\\/])00/.test(f.file);
      files.push({ file: f.file, first: s.first, core: core });
      s.chunks.forEach(function (c, i) {
        const text = '[' + f.file + (s.chunks.length > 1 ? ' part ' + (i + 1) : '') + ']\n' + c;
        const tf = {};
        // the file name counts too, so "Veeva" finds release-second-opinion
        words(f.file.replace(/[\\/._-]/g, ' ') + ' ' + c).forEach(function (w) { tf[w] = (tf[w] || 0) + 1; });
        chunks.push({ file: f.file, text: text, tf: tf, core: core });
      });
    });
    const df = {};
    chunks.forEach(function (c) { Object.keys(c.tf).forEach(function (w) { df[w] = (df[w] || 0) + 1; }); });
    idf = {};
    Object.keys(df).forEach(function (w) { idf[w] = Math.log(1 + chunks.length / df[w]); });
  }

  function score(qwords, c) {
    let s = 0;
    const vocab = Object.keys(c.tf);
    qwords.forEach(function (q) {
      let best = 0, bw = null;
      if (c.tf[q]) { best = 1; bw = q; }
      else for (let i = 0; i < vocab.length; i++) { const m = match(q, vocab[i]); if (m > best) { best = m; bw = vocab[i]; } }
      if (best) s += best * (idf[bw] || idf[q] || 1) * (1 + Math.log(c.tf[bw]));
    });
    return s;
  }

  // Returns { pack, used: [file names], chars } for a question (plus recent meeting lines, which count less).
  function pick(question, recent, budget) {
    budget = budget || NS.config.contextBudget || 9000;
    const qw = words(question), rw = words(recent).filter(function (w) { return qw.indexOf(w) < 0; }).slice(-12);
    const header = 'Files available: ' + files.map(function (f) { return f.file + ' (' + f.first.slice(0, 90) + ')'; }).join('; ').slice(0, 2200);
    let out = header, used = [];
    chunks.filter(function (c) { return c.core; }).forEach(function (c) { if (out.length + c.text.length < budget) { out += '\n\n' + c.text; used.push(c.file); } });
    const ranked = chunks.filter(function (c) { return !c.core; }).map(function (c) {
      return { c: c, s: score(qw, c) + 0.25 * score(rw, c) };
    }).filter(function (r) { return r.s > 0; }).sort(function (a, b) { return b.s - a.s; });
    const top = ranked.length ? ranked[0].s : 0;
    for (let i = 0; i < ranked.length; i++) {
      if (ranked[i].s < top * 0.3) break;
      if (out.length + ranked[i].c.text.length > budget) continue;
      out += '\n\n' + ranked[i].c.text;
      if (used.indexOf(ranked[i].c.file) < 0) used.push(ranked[i].c.file);
    }
    return { pack: out, used: used, chars: out.length };
  }

  async function load(force) {
    if (!force && loadedAt && Date.now() - loadedAt < (NS.config.contextRefreshMs || 60000)) return files.length > 0;
    if (loading) return loading;
    loading = (async function () {
      try {
        const d = await NS.relayCall('context', {}, 20000);
        if (!d.json || !Array.isArray(d.json.files)) throw new Error('no file list');
        build(d.json.files);
        loadedAt = Date.now(); lastError = '';
        NS.log('context: ' + files.length + ' files, ' + chunks.length + ' pieces loaded from the relay');
      } catch (e) {
        loadedAt = Date.now(); lastError = e.message;
        NS.log('context: not available (' + e.message + '); the relay will use brain-pack.txt if it has one');
      }
      loading = null;
      return files.length > 0;
    })();
    return loading;
  }

  // The pack for one question: null if there is no context folder, so the relay falls back to its own file.
  async function packFor(question, recent) {
    const ok = await load(false);
    if (!ok) return null;
    const r = pick(question, recent);
    NS.log('context: question uses ' + r.chars + ' characters from ' + (r.used.join(', ') || 'no file'));
    NS.lastContext = r;
    return r.pack;
  }

  NS.context = { load: load, pick: pick, packFor: packFor, build: build, words: words, match: match, info: function () { return { files: files.length, pieces: chunks.length, error: lastError }; } };
})();
