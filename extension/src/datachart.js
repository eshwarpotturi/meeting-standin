// Data chart: say "stand-in, chart India GDP growth" and the camera shows a chart of public data, with its source.
//
// How it works (all steps are logged with a timestamp and step n/5):
//   1 plan   the model picks where to look (World Bank indicator, or a Wikipedia search). It only chooses WHERE; it never supplies numbers.
//   2 fetch  the relay downloads the data (only api.worldbank.org and en.wikipedia.org are allowed there).
//   3 build  numbers are read from the download and checked. For Wikipedia, every number must appear word for word in the page.
//   4 show   the chart goes on the camera, with its source written on the slide, then a one-line summary worked out from the numbers.
//   5 chat   one labelled line with the source goes in the Meet chat.
// Nothing is charted unless real data was found. Numbers never come from the model's memory.
(function () {
  const NS = (window.__standin = window.__standin || {});
  const STEPS = 5;
  const HOSTS = ['api.worldbank.org', 'en.wikipedia.org'];

  function cut(x, n) { return String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, n); }
  function esc(s) { return encodeURIComponent(s); }

  // ---- Trigger phrase ----------------------------------------------------------------------------------------------
  // "stand-in, chart <topic>"  or  "Eswar, show the data on <topic>"  (also: plot, graph). Only your own speech counts.
  function triggerRe() {
    const name = String(NS.config.userName || 'Eswar').replace(/[^A-Za-z]/g, '');
    return new RegExp('\\b(?:stand[\\s-]?in|' + name + ')\\b[,:.\\s-]*(?:please\\s+)?(?:show|chart|plot|graph)\\b[\\s,]*(?:(?:me|us|the|a|data|numbers|chart|graph|on|for|about|of)\\b[\\s,]*)*([^.?!\\n]{4,160})', 'gi');
  }
  function detect(text) {
    const re = triggerRe();
    let m, last = '';
    while ((m = re.exec(String(text || '')))) last = m[1];
    return cut(last, 160).replace(/[,;:\s]+$/, '');
  }

  // ---- Plan ----------------------------------------------------------------------------------------------------------
  const YEAR = function () { return new Date().getFullYear(); };
  function buildPlanPrompt(topic) {
    return {
      system:
        'You choose where to find public data for a chart that a speaker asked for. You do not provide any numbers. Reply with JSON only.\n' +
        'Option 1, for country-level economic, social, demographic or environmental statistics: ' +
        '{"source":"worldbank","indicator":"<World Bank indicator code, for example NY.GDP.MKTP.KD.ZG>","countries":["IND"],"from":2015,"to":2024,"title":"<at most 8 words>"}. ' +
        'Use ISO3 country codes (WLD for the world), at most 3 countries, at most 25 years, and end at least one year before today.\n' +
        'Option 2, for anything else (a Wikipedia article will be searched and read): {"source":"wikipedia","query":"<search words, at most 8>","title":"<at most 8 words>"}.',
      user: 'Today\'s year: ' + YEAR() + '\nRequest: ' + topic,
    };
  }
  function parsePlan(text, topic) {
    const fallback = { source: 'wikipedia', query: cut(topic, 100).replace(/[^\w\s'-]/g, ' '), title: cut(topic, 60) };
    const m = String(text || '').match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    let o;
    try { o = JSON.parse(m[0]); } catch (e) { return fallback; }
    const title = cut(o.title || topic, 60);
    if (o.source === 'worldbank') {
      const ind = String(o.indicator || '').trim();
      const countries = Array.from(new Set((Array.isArray(o.countries) ? o.countries : []).map(function (c) { return String(c).trim().toUpperCase(); })));
      const from = Math.round(Number(o.from)), to = Math.round(Number(o.to));
      const okInd = /^[A-Za-z0-9]{2,12}(\.[A-Za-z0-9_]{1,12}){1,4}$/.test(ind);
      const okC = countries.length >= 1 && countries.length <= 3 && countries.every(function (c) { return /^[A-Z]{3}$/.test(c); });
      const okY = isFinite(from) && isFinite(to) && from >= 1960 && to <= YEAR() && to >= from && to - from <= 40;
      if (okInd && okC && okY) return { source: 'worldbank', indicator: ind, countries: countries, from: from, to: to, title: title };
      return fallback;
    }
    if (o.source === 'wikipedia') {
      const q = cut(o.query, 100).replace(/[^\w\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
      return q.length >= 3 ? { source: 'wikipedia', query: q, title: title } : fallback;
    }
    return fallback;
  }

  // ---- Relay helpers -------------------------------------------------------------------------------------------------
  async function llmJson(system, user) {
    const d = await NS.relayCall('llm', { system: system, user: user, maxTokens: 900 }, 30000);
    return (d.json && d.json.text) || '';
  }
  async function fetchPublic(url) {
    const host = new URL(url).hostname;
    if (HOSTS.indexOf(host) < 0) throw new Error('host not allowed: ' + host);
    const d = await NS.relayCall('fetch', { url: url }, 30000);
    if (!d.json || d.json.status !== 200 || typeof d.json.body !== 'string') throw new Error('fetch failed (' + (d.json && d.json.status) + ')');
    return d.json.body;
  }

  // ---- World Bank ----------------------------------------------------------------------------------------------------
  function worldBankUrl(p) {
    return 'https://api.worldbank.org/v2/country/' + p.countries.join(';') + '/indicator/' + p.indicator + '?format=json&per_page=400&date=' + p.from + ':' + p.to;
  }
  // Returns a chart or null. Rows look like { date:"2023", value:8.2, country:{value:"India"}, indicator:{value:"GDP growth (annual %)"} }.
  function parseWorldBank(body, plan) {
    let j;
    try { j = JSON.parse(body); } catch (e) { return null; }
    if (!Array.isArray(j) || j.length < 2 || !Array.isArray(j[1])) return null;
    const by = {};
    let indName = '';
    j[1].forEach(function (r) {
      if (r == null || r.value == null || !isFinite(Number(r.value))) return;
      const name = cut(r.country && r.country.value, 40) || cut(r.countryiso3code, 3);
      indName = indName || cut(r.indicator && r.indicator.value, 120);
      (by[name] = by[name] || []).push({ label: String(r.date), value: Math.round(Number(r.value) * 1000) / 1000 });
    });
    const series = Object.keys(by).map(function (k) { return { name: k, points: by[k].sort(function (a, b) { return a.label < b.label ? -1 : 1; }) }; })
      .filter(function (s) { return s.points.length >= NS.config.chartMinPoints; });
    if (!series.length) return null;
    const labels = [].concat.apply([], series.map(function (s) { return s.points.map(function (p) { return p.label; }); })).sort();
    const unit = (indName.match(/\(([^()]*)\)\s*$/) || [])[1] || '';
    return {
      type: 'line', title: plan.title, unit: cut(unit, 30), series: series,
      source: 'Source: World Bank, ' + plan.indicator + ', ' + labels[0] + '-' + labels[labels.length - 1],
      sourceName: 'World Bank (' + plan.indicator + ', ' + (indName || 'indicator') + ')',
    };
  }

  // ---- Wikipedia (fallback) ------------------------------------------------------------------------------------------
  function htmlToText(html) {
    return String(html || '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<sup[\s\S]*?<\/sup>/gi, '')
      .replace(/<\/(tr|p|li|h[1-6]|caption)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
      .replace(/&#\d+;|&[a-z]+;/g, ' ')
      .replace(/[ \t]+/g, ' ').replace(/ ?\| ?\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
  }
  function norm(t) { return String(t || '').replace(/[\s ]+/g, ' ').trim().toLowerCase(); }
  function numbersIn(s) {
    return (String(s).replace(/(\d),(?=\d{3}\b)/g, '$1').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  }
  // Every point must come with the exact words from the page that contain its number. Any miss rejects the whole chart.
  function validateExtract(o, pageText, minPoints) {
    if (!o || !Array.isArray(o.points)) return { ok: false, reason: 'no points' };
    const hay = norm(pageText);
    const pts = o.points.slice(0, 12);
    if (pts.length < minPoints) return { ok: false, reason: 'too few points (' + pts.length + ')' };
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], v = Number(p && p.value), q = norm(p && p.quote);
      const label = cut(p && p.label, 30);
      if (!label || !isFinite(v) || q.length < 6) return { ok: false, reason: 'point ' + (i + 1) + ' is incomplete' };
      if (hay.indexOf(q) < 0) return { ok: false, reason: 'point ' + (i + 1) + ': quote not found in the page' };
      if (!numbersIn(q).some(function (n) { return Math.abs(n - v) < 1e-9; })) return { ok: false, reason: 'point ' + (i + 1) + ': number not in its quote' };
      out.push({ label: label, value: v });
    }
    return { ok: true, points: out };
  }
  function buildPrompt(topic, pageText) {
    return {
      system:
        'Extract ONE numeric series from the page text that best answers the request: a time series (labels are years or dates) or a ranking of up to 8 items. ' +
        'Use ONLY numbers that appear in the text. Do not calculate, estimate or convert anything. ' +
        'Reply with JSON only: {"title":"<at most 8 words>","unit":"<unit, may be empty>","points":[{"label":"2019","value":12.5,"quote":"the exact words copied from the text that contain this number"}]}. ' +
        '3 to 12 points. If the text has no suitable numbers, reply {"points":[]}.',
      user: 'Request: ' + topic + '\n\nPage text:\n' + pageText.slice(0, 12000),
    };
  }
  // Search Wikipedia, read the best page as plain text (tables kept as "a | b" rows). Null if there is no usable page.
  async function wikiPage(query) {
    const sBody = await fetchPublic('https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=3&format=json&srsearch=' + esc(query));
    let hits;
    try { hits = JSON.parse(sBody).query.search; } catch (e) { hits = []; }
    if (!hits || !hits.length) return null;
    const title = hits[0].title;
    const pBody = await fetchPublic('https://en.wikipedia.org/w/api.php?action=parse&prop=text&redirects=1&format=json&page=' + esc(title));
    let html;
    try { html = JSON.parse(pBody).parse.text['*']; } catch (e) { return null; }
    return { title: title, url: 'https://en.wikipedia.org/wiki/' + esc(title.replace(/ /g, '_')), text: htmlToText(html) };
  }
  async function fromWikipedia(plan, topic) {
    const pg = await wikiPage(plan.query);
    if (!pg) return { ok: false, reason: 'no usable Wikipedia page found' };
    const title = pg.title, text = pg.text, url = pg.url;
    const pr = buildPrompt(topic, text);
    const raw = await llmJson(pr.system, pr.user);
    const m = String(raw).match(/\{[\s\S]*\}/);
    let o = null;
    try { o = m ? JSON.parse(m[0]) : null; } catch (e) { o = null; }
    const v = validateExtract(o, text, NS.config.chartMinPoints);
    if (!v.ok) return { ok: false, reason: 'Wikipedia "' + title + '": ' + v.reason };
    const years = v.points.every(function (p) { return /^\d{4}/.test(p.label); });
    const ctitle = cut(o.title || plan.title, 60);
    const base = { title: ctitle, unit: cut(o.unit, 30), source: 'Source: Wikipedia, ' + title, sourceName: 'Wikipedia, "' + title + '" (' + url + ')' };
    const chart = years
      ? Object.assign(base, { type: 'line', series: [{ name: ctitle, points: v.points }] })
      : Object.assign(base, { type: 'bar', items: v.points.slice(0, 8) });
    return { ok: true, chart: chart };
  }

  // ---- Summary worked out from the numbers (never written by the model) ----------------------------------------------
  function r(n) { return NS.shortNumber ? NS.shortNumber(n) : String(Math.round(n * 100) / 100); }
  function summarise(c) {
    if (c.type === 'bar') {
      const s = c.items.slice().sort(function (a, b) { return b.value - a.value; });
      return 'Highest: ' + s[0].label + ' (' + r(s[0].value) + '). Lowest: ' + s[s.length - 1].label + ' (' + r(s[s.length - 1].value) + ').';
    }
    if (c.series.length === 1) {
      const p = c.series[0].points, hi = p.reduce(function (a, b) { return b.value > a.value ? b : a; });
      const f = p[0], l = p[p.length - 1], d = l.value - f.value;
      return 'Peak: ' + r(hi.value) + ' in ' + hi.label + '. Latest: ' + r(l.value) + ' in ' + l.label + ', ' + (d >= 0 ? 'up ' : 'down ') + r(Math.abs(d)) + ' since ' + f.label + '.';
    }
    return c.series.map(function (s) {
      const f = s.points[0], l = s.points[s.points.length - 1], d = l.value - f.value;
      return s.name + ' ' + (d >= 0 ? 'up ' : 'down ') + r(Math.abs(d)) + ' (' + f.label + ' to ' + l.label + ')';
    }).join('. ') + '.';
  }

  // ---- Run -----------------------------------------------------------------------------------------------------------
  let running = false;
  const seen = {}; // topic -> time last charted from speech
  const msg = function (title, text) { return [{ kind: 'text', title: title, text: text }]; };

  async function run(topic) {
    topic = cut(topic, 160);
    if (!topic) return { ok: false, reason: 'no topic' };
    if (running) { NS.log('data chart: busy, ignored "' + topic + '"'); return { ok: false, reason: 'busy' }; }
    running = true;
    const t0 = performance.now();
    const step = function (n, what) { NS.log('data chart: ' + what, n, STEPS); };
    try {
      NS.slides.showFrames(msg('Looking up public data', topic), { holdMs: 25000 });
      if (!(await NS.relayReady())) {
        NS.log('data chart: relay not found, cannot look up data. Press Connect relay in the panel.');
        NS.slides.showFrames(msg('Data lookup is off', 'The relay is not running.'), { holdMs: 5000 });
        return { ok: false, reason: 'relay not running' };
      }
      step(1, 'planning where to look for "' + topic + '"');
      const pr = buildPlanPrompt(topic);
      const plan = parsePlan(await llmJson(pr.system, pr.user), topic);
      step(2, 'plan: ' + (plan.source === 'worldbank' ? 'World Bank ' + plan.indicator + ' ' + plan.countries.join(',') + ' ' + plan.from + '-' + plan.to : 'Wikipedia search "' + plan.query + '"'));
      let chart = null, why = '';
      if (plan.source === 'worldbank') {
        try { chart = parseWorldBank(await fetchPublic(worldBankUrl(plan)), plan); } catch (e) { why = 'World Bank: ' + e.message; }
        if (!chart && !why) why = 'World Bank returned no usable data for ' + plan.indicator;
        if (!chart) {
          NS.log('data chart: ' + why + '; trying Wikipedia');
          plan.source = 'wikipedia'; plan.query = cut(topic, 100).replace(/[^\w\s'-]/g, ' ');
        }
      }
      if (!chart) {
        try {
          const w = await fromWikipedia(plan, topic);
          if (w.ok) chart = w.chart; else why = (why ? why + '; ' : '') + w.reason;
        } catch (e) { why = (why ? why + '; ' : '') + 'Wikipedia: ' + e.message; }
      }
      step(3, chart ? 'data checked: ' + (chart.series ? chart.series.map(function (s) { return s.name + ' ' + s.points.length + ' points'; }).join(', ') : chart.items.length + ' items') : 'no reliable data (' + why + ')');
      if (!chart) {
        NS.slides.showFrames(msg('No reliable data found', topic), { holdMs: 6000 });
        return { ok: false, reason: why || 'no data' };
      }
      const frames = [{ kind: 'chart', chart: chart }, { kind: 'text', title: 'What the data shows', text: summarise(chart) }];
      NS.slides.showFrames(frames, { stepMs: NS.config.chartStepMs, holdMs: NS.config.chartHoldMs });
      step(4, 'chart on the camera in ' + Math.round(performance.now() - t0) + ' ms');
      if (NS.config.chartChat && NS.chat) {
        try { await NS.chat.post('Chart on screen: ' + cut(chart.title, 60) + '. ' + chart.sourceName + '. ' + summarise(chart)); } catch (e) { NS.log('data chart: chat post failed: ' + e.message); }
      }
      step(5, 'done');
      const res = { ok: true, topic: topic, chart: chart, summary: summarise(chart), ms: Math.round(performance.now() - t0), at: NS.isoLocal() };
      NS.chartHistory.unshift(res);
      NS.events.dispatchEvent(new CustomEvent('chart', { detail: res }));
      return res;
    } catch (e) {
      NS.log('data chart failed: ' + e.message);
      try { NS.slides.showFrames(msg('Data lookup failed', 'Try again.'), { holdMs: 4000 }); } catch (e2) { /* ignore */ }
      return { ok: false, reason: e.message };
    } finally {
      running = false;
    }
  }

  // Called by the caption reader with your own speech. Runs at most once per topic every few minutes.
  function handleSpeech(text) {
    if (!NS.config.dataChart) return false;
    const topic = detect(text);
    if (!topic) return false;
    const key = norm(topic), now = Date.now();
    if (seen[key] && now - seen[key] < (NS.config.chartRepeatMs || 300000)) return false;
    seen[key] = now;
    NS.log('heard a chart request: ' + topic);
    run(topic);
    return true;
  }

  NS.chartHistory = NS.chartHistory || [];
  NS.events = NS.events || new EventTarget();
  NS.dataChart = { llmJson: llmJson, fetchPublic: fetchPublic, wikiPage: wikiPage, norm: norm, numbersIn: numbersIn, cut: cut, detect: detect, run: run, handleSpeech: handleSpeech, parsePlan: parsePlan, parseWorldBank: parseWorldBank, validateExtract: validateExtract, htmlToText: htmlToText, summarise: summarise };
})();
