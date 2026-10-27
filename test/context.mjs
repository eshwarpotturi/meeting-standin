// Test of the context folder: every file is available, and each question gets only the relevant pieces. Mock Meet page and mock relay, no network.
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

const meet = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.setHeader('content-security-policy', "require-trusted-types-for 'script'"); res.end(fs.readFileSync(path.join(here, 'meet-mock.html'))); });
await new Promise((r) => meet.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${meet.address().port}/`;

// Made-up notes: a core file, three projects and one big file, so the model cannot be given everything.
const filler = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} of the long archive. It talks about quarterly planning, travel claims and room bookings, number ${i}.`).join('\n\n');
const FILES = [
  { file: '00-about-me.md', text: 'Eswar is a Senior Business Analyst on the Innovation Team. Rule: answer only from the notes.' },
  { file: 'projects/release-second-opinion.md', text: '---\nname: x\ndescription: Veeva Vault release risk ratings study\n---\n\nVeeva rarely changes its mind. 91 of 2,547 features (3.6%) were revised after publishing.\n\nWhen it does, it usually lowers the risk: 86 of 121 revisions (71%).' },
  { file: 'projects/transformer-plant-twin.md', text: '# Transformer plant twin\n\nA digital twin of a transformer factory with an agent that makes policy governed decisions. Built as a GitHub Pages demo.' },
  { file: 'projects/the-heist.md', text: '# The Heist\n\nOne AI guards a vault while other models try to talk their way in. Cross vendor rerun on LLM Foundry.' },
  { file: 'archive/long-archive.md', text: filler },
];
let contextOn = true;
const calls = [];
const relaySrv = http.createServer((req, res) => {
  if (req.url === '/bridge') { res.setHeader('content-type', 'text/html'); return res.end(fs.readFileSync(path.join(here, 'relay-bridge.html'), 'utf8').replace('__ALLOWED_ORIGIN__', base.replace(/\/$/, ''))); }
  if (req.method !== 'POST') { res.statusCode = 404; return res.end(); }
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    const body = JSON.parse(b || '{}');
    if (req.url === '/context') { calls.push({ url: '/context' }); if (!contextOn) { res.statusCode = 404; return res.end('{"error":"not found"}'); } return res.end(JSON.stringify({ files: FILES })); }
    if (req.url === '/answer' && /fluff/.test(body.question)) return res.end(JSON.stringify({ answer: 'open', confidence: 95, chat: 'The Veeva project is progressing well with key milestones being met.', slides: [{ title: 'Status', text: 'Going well.' }], chart: null }));
    if (req.url === '/answer' && /invented/.test(body.question)) return res.end(JSON.stringify({ answer: 'open', confidence: 95, chat: 'Veeva revised 12.5% of its features, mostly in Safety.', slides: [{ title: 'Veeva', text: '12.5%' }], chart: null }));
    if (req.url === '/answer') { calls.push({ url: '/answer', pack: body.pack }); return res.end(JSON.stringify({ answer: 'open', confidence: 90, chat: 'Veeva revised 3.6% of its features.', slides: [{ title: 'Veeva', text: '3.6% revised.' }], chart: null })); }
    if (req.url === '/decide') { calls.push({ url: '/decide', pack: body.pack }); return res.end(JSON.stringify({ answer: 'yes', confidence: 90, reason: 'The notes say so.' })); }
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise((r) => relaySrv.listen(8767, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
async function session(extra) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((cfg) => { localStorage.setItem('standin.config', JSON.stringify(Object.assign({ brain: 'stub', autoRelay: true, relayUrl: 'http://127.0.0.1:8767', captionDebounceMs: 150, duplicateWindowMs: 3000, userName: 'Eswar', slideStepMs: 1500, slideHoldMs: 3500, contextRefreshMs: 1000 }, cfg))); }, extra || {});
  await page.goto(base);
  const cdp = await ctx.newCDPSession(page);
  const r = await cdp.send('Runtime.evaluate', { expression: bundle });
  if (r.exceptionDetails) errors.push('bundle: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  await page.evaluate(() => __standin.openBridge(true)); await wait(1200);
  return { page, errors };
}
const turn = (page, i, sp, t, ms) => page.evaluate(([i, sp, t]) => window.setTurn(i, sp, t), [i, sp, t]).then(() => wait(ms || 200));
const until = async (page, fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn)) return true; await wait(40); } return false; };
const msgs = (page) => page.evaluate(() => window.sentMessages.slice());

console.log(`${stamp()} --- picking the right pieces (no relay needed) ---`);
{
  const { page, errors } = await session();
  check('script loads with no errors', errors.length === 0, errors[0]);
  const r = await page.evaluate((files) => {
    const C = __standin.context; C.build(files);
    const p = (q) => C.pick(q, '');
    return { viva: p('How is the Viva project going?'), twin: p('Tell me about the transformer factory'), heist: p('what is the vault demo'), none: p('what is the weather like in Paris'), small: C.pick('How is the Veeva project going?', '', 1500), match: [C.match('viva', 'veeva'), C.match('transformers', 'transformer'), C.match('heist', 'banana')], info: C.info() };
  }, FILES);
  check('all files are indexed, long files split into pieces', r.info.files === 5 && r.info.pieces > 10, JSON.stringify(r.info));
  check('a misheard word still finds the project ("Viva" finds the Veeva notes)', r.viva.used.includes('projects/release-second-opinion.md') && /91 of 2,547/.test(r.viva.pack), r.viva.used.join(','));
  check('the always-included core file (name starts with 00) is in every pack', [r.viva, r.twin, r.heist, r.none].every((x) => x.used.includes('00-about-me.md')));
  check('another question finds another project and leaves the Veeva one out', r.twin.used.includes('projects/transformer-plant-twin.md') && !r.twin.used.includes('projects/release-second-opinion.md'), r.twin.used.join(','));
  check('a question by topic words finds the right file ("vault demo" finds The Heist)', r.heist.used.includes('projects/the-heist.md'), r.heist.used.join(','));
  check('a question that matches nothing gets only the core file, not the whole archive', r.none.used.join(',') === '00-about-me.md' && r.none.chars < 1500, r.none.used.join(',') + ' ' + r.none.chars);
  check('the pack stays within the size limit, and says which files exist', r.small.chars <= 2800 && /Files available: .*the-heist\.md/.test(r.viva.pack), String(r.small.chars));
  check('word matching: sounds-alike and one-typo words match, unrelated words do not', r.match[0] > 0 && r.match[1] > 0 && r.match[2] === 0, JSON.stringify(r.match));
  await page.context().close();
}

console.log(`${stamp()} --- a spoken question uses the folder ---`);
{
  const { page } = await session();
  await turn(page, 0, 'Anand', 'Eswar, how is the Viva project going?', 100);
  const ok = await until(page, () => window.sentMessages.length >= 1, 8000);
  check('the question is answered in the chat', ok && /Veeva revised 3\.6%/.test((await msgs(page))[0]), (await msgs(page))[0]);
  const a = calls.filter((c) => c.url === '/answer').pop();
  check('the relay got the relevant notes with the question (Veeva study, core file), not the long archive', a && /91 of 2,547/.test(a.pack) && /Senior Business Analyst/.test(a.pack) && !/Paragraph 12 of the long archive/.test(a.pack) && a.pack.length < 9500, a && a.pack.length + '');
  check('the relay was asked for the folder once, not for every question', calls.filter((c) => c.url === '/context').length === 1, calls.map((c) => c.url).join(' '));
  const lg = await page.evaluate(() => __standin.logLines.filter((l) => /context:/.test(l)));
  check('log shows the folder load and what each question used, with timestamps', lg.length >= 2 && lg.every((l) => /^\d{4}-\d\d-\d\dT/.test(l)) && /release-second-opinion/.test(lg.join(' ')), lg.join(' | ').slice(0, 300));
  await page.context().close();
}

console.log(`${stamp()} --- check notes (panel button and standin.explain) ---`);
{
  const { page } = await session();
  await page.fill('#standin-q', 'Eswar, how is the Viva project going?'); await page.click('#standin-notes');
  const ok = await until(page, () => /files loaded/.test(document.getElementById('standin-notes').parentElement.textContent), 6000);
  const t = await page.evaluate(() => document.getElementById('standin-notes').parentElement.textContent);
  check('Check notes button says how many files are loaded and which ones this question would use', ok && /5 files loaded/.test(t) && /release-second-opinion\.md/.test(t), t);
  const r = await page.evaluate(() => standin.explain('what is the vault demo'));
  check('standin.explain returns the files used and the text that would be sent', r.ok && r.used.includes('projects/the-heist.md') && /The Heist/.test(r.pack), JSON.stringify(r.used));
  await page.context().close();
}

console.log(`${stamp()} --- vague or invented answers are held ---`);
{
  const { page } = await session();
  await turn(page, 0, 'Anand', 'Eswar, how is the fluff Veeva project going?', 100);
  await until(page, () => window.sentMessages.length >= 1, 8000);
  let m = await msgs(page);
  check('a generic status line ("progressing well, key milestones") is not posted; it says it will confirm', m.length === 1 && /I will confirm after the meeting/.test(m[0]) && !/progressing/.test(m[0]), m[0]);
  await wait(3300);
  await turn(page, 1, 'Anand', 'Eswar, what is the invented Veeva ratings story?', 100);
  await until(page, () => window.sentMessages.length >= 2, 8000);
  m = await msgs(page);
  check('an answer with a number that is not in the notes (12.5%) is held', m.length === 2 && /I will confirm after the meeting/.test(m[1]) && !/12\.5/.test(m[1]), m[1]);
  await wait(3300);
  await turn(page, 2, 'Anand', 'Eswar, how is the Veeva project going?', 100);
  await until(page, () => window.sentMessages.length >= 3, 8000);
  m = await msgs(page);
  check('a specific answer backed by the notes (3.6%, Veeva) is still posted', /Veeva revised 3\.6%/.test(m[2]), m[2]);
  await page.context().close();
}

console.log(`${stamp()} --- old relay without /context ---`);
{
  contextOn = false;
  const { page, errors } = await session();
  await turn(page, 0, 'Anand', 'Eswar, how is the Viva project going?', 100);
  const ok = await until(page, () => window.sentMessages.length >= 1, 8000);
  const a = calls.filter((c) => c.url === '/answer').pop();
  check('no /context on the relay: question still works and the relay uses its own notes file (no pack sent)', ok && a.pack === null && errors.length === 0, String(a && a.pack));
  await page.context().close();
}

await browser.close(); meet.close(); relaySrv.closeAllConnections(); relaySrv.close();
console.log(`\n${stamp()} ${n - fails.length}/${n} passed`); fails.forEach((f) => console.log('  FAIL ' + f));
process.exit(fails.length ? 1 : 0);
