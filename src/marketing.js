/* Lazy marketing scripts — defer third-party tags until first user interaction
   (or a 6s fallback) to keep them off the critical path. Ported 1:1 from the
   inline embed: Clarity, Bing UET, ClickyClicks, ClickCease, HubSpot, Zoho,
   Trustpilot. Each injected tag carries data-cookieconsent="marketing". */

const SCRIPTS = {
  hubspot: "//js-eu1.hs-scripts.com/27197787.js",
  zoho: "https://crm.zoho.com/crm/javascript/zcga.js",
  trustpilot: "//widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js",
  clickcease: "https://www.clickcease.com/monitor/stat.js",
  clickyclicks: "https://clients.clickyclicks.co.uk/cookie.js",
  bing: "//bat.bing.com/bat.js",
};

const DEFAULT_EVENTS = ["scroll", "mousemove", "touchstart", "keydown"];

function injectScript(src, id) {
  const s = document.createElement("script");
  s.type = "text/javascript";
  s.async = true;
  s.src = src;
  s.setAttribute("data-cookieconsent", "marketing");
  if (id) s.id = id;
  document.body.appendChild(s);
}

let scriptsLoaded = false;

export function loadMarketingScripts() {
  if (scriptsLoaded) return;
  scriptsLoaded = true;
  // 1. Microsoft Clarity
  (function (c, l, a, r, i) {
    c[a] = c[a] || function () {
      (c[a].q = c[a].q || []).push(arguments);
    };
    const t = l.createElement(r);
    t.async = 1;
    t.src = "https://www.clarity.ms/tag/" + i;
    const y = l.getElementsByTagName(r)[0];
    y.parentNode.insertBefore(t, y);
  })(window, document, "clarity", "script", "stldbhzbgk");
  // 2. Bing Ads (UET)
  window.uetq = window.uetq || [];
  const bingScript = document.createElement("script");
  bingScript.src = SCRIPTS.bing;
  bingScript.async = true;
  bingScript.setAttribute("data-cookieconsent", "marketing");
  bingScript.onload = function () {
    const o = { ti: "187039680", enableAutoSpaTracking: true };
    o.q = window.uetq;
    window.uetq = new UET(o);
    window.uetq.push("pageLoad");
  };
  document.body.appendChild(bingScript);
  // 3. Standard injections
  injectScript(SCRIPTS.clickyclicks);
  injectScript(SCRIPTS.clickcease); // early due to anti-fraud
  injectScript(SCRIPTS.hubspot, "hs-script-loader");
  injectScript(SCRIPTS.zoho);
  injectScript(SCRIPTS.trustpilot);
}

// Fire `callback` once, on the first user interaction or after `timeoutMs`.
// Cleans up its listeners and timer so the callback never runs twice.
export function setupLazyLoad(
  callback,
  { events = DEFAULT_EVENTS, timeoutMs = 6000, target = window } = {}
) {
  let fired = false;
  let timer = null;
  function fire() {
    if (fired) return;
    fired = true;
    events.forEach((e) => target.removeEventListener(e, fire));
    if (timer !== null) clearTimeout(timer);
    callback();
  }
  events.forEach((e) => target.addEventListener(e, fire, { passive: true }));
  timer = setTimeout(fire, timeoutMs);
  return fire;
}

if (typeof window !== "undefined") {
  setupLazyLoad(loadMarketingScripts);
}
