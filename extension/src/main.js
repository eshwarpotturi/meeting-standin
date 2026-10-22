(function () {
  const NS = (window.__standin = window.__standin || {});
  NS.status = function () {
    return {
      enabled: NS.config.enabled,
      aiLabel: !!NS.avatar.label,
      pose: NS.avatar.pose,
      speaking: NS.speaking,
      intercepted: NS.callsIntercepted,
      threshold: NS.config.threshold,
    };
  };
  NS.log('loaded (enabled=' + NS.config.enabled + ', brain=' + NS.config.brain + ')');
  NS.buildPanel();
  if (NS.config.autoRelay) NS.openBridge();
  NS.captions.start();
})();
