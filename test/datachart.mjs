// Test of the data chart ("stand-in, chart <topic>") on a mock Meet page with a mock relay. No network, no key, no cost.
// The mock relay answers /llm and /fetch with canned World Bank and Wikipedia replies. The data in it is test data, not real statistics.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = fs.readFileSync(path.join(here, '..', 'standin-all.js'), 'utf8');
const stamp = () => new Date().toISOString();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0; const fails = [];
function check(name, pass, detail) { n++; if (!pass) fails.push(name); console.log(`${stamp()} [${n}] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`); }

// ---- mock Meet page (with the same Trusted Types rule as real Meet) ----
const meet = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.setHeader('content-security-policy', "require-trusted-types-for 'script'");
  res.end(fs.readFileSync(path.join(here, 'meet-mock.html')));
});
await new Promise((r) => meet.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${meet.address().port}/`;

// ---- mock relay: /bridge, /llm, /fetch ----
const WB_ROWS = [
  [2024, null], [2023, 8.2], [2022, 7.6], [2021, 9.7], [2020, -5.8], [2019, 3.9], [2018, 6.5],
].map(([d, v]) => ({ indicator: { id: 'NY.GDP.MKTP.KD.ZG', value: 'GDP growth (annual %)' }, country: { id: 'IN', value: 'India' }, countryiso3code: 'IND', date: String(d), value: v }));
const PAGE_HTML =
  '<style>.x{}</style><p>Test page about rovers.<sup>[1]</sup></p>' +
  '<table><tr><th>Year</th><th>Test rovers active</th></tr>' +
  '<tr><td>2019</td><td>120</td></tr><tr><td>2020</td><td>135</td></tr><tr><td>2021</td><td>150</td></tr><tr><td>2022</td><td>170</td></tr><tr><td>2023</td><td>190</td></tr></table>' +
  '<table><tr><th>Site</th><th>Distance (km)</th></tr><tr><td>Alpha</td><td>45</td></tr><tr><td>Bravo</td><td>28</td></tr><tr><td>Charlie</td><td>17</td></tr></table>';
const YEARS = [['2019', 120], ['2020', 135], ['2021', 150], ['2022', 170], ['2023', 190]].map(([l, v]) => ({ label: l, value: v, quote: `${l} | ${v}` }));
const seen = []; // every url the relay was asked to fetch
const llmSeen = [];
const relaySrv = http.createServer((req, res) => {
  if (req.url === '/bridge') { res.setHeader('content-type', 'text/html'); return res.end(fs.readFileSync(path.join(here, 'relay-bridge.html'), 'utf8').replace('__ALLOWED_ORIGIN__', base.replace(/\/$/, ''))); }
  if (req.method !== 'POST') { res.statusCode = 404; return res.end(); }
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', async () => {
    res.setHeader('content-type', 'application/json');
    const body = JSON.parse(b || '{}');
    if (req.url === '/llm') {
      llmSeen.push(body.user);
      const u = body.user || '';
      if (/You choose where to find public data/.test(body.system)) {
        if (/India GDP/.test(u)) return res.end(JSON.stringify({ text: '{"source":"worldbank","indicator":"NY.GDP.MKTP.KD.ZG","countries":["IND"],"from":2018,"to":2023,"title":"India GDP growth"}' }));
        if (/bad indicator/.test(u)) return res.end(JSON.stringify({ text: '{"source":"worldbank","indicator":"XX.INVALID","countries":["IND"],"from":2018,"to":2023,"title":"Bad indicator test"}' }));
        return res.end(JSON.stringify({ text: '{"source":"wikipedia","query":"test rovers","title":"Test rovers"}' }));
      }
      // extraction from the Wikipedia page
      if (/fabricated/.test(u)) return res.end(JSON.stringify({ text: JSON.stringify({ title: 'Rovers', unit: '', points: YEARS.map((p, i) => (i === 3 ? { label: '2022', value: 999, quote: '2022 | 999' } : p)) }) }));
      if (/sites/.test(u)) return res.end(JSON.stringify({ text: JSON.stringify({ title: 'Distance by site', unit: 'km', points: [['Alpha', 45], ['Bravo', 28], ['Charlie', 17]].map(([l, v]) => ({ label: l, value: v, quote: `${l} | ${v}` })) }) }));
      return res.end(JSON.stringify({ text: 'Here you go: ' + JSON.stringify({ title: 'Test rovers active', unit: 'rovers', points: YEARS }) }));
    }
    if (req.url === '/fetch') {
      seen.push(body.url);
      await wait(300);
      const u = new URL(body.url);
      if (u.hostname === 'api.worldbank.org') {
        if (/XX\.INVALID/.test(u.pathname)) return res.end(JSON.stringify({ status: 200, body: JSON.stringify([{ message: [{ id: '120', key: 'Invalid value', value: 'The provided parameter value is not valid' }] }]) }));
        return res.end(JSON.stringify({ status: 200, body: JSON.stringify([{ page: 1, pages: 1, total: WB_ROWS.length }, WB_ROWS]) }));
      }
      if (u.hostname === 'en.wikipedia.org') {
        if (u.searchParams.get('list') === 'search') return res.end(JSON.stringify({ status: 200, body: JSON.stringify({ query: { search: [{ title: 'Test rover page' }] } }) }));
        if (u.searchParams.get('action') === 'parse') return res.end(JSON.stringify({ status: 200, body: JSON.stringify({ parse: { title: 'Test rover page', text: { '*': PAGE_HTML } } }) }));
      }
      return res.end(JSON.stringify({ status: 404, body: '' }));
    }
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise((r) => relaySrv.listen(8766, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
async function session(extra, withRelay = true) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((cfg) => {
    localStorage.setItem('standin.config', JSON.stringify(Object.assign({ brain: 'stub', autoRelay: true, relayUrl: 'http://127.0.0.1:8766', captionDebounceMs: 150, duplicateWindowMs: 3000, userName: 'Eswar', slideStepMs: 1500, slideHoldMs: 3500, chartStepMs: 2000, chartHoldMs: 5000 }, cfg)));
  }, extra || {});
  await page.goto(base);
  const cdp = await ctx.newCDPSession(page);
  const r = await cdp.send('Runtime.evaluate', { expression: bundle });
  if (r.exceptionDetails) errors.push('bundle: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  if (withRelay) { await page.evaluate(() => __standin.openBridge(true)); await wait(1200); }
  return { page, errors };
}
const turn = (page, i, sp, t, ms) => page.evaluate(([i, sp, t]) => window.setTurn(i, sp, t), [i, sp, t]).then(() => wait(ms || 200));
const until = async (page, fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn)) return true; await wait(40); } return false; };
const msgs = (page) => page.evaluate(() => window.sentMessages.slice());
async function openCamera(page) {
  await page.evaluate(async () => {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const v = document.createElement('video'); v.muted = true; v.srcObject = s; v.style.cssText = 'position:fixed;right:0;top:0;width:160px'; document.body.appendChild(v);
    await v.play(); window.camVideo = v;
  });
}
const frame = (page) => page.evaluate(() => {
  const v = window.camVideo, c = document.createElement('canvas'); c.width = 640; c.height = 360;
  const g = c.getContext('2d'); g.drawImage(v, 0, 0, 640, 360);
  const d = g.getImageData(0, 0, 640, 360).data; let blue = 0, grey = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - 0x2f) < 30 && Math.abs(d[i + 1] - 0x6f) < 30 && Math.abs(d[i + 2] - 0xe4) < 30) blue++;
    if (Math.abs(d[i] - 0xc9) < 6 && Math.abs(d[i + 1] - 0xd0) < 6 && Math.abs(d[i + 2] - 0xda) < 6) grey++;
  }
  return { blue, grey };
});

console.log(`${stamp()} --- trigger phrase (no network) ---`);
{
  const { page, errors } = await session({}, false);
  check('script loads with no errors', errors.length === 0, errors[0]);
  const det = (t) => page.evaluate((x) => __standin.dataChart.detect(x), t);
  check('"stand-in, chart <topic>"', (await det('stand-in, chart India GDP growth since 2015')) === 'India GDP growth since 2015', await det('stand-in, chart India GDP growth since 2015'));
  check('"Eswar, show me the data on <topic>" (filler words dropped)', (await det('So Eswar, show me the data on world population.')) === 'world population', await det('So Eswar, show me the data on world population.'));
  check('"stand in plot <topic>" (caption spelling without a hyphen)', (await det('Stand in plot literacy rate in Kerala')) === 'literacy rate in Kerala', await det('Stand in plot literacy rate in Kerala'));
  check('the last request wins when two are said in one turn', (await det('stand-in chart oil prices. Actually stand-in chart gold prices')) === 'gold prices');
  check('ordinary talk is not a request', (await det('we should chart this later')) === '' && (await det('Eswar, did the report go out?')) === '' && (await det('show me the data')) === '');
  const html = await page.evaluate(() => __standin.dataChart.htmlToText('<style>.a{}</style><p>Text<sup>[1]</sup></p><table><tr><td>2019</td><td>120</td></tr></table>'));
  check('page text keeps table rows ("2019 | 120") and drops citations', /2019 \| 120/.test(html) && !/\[1\]/.test(html) && !/\.a\{/.test(html), JSON.stringify(html));
  const big = await page.evaluate(() => __standin.dataChart.summarise({ type: 'line', series: [{ name: 'x', points: [{ label: '2010', value: 1200000000 }, { label: '2023', value: 1400000000 }] }] }));
  check('big numbers are shortened in the summary (1.4B, 200M)', big === 'Peak: 1.4B in 2023. Latest: 1.4B in 2023, up 200M since 2010.', big);
  const plans = await page.evaluate(() => {
    const p = (o) => __standin.dataChart.parsePlan(JSON.stringify(o), 'topic').source;
    const good = { source: 'worldbank', indicator: 'NY.GDP.MKTP.KD.ZG', countries: ['IND'], from: 2015, to: 2024, title: 't' };
    return [
      p(good),
      p(Object.assign({}, good, { indicator: 'NY.GDP;rm -rf' })),
      p(Object.assign({}, good, { indicator: 'a/b' })),
      p(Object.assign({}, good, { countries: ['INDIA'] })),
      p(Object.assign({}, good, { countries: ['IND', 'CHN', 'USA', 'JPN'] })),
      p(Object.assign({}, good, { from: 1900 })),
      p(Object.assign({}, good, { to: 2999 })),
      p(Object.assign({}, good, { from: 1970, to: 2024 })),
      __standin.dataChart.parsePlan('not json', 'topic').source,
    ];
  });
  check('plan check: a good World Bank plan passes', plans[0] === 'worldbank');
  check('plan check: bad indicator, country code, too many countries or bad years all fall back to Wikipedia', plans.slice(1).every((x) => x === 'wikipedia'), JSON.stringify(plans));
  const v = await page.evaluate(() => {
    const text = '2019 | 120\n2020 | 135\n2021 | 150';
    const pts = (a) => ({ points: a });
    const ok = [{ label: '2019', value: 120, quote: '2019 | 120' }, { label: '2020', value: 135, quote: '2020 | 135' }, { label: '2021', value: 150, quote: '2021 | 150' }];
    const f = __standin.dataChart.validateExtract;
    return [
      f(pts(ok), text, 3).ok,
      f(pts(ok.map((p, i) => (i === 1 ? { label: '2020', value: 136, quote: '2020 | 135' } : p))), text, 3).ok,
      f(pts(ok.map((p, i) => (i === 1 ? { label: '2020', value: 999, quote: '2020 | 999' } : p))), text, 3).ok,
      f(pts(ok.slice(0, 2)), text, 3).ok,
      f(pts(ok.map((p) => ({ label: p.label, value: p.value, quote: '' }))), text, 3).ok,
      f({ points: [] }, text, 3).ok,
    ];
  });
  check('grounding check: only a series whose every number is quoted from the page passes', v[0] === true && v.slice(1).every((x) => x === false), JSON.stringify(v));
  await page.context().close();
}

console.log(`${stamp()} --- World Bank chart on the camera ---`);
let pageA;
{
  const { page } = await session();
  pageA = page;
  await openCamera(page);
  await wait(500);
  const idle = await frame(page);
  await turn(page, 0, 'Priya', 'stand-in, chart India GDP growth since 2018', 1500);
  check('someone else saying the phrase does nothing', seen.length === 0 && (await page.evaluate(() => __standin.chartHistory.length)) === 0);
  await turn(page, 1, 'You', 'Eswar, show me the data on India GDP growth since 2018', 100);
  const ok = await until(page, () => __standin.chartHistory.length === 1, 6000);
  check('your own speech: a chart is made', ok);
  const logs = await page.evaluate(() => __standin.logLines.slice());
  const iLook = logs.findIndex((l) => /camera frames: 1/.test(l)), iChart = logs.findIndex((l) => /camera frames: 2/.test(l));
  check('"Looking up public data" shows on the camera first, then the chart', iLook >= 0 && iChart > iLook, iLook + ' < ' + iChart);
  const h = await page.evaluate(() => __standin.chartHistory[0]);
  check('World Bank was asked for the right indicator, country and years (and nothing else)', seen.length === 1 && /api\.worldbank\.org\/v2\/country\/IND\/indicator\/NY\.GDP\.MKTP\.KD\.ZG\?.*date=2018:2023/.test(seen[0]), seen.join(' '));
  check('chart has 6 points (the empty year is dropped) and names its source on the slide', h.chart.type === 'line' && h.chart.series[0].points.length === 6 && h.chart.source === 'Source: World Bank, NY.GDP.MKTP.KD.ZG, 2018-2023', JSON.stringify(h.chart.source));
  check('summary is worked out from the numbers', h.summary === 'Peak: 9.7 in 2021. Latest: 8.2 in 2023, up 1.7 since 2018.', h.summary);
  await wait(300);
  const st = await page.evaluate(() => __standin.slides.state());
  const f1 = await frame(page);
  check('camera: the chart is on the picture (many more blue line pixels than the idle slide, and grid lines)', st.mode === 'show' && st.frames === 2 && st.i === 0 && f1.blue - idle.blue > 800 && f1.grey > 300, JSON.stringify(st) + ' idle=' + JSON.stringify(idle) + ' now=' + JSON.stringify(f1));
  const m = await msgs(page);
  check('chat: one labelled line with the source and the summary', m.length === 1 && /^\[AI stand-in for Eswar\] Chart on screen: India GDP growth\. World Bank \(NY\.GDP\.MKTP\.KD\.ZG, GDP growth \(annual %\)\)\. Peak: 9\.7 in 2021/.test(m[0]), m[0]);
  check('your own question-style speech is still not answered as a question', !m.some((x) => /I will confirm|Let me check/.test(x)));
  check('every data chart log line has a timestamp, and steps show n/5', logs.filter((l) => /data chart/.test(l)).every((l) => /^\d{4}-\d\d-\d\dT[\d:.]+[+-]\d\d:\d\d/.test(l)) && logs.some((l) => /\[3\/5\].*data checked/.test(l)) && logs.some((l) => /\[5\/5\].*done/.test(l)));
  await until(page, () => __standin.slides.state().i === 1, 4000);
  check('the camera then moves to the one-line summary', (await page.evaluate(() => __standin.slides.state().i)) === 1);
  await wait(3000);
  check('same topic said again (different words around it) is not charted twice', (await turn(page, 2, 'You', 'stand-in chart India GDP growth since 2018', 1500), seen.length === 1));
}

console.log(`${stamp()} --- panel ---`);
{
  const page = pageA;
  await page.fill('#standin-q', 'stand-in, chart India GDP growth since 2018'); await page.click('#standin-ask');
  const ok = await until(page, () => __standin.chartHistory.length === 2, 6000);
  check('typed chart phrase in the panel makes a chart (and always works, even for a repeat topic)', ok && seen.length === 2);
  check('panel shows the chart and its source', await page.evaluate(() => /Chart shown.*World Bank/.test(document.getElementById('standin-last').textContent)), await page.evaluate(() => document.getElementById('standin-last').textContent));
  await page.click('#standin-clear'); await wait(200);
  check('Clear camera puts the idle slide back at once', (await page.evaluate(() => __standin.slides.state().mode)) === 'idle');
  await page.context().close();
}

console.log(`${stamp()} --- fallback to Wikipedia, and refusing what it cannot check ---`);
{
  const { page } = await session();
  const before = seen.length;
  await turn(page, 0, 'You', 'stand-in, chart bad indicator test', 100);
  check('bad World Bank answer: falls back to Wikipedia and still charts', await until(page, () => __standin.chartHistory.length === 1, 8000));
  const h = await page.evaluate(() => __standin.chartHistory[0]);
  const urls = seen.slice(before);
  check('it tried World Bank first, then searched and read Wikipedia', /worldbank/.test(urls[0]) && /list=search/.test(urls[1]) && /action=parse/.test(urls[2]), urls.map((u) => new URL(u).hostname).join(','));
  check('Wikipedia chart: years become a line, 5 points, source names the page', h.chart.type === 'line' && h.chart.series[0].points.length === 5 && h.chart.source === 'Source: Wikipedia, Test rover page', JSON.stringify(h.chart.source) + ' ' + h.chart.type);
  check('summary from the page numbers', h.summary === 'Peak: 190 in 2023. Latest: 190 in 2023, up 70 since 2019.', h.summary);
  check('chat gives the Wikipedia address so people can check it', /en\.wikipedia\.org\/wiki\/Test_rover_page/.test((await msgs(page))[0]), (await msgs(page))[0]);
  await wait(5500);
  await turn(page, 1, 'You', 'stand-in, chart distance by sites', 100);
  check('names instead of years: a bar chart', await until(page, () => __standin.chartHistory.length === 2, 8000) && (await page.evaluate(() => __standin.chartHistory[0].chart.type)) === 'bar');
  check('bar summary: highest and lowest', (await page.evaluate(() => __standin.chartHistory[0].summary)) === 'Highest: Alpha (45). Lowest: Charlie (17).');
  await wait(5500);
  const msgsBefore = (await msgs(page)).length;
  await turn(page, 2, 'You', 'stand-in, chart fabricated rovers', 100);
  await until(page, () => __standin.logLines.some((l) => /no reliable data/.test(l)), 8000);
  const lg = await page.evaluate(() => __standin.logLines.filter((l) => /no reliable data/.test(l)).pop());
  check('a number that is not on the page is refused: no chart', (await page.evaluate(() => __standin.chartHistory.length)) === 2 && /quote not found/.test(lg), lg);
  check('nothing is posted to the chat for a refused chart', (await msgs(page)).length === msgsBefore);
  const msgFrame = await page.evaluate(() => __standin.slides.state());
  check('camera says no reliable data was found (one text slide)', msgFrame.mode === 'show' && msgFrame.frames === 1);
  const hosts = Array.from(new Set(seen.map((u) => new URL(u).hostname))).sort();
  check('only api.worldbank.org and en.wikipedia.org were ever requested', JSON.stringify(hosts) === JSON.stringify(['api.worldbank.org', 'en.wikipedia.org']), hosts.join(','));
  await page.context().close();
}

console.log(`${stamp()} --- relay not running ---`);
{
  const { page, errors } = await session({ autoRelay: false }, false);
  await turn(page, 0, 'You', 'stand-in, chart India GDP growth since 2018', 100);
  await until(page, () => __standin.logLines.some((l) => /relay not found, cannot look up data/.test(l)), 5000);
  check('no relay: says so on the camera and in the log, no crash', (await page.evaluate(() => __standin.slides.state().frames)) === 1 && errors.length === 0 && (await page.evaluate(() => __standin.chartHistory.length)) === 0, errors[0]);
  await page.context().close();
}

console.log(`${stamp()} --- data chart can be switched off ---`);
{
  const { page } = await session({ dataChart: false });
  const before = seen.length;
  await turn(page, 0, 'You', 'stand-in, chart India GDP growth since 2018', 1500);
  check('dataChart:false ignores the phrase', seen.length === before && (await page.evaluate(() => __standin.chartHistory.length)) === 0);
  await page.context().close();
}

await browser.close(); meet.close(); relaySrv.closeAllConnections(); relaySrv.close();
console.log(`\n${stamp()} ${n - fails.length}/${n} passed`); fails.forEach((f) => console.log('  FAIL ' + f));
process.exit(fails.length ? 1 : 0);
