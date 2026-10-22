// Fast check of question detection on the labelled set, without a browser.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const ctx = { console, performance, EventTarget, CustomEvent, setTimeout, clearTimeout, setInterval };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['log', 'config', 'brain']) vm.runInContext(readFileSync(new URL('../extension/src/' + f + '.js', import.meta.url), 'utf8'), ctx);
const set = JSON.parse(readFileSync(new URL('./detection-set.json', import.meta.url), 'utf8'));
const NS = ctx.__standin; let ok = 0; const bad = [];
set.forEach((c, i) => {
  const r = NS.brain.detect(c.text);
  const good = r.addressed === c.addressed && r.kind === c.kind;
  if (good) ok++; else bad.push({ text: c.text, want: c.addressed + '/' + c.kind, got: r.addressed + '/' + r.kind });
  console.log(NS.isoLocal() + ' [' + (i + 1) + '/' + set.length + '] ' + (good ? 'ok ' : 'BAD') + ' ' + c.text);
});
console.log('\nDetection: ' + ok + '/' + set.length + ' correct');
bad.forEach(b => console.log('  MISS', JSON.stringify(b)));
process.exit(bad.length ? 1 : 0);
