// Fake microphone. Meet receives a stream made here; nothing touches the real mic.
// Speech: dummy "babble" voice by default. Set NS.tts = async (text) => AudioBuffer to use a real voice.
(function () {
  const NS = (window.__standin = window.__standin || {});

  let ctx = null;
  let dest = null;
  let master = null;
  let analyser = null;
  let stream = null;
  let meterTimer = null;

  NS.speaking = false;
  NS.level = 0; // 0..1, drives the avatar's mouth
  NS.tts = null;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    dest = ctx.createMediaStreamDestination();
    master = ctx.createGain();
    master.gain.value = 1;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    master.connect(dest);
    master.connect(analyser);
    // A silent source keeps the stream alive between answers.
    const silent = ctx.createConstantSource();
    const g = ctx.createGain();
    g.gain.value = 0;
    silent.connect(g);
    g.connect(dest);
    silent.start();
    stream = dest.stream;
    const buf = new Uint8Array(analyser.fftSize);
    meterTimer = setInterval(function () {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      NS.level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
    }, 40);
    NS.log('fake microphone ready');
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') return ctx.resume();
    return Promise.resolve();
  }

  // Turn encoded audio (wav) into a buffer the call can play. Used by the real voice.
  NS.decodeAudio = function (arrayBuffer) {
    ensure();
    return ctx.decodeAudioData(arrayBuffer);
  };

  NS.audioStream = function () {
    ensure();
    resume();
    return stream;
  };

  // Dummy voice: syllable bursts through two band-pass filters. Not words; it shows timing and level.
  function babble(text) {
    const words = text.split(/\s+/).filter(Boolean);
    const vowels = [
      [700, 1200],
      [500, 1800],
      [350, 2200],
      [450, 900],
    ];
    let t = ctx.currentTime + 0.05;
    let count = 0;
    words.forEach(function (w) {
      const syl = Math.max(1, Math.round(w.length / 3));
      for (let s = 0; s < syl; s++) {
        const f = vowels[(count + s) % vowels.length];
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 110 + ((count * 7) % 25);
        const b1 = ctx.createBiquadFilter();
        b1.type = 'bandpass';
        b1.frequency.value = f[0];
        b1.Q.value = 4;
        const b2 = ctx.createBiquadFilter();
        b2.type = 'bandpass';
        b2.frequency.value = f[1];
        b2.Q.value = 4;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.9, t + 0.03);
        env.gain.linearRampToValueAtTime(0, t + 0.15);
        osc.connect(b1);
        osc.connect(b2);
        b1.connect(env);
        b2.connect(env);
        env.connect(master);
        osc.start(t);
        osc.stop(t + 0.17);
        t += 0.17;
        count++;
      }
      t += 0.07;
    });
    return t - ctx.currentTime;
  }

  // Speak a line into the call. Resolves when the line has finished.
  NS.speak = async function (text) {
    ensure();
    await resume();
    NS.speaking = true;
    let seconds;
    try {
      let buffer = null;
      if (typeof NS.tts === 'function') {
        try {
          buffer = await NS.tts(text);
        } catch (e) {
          NS.log('voice service failed, using dummy voice: ' + e.message);
        }
      }
      if (buffer) {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(master);
        src.start();
        seconds = buffer.duration;
      } else {
        seconds = babble(text);
      }
      await new Promise(function (r) {
        setTimeout(r, seconds * 1000 + 100);
      });
    } finally {
      NS.speaking = false;
    }
    return seconds;
  };
})();
