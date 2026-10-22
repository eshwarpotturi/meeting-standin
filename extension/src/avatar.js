// Fake camera. A canvas is drawn 30 times a second and sent to Meet as the camera.
// Dummy avatar (a simple drawn person). Poses: idle (always), nod, shake.
(function () {
  const NS = (window.__standin = window.__standin || {});
  const W = 1280;
  const H = 720;
  let POSE_MS = 1400;

  const COLORS = {
    bg: '#12303A',
    skin: '#F2C6A0',
    hair: '#3B2A20',
    shirt: '#2F6FED',
    mouth: '#8A2F2F',
    eye: '#1A1A1A',
    pill: '#FFD23F',
    pillText: '#1A1A1A',
  };

  const avatar = (NS.avatar = {
    pose: 'idle',
    poseStart: 0,
    subtitle: '',
    label: 'AI stand-in',
    w: W,
    h: H,
  });

  // Recorded clips. Optional: idle (loops), nod, shake, speak (loops while talking). Missing ones fall back to the drawn head.
  const clips = {};
  avatar.clips = clips;
  avatar.loadClip = function (name, file) {
    return new Promise(function (resolve, reject) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.loop = name === 'idle' || name === 'speak';
      v.preload = 'auto';
      v.src = typeof file === 'string' ? file : URL.createObjectURL(file);
      v.onloadeddata = function () {
        clips[name] = v;
        if (name === 'idle' || name === 'speak') v.play().catch(function () {});
        NS.log('clip loaded: ' + name + ' (' + Math.round(v.duration * 10) / 10 + ' s)');
        resolve(v);
      };
      v.onerror = function () {
        NS.log('clip failed: ' + name);
        reject(new Error('could not read ' + name));
      };
    });
  };
  avatar.clearClips = function () {
    Object.keys(clips).forEach(function (k) {
      try { clips[k].pause(); } catch (e) { /* ignore */ }
      delete clips[k];
    });
  };
  let activeClip = null;
  function clipFrame() {
    // Choose the clip for the moment: pose clip, then speak clip, then idle.
    let name = null;
    if (avatar.pose !== 'idle' && clips[avatar.pose]) name = avatar.pose;
    else if (NS.speaking && clips.speak) name = 'speak';
    else if (clips.idle) name = 'idle';
    if (!name) return null;
    const v = clips[name];
    if (activeClip !== name) {
      activeClip = name;
      if (name === 'nod' || name === 'shake') v.currentTime = 0;
      v.play().catch(function () {});
    }
    return v;
  }

  let canvas = null;
  let ctx = null;
  let stream = null;
  let timer = null;

  avatar.setPose = function (pose) {
    avatar.pose = pose;
    avatar.poseStart = performance.now();
    POSE_MS = clips[pose] && clips[pose].duration ? Math.max(1400, clips[pose].duration * 1000) : 1400;
    NS.log('pose: ' + pose);
  };
  avatar.setSubtitle = function (text) {
    avatar.subtitle = text || '';
  };

  function wrap(text, maxChars) {
    const words = text.split(/\s+/);
    const lines = [];
    let cur = '';
    words.forEach(function (w) {
      if ((cur + ' ' + w).trim().length > maxChars) {
        lines.push(cur);
        cur = w;
      } else {
        cur = (cur + ' ' + w).trim();
      }
    });
    if (cur) lines.push(cur);
    return lines.slice(-3);
  }

  function draw(now) {
    const t = now / 1000;
    let dx = Math.sin(t * 0.8) * 4;
    let dy = Math.sin(t * 1.3) * 5; // breathing
    let p = 0;
    if (avatar.pose !== 'idle') {
      p = (now - avatar.poseStart) / POSE_MS;
      if (p >= 1) {
        avatar.pose = 'idle';
        p = 0;
      } else if (avatar.pose === 'nod') {
        dy += Math.sin(p * Math.PI * 4) * H * 0.035 * (1 - 0.4 * p);
      } else if (avatar.pose === 'shake') {
        dx += Math.sin(p * Math.PI * 4) * W * 0.03 * (1 - 0.4 * p);
      }
    }

    const clip = clipFrame();
    if (clip && clip.videoWidth) {
      // Recorded clip, scaled to fit the frame
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const k = Math.min(W / clip.videoWidth, H / clip.videoHeight);
      const w = clip.videoWidth * k;
      const h = clip.videoHeight * k;
      ctx.drawImage(clip, (W - w) / 2, (H - h) / 2, w, h);
    } else {
      // Background and shoulders
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = COLORS.shirt;
      ctx.beginPath();
      ctx.ellipse(W / 2 + dx * 0.3, H + 40, 330, 210, 0, 0, Math.PI * 2);
      ctx.fill();

      // Head
      const cx = W / 2 + dx;
      const cy = H * 0.4 + dy;
      const r = H * 0.2;
      ctx.fillStyle = COLORS.skin;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      // Hair cap
      ctx.fillStyle = COLORS.hair;
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.25, r * 1.02, Math.PI * 1.02, Math.PI * 1.98);
      ctx.fill();

      // Eyes, with a blink every few seconds
      const blink = Math.floor(t) % 4 === 0 && t % 1 < 0.12;
      ctx.fillStyle = COLORS.eye;
      const eyeH = blink ? 2 : r * 0.12;
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.38, cy - r * 0.05, r * 0.09, eyeH, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + r * 0.38, cy - r * 0.05, r * 0.09, eyeH, 0, 0, Math.PI * 2);
      ctx.fill();

      // Mouth follows the voice level
      const open = NS.speaking ? Math.min(1, NS.level * 1.5 + 0.15) : 0;
      ctx.fillStyle = COLORS.mouth;
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.5, r * 0.22, 3 + open * r * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();


    }

    // Label: always on, so nobody mistakes this for the real person.
    ctx.font = '600 34px system-ui, sans-serif';
    const lw = ctx.measureText(avatar.label).width + 40;
    ctx.fillStyle = COLORS.pill;
    ctx.beginPath();
    ctx.roundRect(24, H - 76, lw, 52, 26);
    ctx.fill();
    ctx.fillStyle = COLORS.pillText;
    ctx.textBaseline = 'middle';
    ctx.fillText(avatar.label, 44, H - 50);

    // Subtitle: what the stand-in is saying
    if (avatar.subtitle) {
      const lines = wrap(avatar.subtitle, 48);
      ctx.font = '500 34px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const boxH = lines.length * 44 + 20;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(W * 0.12, H - 100 - boxH, W * 0.76, boxH);
      ctx.fillStyle = '#FFFFFF';
      lines.forEach(function (ln, i) {
        ctx.fillText(ln, W / 2, H - 100 - boxH + 32 + i * 44);
      });
      ctx.textAlign = 'left';
    }
  }

  function ensure() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');
    draw(performance.now());
    stream = canvas.captureStream(30);
    timer = setInterval(function () {
      draw(performance.now());
    }, 33);
    NS.log('fake camera ready (' + W + 'x' + H + ')');
  }

  NS.videoStream = function () {
    ensure();
    return stream;
  };
  NS.stopAvatar = function () {
    if (timer) clearInterval(timer);
    timer = null;
  };
})();
