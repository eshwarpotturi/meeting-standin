// Logging: every line has a timestamp. Pass done/total for anything that runs in steps.
(function () {
  const NS = (window.__standin = window.__standin || {});

  function isoLocal() {
    const d = new Date();
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
    const mm = String(Math.abs(off) % 60).padStart(2, '0');
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, -1) + sign + hh + ':' + mm;
  }

  NS.isoLocal = isoLocal;
  NS.logLines = [];
  NS.log = function (msg, done, total) {
    const prog = total != null ? ' [' + done + '/' + total + ']' : '';
    const line = isoLocal() + prog + ' [standin] ' + msg;
    NS.logLines.push(line);
    if (NS.logLines.length > 500) NS.logLines.shift();
    console.log(line);
  };
})();
