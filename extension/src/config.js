// Settings. Saved in the page's local storage; the Meet tab only.
(function () {
  const NS = (window.__standin = window.__standin || {});
  const KEY = 'standin.config';

  const defaults = {
    enabled: true, // swap camera and mic. Reload the call to change.
    userName: 'Eswar',
    names: ['eswar', 'ishwar', 'eshwar', 'iswar', 'pothuri', 'poturi', 'sai'],
    threshold: 75, // answer only at or above this confidence (0-100)
    disclosure: true, // first reply says it is an AI stand-in
    brain: 'stub', // 'stub' (demo rules), 'claude' (extension + API key) or 'relay' (relay.ps1 on this laptop)
    relayUrl: 'http://127.0.0.1:8765',
    realVoice: true, // use the Windows voice through the relay when it is running
    override: true, // when it would hold a yes/no question, show Yes/No buttons in the panel for a few seconds
    overrideWaitMs: 20000,
    autoRelay: true, // if the relay is running, use it instead of the demo rules
    model: 'claude-sonnet-5-5',
    heldLine: 'I will confirm after the meeting.',
    captionDebounceMs: 1200,
    ignoreOwnSpeech: true, // do not answer captions from your own mic (speaker "You")
    camera: true, // standin-all.js: show answers as slides on your camera
    openAnswers: true, // answer open questions from your notes (chat and slides) when sure enough
    slideStepMs: 5000, // each slide of an open answer
    slideHoldMs: 9000, // how long a finished answer stays on the camera
    stubOpen: [], // demo answers for open questions when no relay: [{when, confidence, chat, slides, chart}]
    duplicateWindowMs: 15000,
    // Data chart: say "stand-in, chart <topic>" and the camera shows a chart of public data, with its source.
    dataChart: true,
    chartHoldMs: 20000, // how long the chart stays on the camera
    chartStepMs: 9000, // chart, then a one-line summary
    chartChat: true, // also post one labelled line with the source in the Meet chat
    chartRepeatMs: 300000, // the same topic is not charted again from speech for this long (standin.chart() always works)
    chartMinPoints: 3, // fewer data points than this is not charted
    // Context pack: what Claude may use. Plain text for 'claude'; rules for 'stub'.
    contextPack: '',
    stubRules: [],
  };

  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch (e) {
    saved = {};
  }

  NS.config = Object.assign({}, defaults, saved);
  NS.saveConfig = function () {
    try {
      localStorage.setItem(KEY, JSON.stringify(NS.config));
    } catch (e) {
      /* storage can be blocked; the stand-in still works for this call */
    }
  };
})();
