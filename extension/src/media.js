// Replace the camera and microphone before Meet asks for them.
(function () {
  const NS = (window.__standin = window.__standin || {});
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  NS.callsIntercepted = 0;

  navigator.mediaDevices.getUserMedia = async function (constraints) {
    const wantsVideo = !!(constraints && constraints.video);
    const wantsAudio = !!(constraints && constraints.audio);
    if (!NS.config.enabled || (!wantsVideo && !wantsAudio)) {
      NS.log('passing camera and mic request to the real devices');
      return real(constraints);
    }
    NS.callsIntercepted++;
    const tracks = [];
    // Clones, so that turning the camera off in Meet does not kill the shared source.
    if (wantsVideo) NS.videoStream().getVideoTracks().forEach(function (t) { tracks.push(t.clone()); });
    if (wantsAudio) NS.audioStream().getAudioTracks().forEach(function (t) { tracks.push(t.clone()); });
    NS.log('gave Meet the stand-in camera/mic (video=' + wantsVideo + ', audio=' + wantsAudio + ')');
    return new MediaStream(tracks);
  };
})();
