/* Lead: sends the /start-hosting estimate enquiry straight to the HubSpot Forms API.
   Why: the lead used to reach HubSpot only via Collected Forms, which needs the
   HubSpot tracking script, so enquiries from visitors who had not accepted Cookiebot
   Statistics never arrived (confirmed by Chris, 2026-10-09). This submission does
   not depend on the tracker or on consent; consent only decides whether the
   `hubspotutk` cookie is attached as context.hutk.

   Flow: a valid click on [start-ready-button] arms the enquiry; the estimate from
   valuation.js (window event `staymo:estimate-ready`, detail.estimateRange; DOM
   fallback [start-result] [data-output="estimate-range"]) sends it once. While it is
   in flight, window.estGoTo("result") is held (chained wrapper, 10 s cap). After the
   HubSpot attempt settles (2xx or final failure) the Webflow form
   form#wf-form-start-hosting-copy is filled and natively submitted as a record.
   Valuation failure (noresults) sends nothing. [start-restart] allows a new enquiry.

   Contract:
   - <html data-lead-state="sending|sent|failed">
   - window events `staymo:lead-sent` / `staymo:lead-failed`, detail { status, errors }
   - any [data-lead-retry] click re-sends a failed submission
   - form#wf-form-start-hosting-copy gets data-hs-do-not-collect="true" (Collected
     Forms must never capture it, even after a later consent).

   Source fields (hidden HubSpot fields, empty ones omitted):
   - utm_source/medium/campaign/term/content, gclid, fbclid, msclkid from this page's
     query (start-redirect.js / header-address.js carry them here). Sent for everyone.
   - lead_start (landing URL, origin + path) and first_referrer (external referrer of
     the landing page) from sessionStorage "staymo_first_touch" (written by
     prelead.js), read only with Cookiebot Statistics consent at send time.
   JS binds to data-* attributes and the form id only. No dependencies. */

export const HS_ENDPOINT =
  "https://api.hsforms.com/submissions/v3/integration/submit/27197787/bb8a49ad-059b-4f04-a8dd-0a1b743fb9e6";
export const FORM_SELECTOR = "form#wf-form-start-hosting-copy";
export const RETRY_DELAYS = [1000, 2000, 4000];
export const RESULT_HOLD_CAP = 10000;

export const SOURCE_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "msclkid",
];
// Same key/format as prelead.js (duplicated: modules don't import each other).
export const FIRST_TOUCH_KEY = "staymo_first_touch";
export const SOURCE_MAX = 255;

const GATE = Symbol.for("staymo.lead.gate");
const CALCULATING = /^calculating(…|\.\.\.)?$/i;

function val(el) {
  return el ? String(el.value ?? "").trim() : "";
}

export function normalizeName(v) {
  return String(v || "").trim().replace(/\s+/g, " ");
}

export function splitName(full) {
  const parts = normalizeName(full).split(" ").filter(Boolean);
  return { firstname: parts[0] || "", lastname: parts.slice(1).join(" ") };
}

export function isEmailLike(v) {
  return String(v || "").indexOf("@") > 0;
}

export function getCookie(name, cookieStr = typeof document !== "undefined" ? document.cookie : "") {
  for (const part of String(cookieStr || "").split(";")) {
    const c = part.trim();
    if (c.indexOf(name + "=") === 0) return decodeURIComponent(c.substring(name.length + 1));
  }
  return null;
}

// Estimate text from the result screen, or "" while it still reads "Calculating…".
export function readDomEstimate(doc = document) {
  const el = doc.querySelector('[start-result] [data-output="estimate-range"]');
  const t = el ? String(el.textContent || "").trim() : "";
  return t && !CALCULATING.test(t) ? t : "";
}

const clip = (v) => String(v ?? "").trim().slice(0, SOURCE_MAX);

// Ad / campaign params of the current page; absent or blank ones are left out.
export function readSourceParams(search = "") {
  const params = new URLSearchParams(search);
  const out = {};
  for (const k of SOURCE_PARAMS) {
    const v = clip(params.get(k));
    if (v) out[k] = v;
  }
  return out;
}

function sessionStore(win) {
  try {
    return win.sessionStorage || null;
  } catch (e) {
    return null;
  }
}

// Landing page + external referrer, only with Statistics consent at send time.
export function readFirstTouch(win = window, storage = sessionStore(win)) {
  if (win.Cookiebot?.consent?.statistics !== true) return {};
  try {
    const entry = JSON.parse((storage && storage.getItem(FIRST_TOUCH_KEY)) || "null");
    if (!entry || typeof entry !== "object") return {};
    return { lead_start: clip(entry.landing), first_referrer: clip(entry.referrer) };
  } catch (e) {
    return {};
  }
}

// Funnel values, read at send time.
export function readLead(doc = document, win = doc.defaultView || window) {
  const touch = readFirstTouch(win);
  const form = doc.querySelector(FORM_SELECTOR);
  const fullName = normalizeName(val(doc.querySelector('[data-input="full-name"]')));
  const phone =
    val(form && form.querySelector('[name="phone"]')) ||
    val(doc.querySelector('[data-input="phone"]'));
  return {
    email: val(doc.querySelector('[data-input="email"]')),
    full_name: fullName,
    ...splitName(fullName),
    phone,
    lead_start: touch.lead_start || "",
    first_referrer: touch.first_referrer || "",
    property_address:
      val(doc.querySelector('[data-input-id="address-search"]')) ||
      val(doc.querySelector("#autocompleteHero")),
    property_bedrooms:
      val(doc.querySelector('[data-input-id="beds-count"]')) ||
      val(doc.querySelector("[data-rooms-input]")),
    zip: val(doc.querySelector('[data-input-id="postal-code-result"]')),
    ...readSourceParams(win.location?.search || ""),
  };
}

export function isContactComplete(lead) {
  return !!(lead.full_name && lead.phone && isEmailLike(lead.email));
}

const FIELD_ORDER = [
  "email",
  "full_name",
  "firstname",
  "lastname",
  "phone",
  "lead_start",
  "rental_estimation",
  "property_address",
  "property_bedrooms",
  "zip",
  "first_referrer",
  ...SOURCE_PARAMS,
];

export function buildPayload(lead, { pageUri, pageName, hutk } = {}) {
  const fields = FIELD_ORDER.filter((k) => lead[k]).map((name) => ({
    objectTypeId: "0-1",
    name,
    value: String(lead[name]),
  }));
  const context = { pageUri, pageName };
  if (hutk) context.hutk = hutk;
  return { fields, context };
}

// hutk only with Cookiebot Statistics consent at send time and an existing cookie.
export function getHutk(win = window, doc = document) {
  if (win.Cookiebot?.consent?.statistics !== true) return null;
  return getCookie("hubspotutk", doc.cookie) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One HubSpot submission with retries on network errors, 5xx and 429.
export async function submitToHubSpot(payload, { delays = RETRY_DELAYS } = {}) {
  let last = { ok: false, status: 0, errors: [] };
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    try {
      const r = await globalThis.fetch(HS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      if (r.ok) return { ok: true, status: r.status, errors: [] };
      let errors = [];
      try {
        const body = await r.json();
        if (Array.isArray(body?.errors)) errors = body.errors;
      } catch (e) {}
      last = { ok: false, status: r.status, errors };
      if (r.status < 500 && r.status !== 429) return last;
    } catch (e) {
      last = { ok: false, status: 0, errors: [{ message: String(e?.message || e) }] };
    }
  }
  return last;
}

function setHidden(form, name, value) {
  const el = form.querySelector(`[name="${name}"]`);
  if (!el) return null;
  const v = value == null ? "" : String(value);
  el.value = v;
  el.setAttribute("value", v);
  return el;
}

// Webflow native submit (kept as a record), same hidden inputs as the old bridge.
export function submitWebflowForm(doc, lead) {
  const form = doc.querySelector(FORM_SELECTOR);
  if (!form) return false;
  setHidden(form, "firstname", lead.firstname);
  setHidden(form, "lastname", lead.lastname);
  setHidden(form, "property_address", lead.property_address);
  setHidden(form, "zip", lead.zip);
  setHidden(form, "property_bedrooms", lead.property_bedrooms);
  setHidden(form, "Lead Start", lead.lead_start);
  const est = setHidden(form, "rental_estimation", lead.rental_estimation);
  if (est) {
    est.dispatchEvent(new Event("input", { bubbles: true }));
    est.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (typeof form.requestSubmit === "function") form.requestSubmit();
  else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  return true;
}

export function initLead(doc = document, { win = window, delays = RETRY_DELAYS, cap = RESULT_HOLD_CAP } = {}) {
  const root = doc.documentElement;
  const form = doc.querySelector(FORM_SELECTOR);
  if (form) form.setAttribute("data-hs-do-not-collect", "true");

  let alive = true;
  let flow = newFlow();

  function newFlow() {
    // armed: valid contact click seen; started: HubSpot send begun (once per flow).
    return { armed: false, started: false, sending: null, hold: null, lead: null, webflowDone: false };
  }

  function setState(s) {
    if (s) root.setAttribute("data-lead-state", s);
    else root.removeAttribute("data-lead-state");
  }

  function send(f) {
    setState("sending");
    const payload = buildPayload(f.lead, {
      pageUri: win.location.href,
      pageName: doc.title,
      hutk: getHutk(win, doc),
    });
    f.hold = null;
    f.sending = submitToHubSpot(payload, { delays }).then((res) => {
      f.sending = null;
      if (!alive) return res;
      if (!res.ok) console.error("[lead] HubSpot submission failed", res.status, res.errors);
      // State and events belong to the current enquiry; a restarted one keeps its own.
      if (f === flow) {
        setState(res.ok ? "sent" : "failed");
        win.dispatchEvent(
          new CustomEvent(res.ok ? "staymo:lead-sent" : "staymo:lead-failed", {
            detail: { status: res.status, errors: res.errors },
          })
        );
      }
      if (!f.webflowDone) {
        f.webflowDone = true;
        submitWebflowForm(doc, f.lead);
      }
      return res;
    });
    return f.sending;
  }

  function start(estimate) {
    const f = flow;
    if (!f.armed || f.started || !estimate) return;
    const lead = readLead(doc, win);
    if (!isContactComplete(lead)) return;
    f.started = true;
    f.lead = { ...lead, rental_estimation: estimate };
    send(f);
  }

  // Promise the result transition waits on, or null when nothing is in flight.
  function holdForLead() {
    const f = flow;
    if (f.armed && !f.started) start(readDomEstimate(doc));
    if (!f.sending) return null;
    if (!f.hold) f.hold = Promise.race([f.sending, sleep(cap)]);
    return f.hold;
  }

  function makeGate(fn) {
    const gate = function (key, ...rest) {
      if (!alive || key !== "result") return fn.call(this, key, ...rest);
      const f = flow;
      const hold = holdForLead();
      if (!hold) return fn.call(this, key, ...rest);
      hold.then(() => {
        // A restart while waiting cancels the pending result screen.
        if (!alive || f === flow) fn.call(this, key, ...rest);
      });
    };
    gate[GATE] = true;
    return gate;
  }

  const wrap = (v) => (typeof v === "function" && !v[GATE] ? makeGate(v) : v);

  // Chain with whatever estGoTo is (or later becomes): engine.js and page wrappers
  // assign window.estGoTo; each assigned function is wrapped, never replaced.
  let current = wrap(win.estGoTo);
  Object.defineProperty(win, "estGoTo", {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (v) => {
      current = wrap(v);
    },
  });

  function onClick(e) {
    const t = e.target;
    if (!t || typeof t.closest !== "function") return;
    if (t.closest("[start-ready-button]")) {
      if (flow.armed) return; // double click / repeat in this enquiry
      if (!isContactComplete(readLead(doc, win))) return; // the funnel shows its own errors
      flow.armed = true;
      return;
    }
    if (t.closest("[start-restart]")) {
      flow = newFlow();
      setState(null);
      return;
    }
    if (t.closest("[data-lead-retry]")) {
      const f = flow;
      if (f.started && !f.sending && root.getAttribute("data-lead-state") === "failed") send(f);
    }
  }

  function onEstimate(e) {
    start(e?.detail?.estimateRange || readDomEstimate(doc));
  }

  doc.addEventListener("click", onClick);
  win.addEventListener("staymo:estimate-ready", onEstimate);

  return function destroy() {
    alive = false;
    doc.removeEventListener("click", onClick);
    win.removeEventListener("staymo:estimate-ready", onEstimate);
    const fn = current;
    delete win.estGoTo;
    if (fn !== undefined) win.estGoTo = fn; // a gate passes straight through once !alive
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => initLead());
}
