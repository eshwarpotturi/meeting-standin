// Camera only: Meet gets the slide canvas as your camera. Your real microphone is left alone. No voice from the stand-in.
(function () {
  const NS = (window.__standin = window.__standin || {});
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  NS.cameraCalls = 0;
  navigator.mediaDevices.getUserMedia = async function (constraints) {
    const wantsVideo = !!(constraints && constraints.video);
    if (!NS.config.camera || !wantsVideo) return real(constraints);
    NS.cameraCalls++;
    const tracks = [];
    if (constraints.audio) {
      try { (await real({ audio: constraints.audio })).getAudioTracks().forEach(function (t) { tracks.push(t); }); } catch (e) { NS.log('real mic not available: ' + e.message); }
    }
    NS.slides.stream().getVideoTracks().forEach(function (t) { tracks.push(t.clone()); });
    NS.log('gave Meet the slide camera (audio=' + !!constraints.audio + ')');
    return new MediaStream(tracks);
  };
})();
