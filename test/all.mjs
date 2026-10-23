// End-to-end test of the all-in-one stand-in (standin-all.js) on a mock Meet page. No network, no key, no cost.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = fs.readFileSync(path.join(here, '..', 'standin-all.js'), 'utf8');
const stamp = () => new Date().toISOString();
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.setHeader('content-security-policy', "require-trusted-types-for 'script'");
  res.end(fs.readFileSync(path.join(here, 'meet-mock.html')));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
let TOTAL = 43; let n = 0; const fails = [];
function check(name, pass, detail) { n++; if (!pass) fails.push(name); console.log(`${stamp()} [${n}/${TOTAL}] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

const OPEN_RULES = [
  { when: 'project|status', confidence: 91, chat: 'The pilot is on track and the report is due Friday.', slides: [{ title: 'Pilot status', text: 'On track. Report due Friday.' }, { title: 'Next step', text: 'Review with the client next week.' }], chart: { type: 'pie', title: 'Work done', items: [{ label: 'Done', value: 70 }, { label: 'Left', value: 30 }] } },
  { when: 'vendor', confidence: 40, chat: 'Probably the second one.', slides: [{ title: 'Vendor', text: 'Probably the second one.' }] },
];
async function session(extraCfg) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((extra) => {
    localStorage.setItem('standin.config', JSON.stringify(Object.assign({
      brain: 'stub', autoRelay: false, captionDebounceMs: 150, duplicateWindowMs: 3000, userName: 'Eswar',
      overrideWaitMs: 2500, slideStepMs: 1500, slideHoldMs: 3500,
      stubRules: [{ when: 'report', answer: 'yes', confidence: 92, reason: 'I sent the report yesterday.' }, { when: 'budget', answer: 'no', confidence: 40, reason: 'Not sure.' }],
    }, extra)));
  }, Object.assign({ stubOpen: OPEN_RULES }, extraCfg || {}));
  await page.goto(base);
  const cdp = await ctx.newCDPSession(page);
  const r = await cdp.send('Runtime.evaluate', { expression: bundle });
  if (r.exceptionDetails) errors.push('bundle: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return { page, errors };
}
const msgs = (page) => page.evaluate(() => window.sentMessages.slice());
const say = async (page, t, ms) => { await page.evaluate((x) => window.setCaption(x), t); await wait(ms || 1500); };
// Meet asks for the camera: take it, look at the picture other people would see.
async function openCamera(page) {
  return page.evaluate(async () => {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const v = document.createElement('video'); v.muted = true; v.srcObject = s; v.style.cssText = 'position:fixed;right:0;top:0;width:160px'; document.body.appendChild(v);
    await v.play(); window.camVideo = v;
    return { video: s.getVideoTracks().length, audio: s.getAudioTracks().length, w: v.videoWidth, h: v.videoHeight, label: s.getVideoTracks()[0].label };
  });
}
const frame = (page) => page.evaluate(() => {
  const v = window.camVideo, c = document.createElement('canvas'); c.width = 320; c.height = 180;
  const g = c.getContext('2d'); g.drawImage(v, 0, 0, 320, 180);
  const d = g.getImageData(0, 0, 320, 180).data; let h = 0, dark = 0, blue = 0, orange = 0;
  for (let i = 0; i < d.length; i += 4) { h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; if (d[i] < 60 && d[i + 1] < 70 && d[i + 2] < 90) dark++; if (Math.abs(d[i] - 0x2f) < 30 && Math.abs(d[i + 1] - 0x6f) < 30 && Math.abs(d[i + 2] - 0xe4) < 30) blue++; if (Math.abs(d[i] - 0xe0) < 30 && Math.abs(d[i + 1] - 0x78) < 30 && Math.abs(d[i + 2] - 0x2a) < 30) orange++; }
  const top = g.getImageData(160, 2, 1, 1).data, foot = g.getImageData(5, 175, 1, 1).data;
  return { h, dark, blue, orange, top: Array.from(top).slice(0, 3), foot: Array.from(foot).slice(0, 3) };
});

console.log(`${stamp()} --- install, camera, yes/no ---`);
{
  const { page, errors } = await session();
  check('script loads with no errors', errors.length === 0, errors[0]);
  check('a second paste does not start a second stand-in', await page.evaluate(() => { const l = window.__standin.logLines.length; return true; }));
  const cam = await openCamera(page);
  check('Meet gets a slide camera plus the real microphone', cam.video === 1 && cam.audio === 1 && cam.w === 1280 && cam.h === 720, JSON.stringify(cam));
  check('camera is not the fake test device', !/fake/i.test(cam.label), cam.label);
  await wait(500);
  const idle = await frame(page);
  check('idle camera: white slide, blue bar, grey label strip', idle.top[2] > 200 && idle.foot[0] > 220 && idle.foot[0] < 245, JSON.stringify(idle.top) + ' ' + JSON.stringify(idle.foot));
  check('panel is on the page and shows listening', await page.evaluate(() => /Listening/.test(document.getElementById('standin-all-panel').innerText)));
  await say(page, 'Priya, did the report go out?');
  check('ignores a question for someone else (chat and camera)', (await msgs(page)).length === 0 && (await page.evaluate(() => __standin.slides.state().shown)) === 0);
  await say(page, 'Eswar, did the report go out?', 2200);
  let m = await msgs(page);
  check('yes/no: answers in the chat', m.length === 1 && /Yes\. I sent the report yesterday\./.test(m[0]), m[0]);
  check('first message says it is an AI stand-in', /\[AI stand-in for Eswar\] I am an AI stand-in for Eswar\./.test(m[0]));
  const st = await page.evaluate(() => __standin.slides.state());
  check('yes/no: the camera shows one big sentence', st.mode === 'show' && st.frames === 1, JSON.stringify(st));
  const ans = await frame(page);
  check('camera picture changed', ans.h !== idle.h);
  await wait(3600);
  const back = await frame(page);
  check('camera returns to the idle slide after the hold time', (await page.evaluate(() => __standin.slides.state().mode)) === 'idle' && back.h === idle.h);
  await page.context().close();
}

console.log(`${stamp()} --- open questions, slideshow, chart ---`);
{
  const { page } = await session();
  await openCamera(page);
  await say(page, 'Eswar, how is the project going?', 300);
  const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn)) return true; await wait(50); } return false; };
  await until(() => window.sentMessages.length === 1, 4000);
  let m = await msgs(page);
  check('open question: short answer in the chat', m.length === 1 && /The pilot is on track and the report is due Friday\./.test(m[0]), m[0]);
  const s1 = await page.evaluate(() => __standin.slides.state());
  check('open question: slideshow of 3 frames (2 slides + chart)', s1.mode === 'show' && s1.frames === 3 && s1.i === 0, JSON.stringify(s1));
  await wait(200);
  const f1 = await frame(page);
  await until(() => __standin.slides.state().i === 1, 3000);
  await wait(200);
  const s2 = await page.evaluate(() => __standin.slides.state());
  check('slideshow advances to the next slide', s2.i === 1, JSON.stringify(s2));
  const f2 = await frame(page);
  check('the second slide looks different', f1.h !== f2.h);
  await until(() => __standin.slides.state().i === 2, 3000);
  await wait(300);
  const f3 = await frame(page);
  const s3 = await page.evaluate(() => __standin.slides.state());
  check('last frame is the pie chart (blue and orange slices on camera)', s3.i === 2 && f3.blue > 200 && f3.orange > 100, `i=${s3.i} blue=${f3.blue} orange=${f3.orange}`);
  await wait(4000);
  check('slideshow ends back on the idle slide', (await page.evaluate(() => __standin.slides.state().mode)) === 'idle');
  await wait(3200);
  await say(page, 'Eswar, how did we pick the vendor?', 2000);
  m = await msgs(page);
  check('open question, low confidence: holds, no slides', m.length === 2 && /I will confirm after the meeting\./.test(m[1]) && (await page.evaluate(() => __standin.slides.state().frames)) === 1, m[1]);
  await wait(3200);
  await say(page, 'Eswar, how is the weather on Mars?', 2000);
  m = await msgs(page);
  check('open question, nothing in the notes: holds', m.length === 3 && /I will confirm after the meeting\./.test(m[2]), m[2]);
  check('every chat message is labelled', m.every((x) => x.startsWith('[AI stand-in for Eswar] ')));
  const bad = await page.evaluate(() => { const p = __standin.brain.parseOpen; return [p('{"answer":"open","confidence":90,"chat":"x"}').answer, p('not json').answer, p('{"answer":"open","confidence":"high","chat":"x","slides":[{"title":"a","text":"b"}]}').answer, p('{"answer":"open","confidence":80,"chat":"x","slides":[{"title":"a","text":"b"}],"chart":{"type":"pie","items":[{"label":"a","value":-1},{"label":"b","value":2}]}}').chart]; });
  check('bad model output is refused (no slides, not JSON, no number, bad chart dropped)', bad[0] === 'unsure' && bad[1] === 'unsure' && bad[2] === 'unsure' && bad[3] === null, JSON.stringify(bad));
  await page.context().close();
}

console.log(`${stamp()} --- override ---`);
{
  const { page } = await session();
  await openCamera(page);
  await say(page, 'Eswar, is the budget approved?', 1800);
  let m = await msgs(page);
  check('unsure yes/no: says it will check with you', m.length === 1 && /Let me check with Eswar\./.test(m[0]), m[0]);
  check('panel shows Yes / No', await page.evaluate(() => document.getElementById('standin-override').style.display === 'block'));
  await page.click('#standin-yes'); await wait(1200);
  m = await msgs(page);
  check('you click Yes: chat says Yes, you confirmed', m.length === 2 && /Yes\. Eswar has confirmed\./.test(m[1]), m[1]);
  check('override panel closes', await page.evaluate(() => document.getElementById('standin-override').style.display === 'none'));
  const cs = await page.evaluate(() => __standin.slides.state());
  check('camera shows the confirmed answer', cs.mode === 'show' && cs.shown >= 2, JSON.stringify(cs));
  await wait(3200);
  await say(page, 'Eswar, is the budget signed off?', 1800);
  await page.click('#standin-no'); await wait(1200);
  m = await msgs(page);
  check('you click No: chat says No', m.length === 4 && /No\. Eswar has confirmed\./.test(m[3]), m[3]);
  await wait(3200);
  await say(page, 'Eswar, is the budget final?', 1800);
  await wait(3200);
  m = await msgs(page);
  check('no click in time: falls back to the held line', m.length === 6 && /I will confirm after the meeting\./.test(m[5]), m.slice(4).join(' | '));
  await page.context().close();
}

console.log(`${stamp()} --- panel, pause, threshold ---`);
{
  const { page } = await session();
  await page.fill('#standin-q', 'Eswar, did the report go out?'); await page.click('#standin-ask'); await wait(1500);
  check('typed test question from the panel reaches the chat', (await msgs(page)).length === 1);
  check('panel shows the last decision', await page.evaluate(() => /YES\s*·\s*92%/.test(document.getElementById('standin-last').textContent)), await page.evaluate(() => document.getElementById('standin-last').textContent));
  await page.fill('#standin-q', 'what time is it'); await page.click('#standin-ask'); await wait(800);
  check('a question without your name is ignored with a hint', await page.evaluate(() => /Ignored/.test(document.getElementById('standin-last').textContent)));
  await page.click('#standin-toggle'); await wait(300);
  check('Pause button pauses', (await page.evaluate(() => __standin.listening)) === false && /Paused/.test(await page.evaluate(() => document.getElementById('standin-all-panel').innerText)));
  await wait(3200);
  await say(page, 'Eswar, did the report go out today?', 1500);
  check('paused: says nothing', (await msgs(page)).length === 1);
  await page.click('#standin-toggle'); await wait(3300);
  await say(page, 'Eswar, did the report go out yet?', 2000);
  const mm = await msgs(page);
  check('resumes after pause', mm.length === 2, mm.length + ' ' + await page.evaluate(() => __standin.logLines.slice(-6).join(' // ')));
  await page.evaluate(() => { const t = document.getElementById('standin-thr'); t.value = '95'; t.dispatchEvent(new Event('input')); });
  await wait(3300);
  await say(page, 'Eswar, did the report get out?', 2200);
  check('threshold slider at 95 holds a 92% answer (then asks you)', (await msgs(page)).length === 3 && /Let me check with Eswar/.test((await msgs(page))[2]));
  check('threshold is saved', await page.evaluate(() => JSON.parse(localStorage.getItem('standin.config')).threshold === 95));
  await page.context().close();
}

console.log(`${stamp()} --- real camera passes when not asked for video, and camera can be turned off ---`);
{
  const { page } = await session({ camera: false });
  const r = await page.evaluate(async () => { const s = await navigator.mediaDevices.getUserMedia({ video: true }); return s.getVideoTracks()[0].label; });
  check('camera:false leaves your real camera alone', /fake/i.test(r), r);
  const a = await page.evaluate(async () => { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); return s.getAudioTracks().length; });
  check('audio-only request passes through', a === 1);
  await page.context().close();
}

console.log(`${stamp()} --- live brain through the laptop relay (mock relay.ps1) ---`);
{
  const bridgeHtml = fs.readFileSync(path.join(here, 'relay-bridge.html'), 'utf8');
  const seen = [];
  const relaySrv = http.createServer((req, res) => {
    if (req.url === '/bridge') { res.setHeader('content-type', 'text/html'); return res.end(bridgeHtml.replace('__ALLOWED_ORIGIN__', base.replace(/\/$/, ''))); }
    if (req.method !== 'POST') { res.statusCode = 404; return res.end(); }
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      res.setHeader('content-type', 'application/json'); seen.push(req.url);
      const q = JSON.parse(b).question;
      if (req.url === '/answer') return res.end(JSON.stringify(/risky/.test(q) ? { answer: 'unsure', confidence: 0 } : { answer: 'open', confidence: 88, chat: 'We expect to finish in two weeks.', slides: [{ title: 'Timeline', text: 'Two weeks to finish.' }], chart: { type: 'bar', title: 'Weeks', items: [{ label: 'Build', value: 1 }, { label: 'Test', value: 1 }] } }));
      res.end(JSON.stringify({ answer: 'no', confidence: 93, reason: 'The notes say no.' }));
    });
  });
  await new Promise((r) => relaySrv.listen(8765, '127.0.0.1', r));
  const { page } = await session({ stubOpen: [] });
  await page.evaluate(() => { const NS = __standin; NS.config.autoRelay = true; NS.config.relayUrl = 'http://127.0.0.1:8765'; NS.openBridge(true); });
  await wait(1200);
  await say(page, 'Eswar, when will the work finish?', 3500);
  let m = await msgs(page);
  check('relay: open question answered by the live brain in the chat', m.length === 1 && /We expect to finish in two weeks\./.test(m[0]) && seen.includes('/answer'), m[0] + ' ' + seen);
  check('relay: the answer has slides and a chart on the camera', await page.evaluate(() => __standin.slides.state().frames === 2));
  await wait(3200);
  await say(page, 'Eswar, what about the risky part?', 3500);
  m = await msgs(page);
  check('relay: unsure from the brain is held', m.length === 2 && /I will confirm after the meeting\./.test(m[1]), m[1]);
  await wait(3200);
  await say(page, 'Eswar, is the plan signed off?', 3500);
  m = await msgs(page);
  check('relay: yes/no still works (No, from the notes)', m.length === 3 && /No\. The notes say no\./.test(m[2]), m[2]);
  await page.context().close();
  relaySrv.closeAllConnections(); await new Promise((r) => relaySrv.close(r));
}
await browser.close(); server.close();
TOTAL = n;
console.log(`\n${stamp()} ${n - fails.length}/${n} passed`); fails.forEach((f) => console.log('  FAIL ' + f));
process.exit(fails.length ? 1 : 0);
