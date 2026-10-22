// End-to-end test: loads the real extension in Chromium, joins a fake "call" page, asks questions,
// then checks the pictures and sound the call receives. No network, no API key, no cost.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extSrc = path.join(here, '..', 'extension');
const stamp = () => new Date().toISOString();

// Test copy of the extension that also runs on localhost (the real one runs only on Meet).
const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'standin-ext-'));
fs.cpSync(extSrc, extDir, { recursive: true });
const mf = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
mf.content_scripts.forEach((c) => c.matches.push('http://localhost/*'));
fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(mf));

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  // Same rule Meet enforces: innerHTML and similar are blocked. Keeps us honest.
  res.setHeader('content-security-policy', "require-trusted-types-for 'script'");
  res.end(fs.readFileSync(path.join(here, 'call.html')));
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;

const results = [];
let planned = 0;
const TOTAL = 29;
function check(name, pass, detail) {
  results.push({ name, pass });
  planned++;
  console.log(`${stamp()} [${planned}/${TOTAL}] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
}
const range = (xs) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);
const heads = (s) => s.filter((p) => p.head);

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'standin-prof-')), {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ],
});
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.text().includes('[standin]')) console.log('   page: ' + m.text());
});
await page.goto(url);
await page.evaluate(() => { __standin.config.override = false; });
await page.waitForFunction(() => window.__standin && window.__standin.config);

// Scenario helper: ask while recording what the call receives.
async function scenario(text, ms = 2600) {
  return page.evaluate(
    async ([t, ms]) => {
      const rec = testRig.record(ms, 50);
      const res = await __standin.ask(t, '');
      const sub = __standin.avatar.subtitle;
      const samples = await rec;
      if (__standin.lastSpeech) await __standin.lastSpeech.catch(() => {});
      await new Promise((r) => setTimeout(r, 50));
      return { res, sub, samples, subAfter: __standin.avatar.subtitle };
    },
    [text, ms]
  );
}

// ---- Setup ----
await page.evaluate(() => {
  const NS = __standin;
  NS.config.duplicateWindowMs = 0;
  NS.config.threshold = 75;
  NS.config.brain = 'stub';
  NS.config.autoRelay = false;
  NS.config.stubRules = [
    { when: 'go ahead', answer: 'yes', confidence: 90, reason: 'The plan is signed off.' },
    { when: 'refund', answer: 'no', confidence: 88, reason: 'Refunds need finance approval.' },
    { when: 'budget', answer: 'yes', confidence: 55, reason: 'I think so.' },
    { when: 'dashboard live', answer: 'yes', confidence: 92, reason: 'It was published yesterday.' },
  ];
  window.__held = 0;
  NS.events.addEventListener('held', () => window.__held++);
});

// 1-4 Camera and mic reach the call
const joined = await page.evaluate(() => testRig.join({ video: true, audio: true }));
check('call receives one video and one audio track', joined.video === 1 && joined.audio === 1, JSON.stringify(joined));
check('both tracks are live', joined.vState === 'live' && joined.aState === 'live');
await page.waitForTimeout(500);
const label = await page.evaluate(() => {
  const v = document.getElementById('v'), c = document.getElementById('c');
  const x = c.getContext('2d'); x.drawImage(v, 0, 0, c.width, c.height);
  const p = x.getImageData(16, 335, 1, 1).data; return [p[0], p[1], p[2]];
});
check('"AI stand-in" label is visible in the picture the call receives', Math.abs(label[0] - 255) < 12 && Math.abs(label[1] - 210) < 12 && Math.abs(label[2] - 63) < 20, JSON.stringify(label));
const panel = await page.evaluate(() => {
  const h = document.getElementById('standin-panel');
  return { built: !!h, text: h && h.shadowRoot ? h.shadowRoot.textContent : '', status: typeof __standin.status === 'function' };
});
check('control panel builds on a page that blocks innerHTML (like Meet)', panel.built && /AI stand-in/.test(panel.text));
check('start-up finished (status available, captions listening)', panel.status);
const idle = await page.evaluate(() => testRig.record(1500, 50));
check('idle: head stays put (only breathing)', range(heads(idle).map((p) => p.head.y)) < 8 && range(heads(idle).map((p) => p.head.x)) < 8, 'y range ' + range(heads(idle).map((p) => p.head.y)).toFixed(1));
check('idle: mic is silent', Math.max(...idle.map((p) => p.loud)) < 0.005);

// 5-12 Yes: nod, voice, disclosure, subtitle
const yes = await scenario('Eswar, should we go ahead with this?');
const yh = heads(yes.samples);
check('yes: decision is yes at 90%', yes.res.decision.answer === 'yes' && yes.res.decision.confidence === 90);
check('yes: action is nod', yes.res.action === 'nod');
check('yes: head moves up and down', range(yh.map((p) => p.head.y)) > 15 && range(yh.map((p) => p.head.x)) < 8, 'y range ' + range(yh.map((p) => p.head.y)).toFixed(1));
check('yes: call hears speech', Math.max(...yes.samples.map((p) => p.loud)) > 0.02, 'peak ' + Math.max(...yes.samples.map((p) => p.loud)).toFixed(3));
check('yes: first reply says it is an AI stand-in', yes.res.line.startsWith('I am an AI stand-in for Eswar.') && yes.res.disclosed === true);
check('yes: subtitle shows while speaking, then clears', yes.sub.length > 5 && yes.subAfter === '', yes.sub);
check('yes: decided and acted within the 3 s target', yes.res.actedMs < 3000, yes.res.actedMs + ' ms');

// 13-14 No: shake, no second disclosure
await page.waitForTimeout(300);
const no = await scenario('Eswar, can we approve this refund today?');
const nh = heads(no.samples);
check('no: head turns side to side', no.res.action === 'shake' && range(nh.map((p) => p.head.x)) > 12 && range(nh.map((p) => p.head.y)) < 8, 'x range ' + range(nh.map((p) => p.head.x)).toFixed(1));
check('no: disclosure not repeated', no.res.line.startsWith('No. ') && !no.res.disclosed);

// 15-16 Low confidence: held
await page.waitForTimeout(300);
const low = await scenario('Eswar, is the budget approved?', 2200);
check('low confidence (55% < 75%): held, no nod or shake', low.res.action === 'held' && range(heads(low.samples).map((p) => p.head.y)) < 8 && range(heads(low.samples).map((p) => p.head.x)) < 8);
check('low confidence: says it will confirm later and tells the phone side', low.res.line === 'I will confirm after the meeting.' && (await page.evaluate(() => window.__held)) >= 1);

// 17-19 Not for me / open question / duplicate
await page.waitForTimeout(300);
const other = await scenario('Rahul, should we go ahead with this?', 1000);
check('question for someone else: ignored, silent', other.res.handled === false && Math.max(...other.samples.map((p) => p.loud)) < 0.005);
const open = await scenario('Eswar, what do you think about the timeline?', 2200);
check('open question: held, not guessed', open.res.handled && open.res.action === 'held' && open.res.kind === 'open');
await page.evaluate(() => { __standin.config.duplicateWindowMs = 15000; });
await page.waitForTimeout(300);
await scenario('Eswar, is the dashboard live?', 2200);
const dup = await page.evaluate(() => __standin.ask('Eswar, is the dashboard live?', ''));
check('same question twice: second is ignored', dup.handled === false && dup.reason === 'duplicate');
await page.evaluate(() => { __standin.config.duplicateWindowMs = 0; });

// 20-22 Claude brain wiring (mocked transport, so no key and no cost)
await page.waitForTimeout(300);
const llm = await page.evaluate(async () => {
  const NS = __standin;
  NS.config.brain = 'claude';
  NS.config.contextPack = 'PACK: demo plan signed off on 20 Oct.';
  let body = null;
  NS.llm = async (b) => { body = b; return 'Sure: {"answer":"yes","confidence":88,"reason":"The demo plan was signed off."}'; };
  const ok = await NS.ask('Eswar, can we ship the demo?', 'Asha: any blockers?');
  await NS.lastSpeech;
  NS.llm = async () => { throw new Error('offline'); };
  const fail = await NS.ask('Eswar, can we ship it tomorrow?', '');
  await NS.lastSpeech;
  NS.llm = async () => 'not json at all';
  const junk = await NS.ask('Eswar, can we ship it today?', '');
  await NS.lastSpeech;
  return { ok, fail, junk, prompt: body && JSON.stringify(body) };
});
check('claude brain: prompt carries the context pack, the question and the model name', llm.prompt.includes('PACK: demo plan') && llm.prompt.includes('can we ship the demo') && llm.prompt.includes('claude-sonnet-5-5'));
check('claude brain: reads the JSON answer and acts on it', llm.ok.action === 'nod' && llm.ok.decision.confidence === 88);
check('claude brain: if Claude is unreachable or unreadable, it holds', llm.fail.action === 'held' && llm.junk.action === 'held');

// Relay brain (a mock relay stands in for relay.ps1)
await page.waitForTimeout(300);
// 0.6 s test tone as a wav file, standing in for the Windows voice
const wavBytes = (() => { const sr = 8000, n = 4800, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 9000), 44 + i * 2); return b; })();
const bridgeHtml = fs.readFileSync(path.join(here, 'relay-bridge.html'), 'utf8').replace('__ALLOWED_ORIGIN__', new URL(url).origin);
const relaySrv = http.createServer((req, res) => {
  // Same shape as relay.ps1: no CORS headers at all. Only the bridge page can reach /decide.
  if (req.url === '/bridge') { res.setHeader('content-type', 'text/html'); return res.end(bridgeHtml); }
  if (req.method !== 'POST') { res.statusCode = 404; return res.end(); }
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/tts') return res.end(JSON.stringify({ wav: wavBytes.toString('base64') }));
    const q = JSON.parse(b).question;
    res.end(JSON.stringify(/slow/.test(q) ? { answer: 'yes', confidence: 60, reason: 'Not sure.' } : { answer: 'no', confidence: 93, reason: 'The notes say no.' }));
  });
});
await new Promise((r) => relaySrv.listen(8765, '127.0.0.1', r));
const rel = await page.evaluate(async () => {
  const NS = __standin;
  NS.config.brain = 'stub'; NS.config.autoRelay = true; NS.config.relayUrl = 'http://127.0.0.1:8765';
  NS.openBridge(true); await new Promise((r) => setTimeout(r, 800));
  const a = await NS.ask('Eswar, are you planning a prompt-injection demo?', ''); await NS.lastSpeech;
  const b = await NS.ask('Eswar, is the slow report ready?', ''); await NS.lastSpeech;
  return { a, b };
});
check('relay: live brain answers through the laptop relay', rel.a.decision.answer === 'no' && rel.a.decision.confidence === 93 && rel.a.action === 'shake', JSON.stringify(rel.a.decision));
const voice = await page.evaluate(async () => { const NS = __standin; NS.config.realVoice = true; return await NS.speak('Yes. The plan is signed off.'); });
check('real voice: the relay voice is played (0.6 s tone, not the dummy babble)', Math.abs(voice - 0.6) < 0.05, String(voice));
check('relay: low confidence from the relay is held', rel.b.action === 'held');
relaySrv.closeAllConnections(); await new Promise((r) => relaySrv.close(r));
const down = await page.evaluate(async () => {
  const NS = __standin; NS.config.brain = 'relay';
  const r = await NS.ask('Eswar, can we ship the other thing?', ''); await NS.lastSpeech; return r;
});
check('relay stopped: holds instead of guessing', down.action === 'held' && /not reachable/.test(down.decision.reason));
await page.evaluate(() => { __standin.config.brain = 'stub'; __standin.config.autoRelay = false; });

// Manual override: held yes/no question -> panel buttons -> click Yes -> avatar nods
const ovr = await page.evaluate(async () => {
  const NS = __standin; NS.config.brain = 'stub'; NS.config.autoRelay = false; NS.config.override = true; NS.config.overrideWaitMs = 3000;
  const shown = new Promise((r) => NS.events.addEventListener('override-request', () => r(true), { once: true }));
  const a = await NS.ask('Eswar, is the office plant watered?', ''); // no rule matches: held
  const aAction = a.action;
  await shown;
  const visible = /Asked: Eswar, is the office plant watered/.test(document.getElementById('standin-panel').shadowRoot.textContent) ? 'shown' : 'none';
  NS.override('yes');
  await NS.lastOverride; await NS.lastSpeech;
  const yes = { pose: NS.avatar.pose, action: NS.history[0].action, line: NS.history[0].line };
  // second: nobody clicks
  const b = await NS.ask('Eswar, is the lift working today?', '');
  await NS.lastOverride; await NS.lastSpeech;
  return { a: aAction, visible, yes, b: b.action, bOverride: NS.history[0].override };
});
check('override: a held yes/no question shows Yes/No buttons, a click makes the avatar answer', ovr.a === 'held' && ovr.visible !== 'none' && ovr.yes.action === 'nod', JSON.stringify(ovr));
check('override: no click in time falls back to "I will confirm after the meeting."', ovr.b === 'held' && ovr.bOverride === 'no reply', JSON.stringify(ovr));
await page.evaluate(() => { __standin.config.override = false; });

// Recorded clips: red idle, green nod, blue shake (test files). The camera frame must show them instead of the drawn head.
const clipB64 = Object.fromEntries(['idle', 'nod', 'shake'].map((n) => [n, fs.readFileSync(path.join(here, 'clips', n + '.webm')).toString('base64')]));
const clipRes = await page.evaluate(async (b64) => {
  const NS = __standin;
  for (const n of Object.keys(b64)) {
    const bytes = Uint8Array.from(atob(b64[n]), (c) => c.charCodeAt(0));
    await NS.avatar.loadClip(n, new Blob([bytes], { type: 'video/webm' }));
  }
  const v = document.createElement('video'); v.muted = true; v.srcObject = NS.videoStream(); await v.play();
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const g = c.getContext('2d');
  const px = async () => { await new Promise((r) => setTimeout(r, 400)); g.drawImage(v, 0, 0, 1280, 720); const d = g.getImageData(640, 300, 1, 1).data; return [d[0], d[1], d[2]]; };
  const idle = await px();
  NS.avatar.setPose('nod'); const nod = await px();
  await new Promise((r) => setTimeout(r, 2600));
  NS.avatar.setPose('shake'); const shake = await px();
  await new Promise((r) => setTimeout(r, 2600));
  const back = await px();
  const g2 = g.getImageData(60, 700 - 50, 1, 1).data; // label pill must still be on top
  NS.avatar.clearClips();
  return { idle, nod, shake, back, label: [g2[0], g2[1], g2[2]] };
}, clipB64);
const near = (a, r, gg, b) => Math.abs(a[0] - r) < 60 && Math.abs(a[1] - gg) < 60 && Math.abs(a[2] - b) < 60;
check('clips: idle clip (red) replaces the drawn head', near(clipRes.idle, 255, 0, 0), JSON.stringify(clipRes));
check('clips: nod clip (green) plays on a nod, shake clip (blue) on a shake, then back to idle', near(clipRes.nod, 0, 128, 0) && near(clipRes.shake, 0, 0, 255) && near(clipRes.back, 255, 0, 0), JSON.stringify(clipRes));
check('clips: the yellow AI stand-in label stays on top of the clip', near(clipRes.label, 255, 210, 63), JSON.stringify(clipRes));

// 23 Captions
await page.waitForTimeout(300);
const cap = await page.evaluate(async () => {
  const NS = __standin;
  NS.config.brain = 'stub';
  NS.config.captionDebounceMs = 300;
  const before = NS.history.length;
  document.getElementById('caps').textContent = 'Asha: Thanks all. Eswar, is the dashboard live?';
  await new Promise((r) => setTimeout(r, 1500));
  return { grew: NS.history.length - before, q: NS.history[0] && NS.history[0].question };
});
check('captions: a question typed into the captions region is picked up', cap.grew === 1 && /dashboard live/.test(cap.q), JSON.stringify(cap));

// 24 Switch off: the real devices are used
await page.evaluate(() => { localStorage.setItem('standin.config', JSON.stringify({ enabled: false })); });
await page.reload();
await page.waitForFunction(() => window.__standin && window.__standin.config);
const off = await page.evaluate(() => testRig.join({ video: true, audio: true }));
check('switched off: Meet gets the real (here: fake test) devices', /fake/i.test(off.vLabel || ''), off.vLabel);

await ctx.close();
server.close();
fs.rmSync(extDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
console.log(`\n${stamp()} Result: ${results.length - failed.length}/${results.length} passed`);
failed.forEach((f) => console.log('  FAILED: ' + f.name));
process.exit(failed.length ? 1 : 0);
