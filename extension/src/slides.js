// Camera slides: what the other people see instead of your face. One big sentence, an optional chart, a short slideshow.
// Drawn on a canvas and sent as the camera. Always labelled as an AI stand-in. No face, no voice.
(function () {
  const NS = (window.__standin = window.__standin || {});
  const W = 1280, H = 720;
  const PAL = ['#2f6fe4', '#e0782a', '#2a9d6f', '#a74fd0', '#c9a227', '#d6455d'];
  let canvas = null, ctx = null, stream = null, timer = null, hideTimer = null;
  const S = { frames: [], i: 0, since: 0, mode: 'idle', shown: 0 };

  function init() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    ctx = canvas.getContext('2d');
    draw();
    timer = setInterval(draw, 100);
    stream = canvas.captureStream(10);
  }

  function wrap(text, maxW, font) {
    ctx.font = font;
    const words = String(text).split(' '), lines = [];
    let cur = '';
    words.forEach(function (w) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  // Biggest font (from 96 down to 32) at which the text fits in maxH pixels of height.
  function fit(text, maxW, maxH) {
    for (let px = 96; px >= 32; px -= 4) {
      const f = '700 ' + px + 'px system-ui, Segoe UI, sans-serif';
      const l = wrap(text, maxW, f);
      if (l.length * px * 1.2 <= maxH) return { px: px, font: f, lines: l };
    }
    const f = '700 32px system-ui, Segoe UI, sans-serif';
    return { px: 32, font: f, lines: wrap(text, maxW, f).slice(0, Math.floor(maxH / 38)) };
  }

  function drawChart(c, x, y, w, h) {
    const total = c.items.reduce(function (a, i) { return a + i.value; }, 0) || 1;
    if (c.type === 'pie') {
      const r = Math.min(h, w * 0.5) / 2 - 10, cx = x + r + 10, cy = y + h / 2;
      let a0 = -Math.PI / 2;
      c.items.forEach(function (it, k) {
        const a1 = a0 + (it.value / total) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
        ctx.fillStyle = PAL[k % PAL.length]; ctx.fill();
        a0 = a1;
      });
      ctx.textBaseline = 'middle';
      c.items.forEach(function (it, k) {
        const ly = y + 30 + k * 56;
        ctx.fillStyle = PAL[k % PAL.length]; ctx.fillRect(x + r * 2 + 50, ly - 14, 28, 28);
        ctx.fillStyle = '#14181f'; ctx.font = '600 32px system-ui, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(it.label + '  ' + Math.round((it.value / total) * 100) + '%', x + r * 2 + 92, ly);
      });
    } else {
      const max = Math.max.apply(null, c.items.map(function (i) { return i.value; })) || 1;
      const rowH = Math.min(70, h / c.items.length);
      ctx.textBaseline = 'middle';
      c.items.forEach(function (it, k) {
        const ry = y + k * rowH + rowH / 2, bx = x + 300, bw = (w - 420) * (it.value / max);
        ctx.fillStyle = '#14181f'; ctx.font = '600 30px system-ui, sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(it.label, bx - 16, ry);
        ctx.fillStyle = PAL[k % PAL.length]; ctx.fillRect(bx, ry - rowH * 0.3, Math.max(4, bw), rowH * 0.6);
        ctx.textAlign = 'left'; ctx.fillStyle = '#14181f';
        ctx.fillText(String(it.value), bx + Math.max(4, bw) + 12, ry);
      });
    }
  }

  function drawFrame(f) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1f5fd1'; ctx.fillRect(0, 0, W, 14);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if (f.kind === 'chart') {
      ctx.fillStyle = '#14181f'; ctx.font = '700 52px system-ui, sans-serif';
      ctx.fillText(f.chart.title || f.title || '', 70, 120);
      drawChart(f.chart, 70, 170, W - 140, 440);
    } else {
      let y = 130;
      if (f.title) {
        ctx.fillStyle = '#1f5fd1'; ctx.font = '700 44px system-ui, sans-serif';
        ctx.fillText(f.title, 70, y); y += 70;
      }
      const t = fit(f.text, W - 140, f.title ? 400 : 500);
      ctx.fillStyle = '#14181f'; ctx.font = t.font;
      const block = t.lines.length * t.px * 1.2;
      let ty = f.title ? y + t.px * 0.9 : (H - 74 - block) / 2 + t.px * 0.85;
      t.lines.forEach(function (l) { ctx.fillText(l, 70, ty); ty += t.px * 1.2; });
    }
    // Footer label, always.
    ctx.fillStyle = '#eef2f8'; ctx.fillRect(0, H - 74, W, 74);
    ctx.fillStyle = '#14181f'; ctx.font = '600 30px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText('AI stand-in for ' + NS.config.userName, 70, H - 37);
    if (S.frames.length > 1) {
      ctx.textAlign = 'right';
      ctx.fillText((S.i + 1) + ' / ' + S.frames.length, W - 70, H - 37);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  function draw() {
    if (!ctx) return;
    const step = NS.config.slideStepMs || 5000;
    if (S.mode === 'show' && S.frames.length > 1 && S.i < S.frames.length - 1 && Date.now() - S.since >= step) {
      S.i++; S.since = Date.now();
    }
    const idle = { kind: 'text', title: '', text: 'AI stand-in for ' + NS.config.userName + ' – listening' };
    const f = S.mode === 'show' ? S.frames[S.i] : idle;
    drawFrame(f);
  }

  function framesFor(result, text) {
    const o = result && result.open;
    if (o) {
      const fr = o.slides.map(function (s) { return { kind: 'text', title: s.title, text: s.text }; });
      if (o.chart) fr.push({ kind: 'chart', chart: o.chart });
      return fr;
    }
    const clean = String(text || '').replace(/^I am an AI stand-in for [^.]*\.\s*/, '');
    return [{ kind: 'text', title: '', text: clean }];
  }

  NS.slides = {
    init: init,
    stream: function () { init(); return stream; },
    show: function (result, text) {
      init();
      S.frames = framesFor(result, text);
      S.i = 0; S.since = Date.now(); S.mode = 'show'; S.shown++;
      const total = (NS.config.slideStepMs || 5000) * (S.frames.length - 1) + (NS.config.slideHoldMs || 9000);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { S.mode = 'idle'; }, total);
      draw();
      NS.log('camera slide: ' + S.frames.length + ' frame(s)');
    },
    clear: function () { clearTimeout(hideTimer); S.mode = 'idle'; draw(); },
    state: function () { return { mode: S.mode, i: S.i, frames: S.frames.length, shown: S.shown }; },
    canvas: function () { init(); return canvas; },
  };
})();
