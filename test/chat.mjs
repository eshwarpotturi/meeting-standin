// End-to-end test of the chat-only stand-in (standin-chat.js) on a mock Meet page. No network, no key, no cost.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = fs.readFileSync(path.join(here, '..', 'standin-chat.js'), 'utf8');
const stamp = () => new Date().toISOString();
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.setHeader('content-security-policy', "require-trusted-types-for 'script'"); // same rule Meet enforces
  res.end(fs.readFileSync(path.join(here, 'meet-mock.html')));
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
const TOTAL = 31; let n = 0; const fails = [];
function check(name, pass, detail) { n++; if (!pass) fails.push(name); console.log(`${stamp()} [${n}/${TOTAL}] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();

async function session(query) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('standin.config', JSON.stringify({
      brain: 'stub', autoRelay: false, captionDebounceMs: 150, duplicateWindowMs: 3000, userName: 'Eswar',
      stubRules: [{ when: 'report', answer: 'yes', confidence: 92, reason: 'I sent the report yesterday.' }, { when: 'budget', answer: 'no', confidence: 40, reason: 'Not sure.' }],
    }));
  });
  await page.goto(base + query);
  const gum = await page.evaluate(() => navigator.mediaDevices ? navigator.mediaDevices.getUserMedia.toString() : 'none');
  // Same as pasting into the DevTools console (that path is not blocked by Trusted Types).
  const cdp = await ctx.newCDPSession(page);
  const r = await cdp.send('Runtime.evaluate', { expression: bundle });
  if (r.exceptionDetails) errors.push('bundle: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return { page, errors, gum };
}
const msgs = (page) => page.evaluate(() => window.sentMessages.slice());
const say = async (page, t, ms) => { await page.evaluate((x) => window.setCaption(x), t); await wait(ms || 1500); };

for (const mode of ['button', 'enter']) {
  console.log(`${stamp()} --- send by ${mode} ---`);
  const { page, errors, gum } = await session(mode === 'enter' ? '?enter=1' : '');
  check(`[${mode}] script loads with no errors`, errors.length === 0, errors[0]);
  check(`[${mode}] camera and microphone are left alone`, /native code/.test(gum), gum.slice(0, 40));
  const st = await page.evaluate(() => window.standin.status());
  check(`[${mode}] listening, chat-only`, st.listening === true);
  const c0 = await page.evaluate(() => window.standin.chatCheck());
  check(`[${mode}] finds the chat button before the chat is open`, c0.chatButton === true && c0.chatBox === false);
  await say(page, 'Priya, did the report go out?');
  check(`[${mode}] ignores a question for someone else`, (await msgs(page)).length === 0);
  await say(page, 'Eswar, did the report go out?', 2000);
  let m = await msgs(page);
  check(`[${mode}] answers a yes/no question in the chat`, m.length === 1 && /Yes\. I sent the report yesterday\./.test(m[0]), m[0]);
  check(`[${mode}] first message says it is an AI stand-in`, m[0] && /\[AI stand-in for Eswar\] I am an AI stand-in for Eswar\./.test(m[0]));
  check(`[${mode}] chat panel was opened for it`, await page.evaluate(() => document.getElementById('panel').style.display === 'block'));
  await say(page, 'Eswar, did the report go out?', 1200);
  check(`[${mode}] does not answer the same question twice`, (await msgs(page)).length === 1);
  await wait(3200);
  await say(page, 'Eswar, is the budget approved?', 2000);
  m = await msgs(page);
  check(`[${mode}] low confidence: holds and says it will confirm`, m.length === 2 && /I will confirm after the meeting\./.test(m[1]) && !/^\[AI stand-in for Eswar\] I am an AI/.test(m[1]), m[1]);
  await say(page, 'Eswar, can you walk us through the plan?', 2000);
  m = await msgs(page);
  check(`[${mode}] open question: holds`, m.length === 3 && /I will confirm after the meeting\./.test(m[2]), m[2]);
  check(`[${mode}] every message is labelled`, m.every((x) => x.startsWith('[AI stand-in for Eswar] ')));
  await page.evaluate(() => window.standin.stop());
  await wait(3300);
  await say(page, 'Eswar, did the report go out today?', 1500);
  check(`[${mode}] paused: says nothing`, (await msgs(page)).length === 3);
  await page.evaluate(() => window.standin.start());
  await say(page, 'Eswar, did the report go out yet?', 2000);
  check(`[${mode}] resumes after pause`, (await msgs(page)).length === 4);
  await page.context().close();
}
// Typed test question (no captions needed)
{
  const { page } = await session('');
  await page.evaluate(() => window.standin.ask('Eswar, did the report go out?'));
  await wait(1200);
  const m = await msgs(page);
  check('typed test question reaches the chat', m.length === 1 && /Yes\./.test(m[0]));
  const pill = await page.evaluate(() => (document.body.innerText.match(/AI stand-in: \w+/) || [''])[0]);
  check('status pill shows it is listening', pill === 'AI stand-in: listening', pill);
  // Chat missing: fails loudly, does not crash
  const r = await page.evaluate(async () => { document.getElementById('chatbtn').remove(); document.getElementById('panel').remove(); try { await window.__standin.chat.post('x'); return 'posted'; } catch (e) { return e.message; } });
  check('no chat box: clear error, no crash', /chat box not found/i.test(r), r);
}
await browser.close(); server.close();
console.log(`\n${stamp()} ${n - fails.length}/${n} passed`); fails.forEach((f) => console.log('  FAIL ' + f));
process.exit(fails.length ? 1 : 0);
