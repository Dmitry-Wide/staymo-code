/* Pre-lead: URL → form prefill + referral attribution.
   Consolidates three inline embeds, ported 1:1:
   - Form Initializer: URL params (address / postal-code / beds) prefill the
     start-host form and auto-click Start.
   - Estimate link (?beds=N&goal=X, no address/postcode): marks the bedroom tile
     and checks the step-1 goal radio (maximise / guaranteed / balance) without
     auto-clicking; the visitor still types the address on step 0. The goal
     radios carry no data-* (Webflow form fields), so they bind to their field
     name input[name="smarthost_goals"].
   - Address handoff (header-address.js): ?postal-code without beds, or no params
     but a fresh sessionStorage "staymo_address", prefills the address step
     without auto-clicking.
   - Address clear: button[data-addr-change] (the × inside the step-0 address
     field; CSS hides it while the field is empty) clears the address, postcode
     and sessionStorage "staymo_address" — wired on every load, prefill or not.
   - Referrer attribution: ?referral-type=referred stores referrer-name/email
     cookies and injects them as hidden fields into every form — only after
     Cookiebot marketing consent (personal data of the referrer). Before
     consent only the ?referral code is kept.
   - Referral cookie: ?referral is stored to a cookie and written into #referral.
   - First touch: on the visit's first page (no referrer or an external one) and
     only with Cookiebot Statistics consent, sessionStorage "staymo_first_touch"
     keeps the landing URL (origin + path) and the external referrer, once per
     visit. Consent given later on that same page writes it then; a later page
     writes nothing (its landing is unknown). lead.js sends it as lead_start /
     first_referrer.
   - Legacy cleanup: the removed inline "UTM Tracking Passthrough" embed wrote
     cookies and localStorage keys "staymo_tracking_<key>" before any consent;
     nothing reads them. Every load deletes both (deleting needs no consent).
   JS binds to contract attributes only. */

const REFERRER_COOKIE_DAYS = 28;
const REFERRAL_COOKIE_DAYS = 30;

function currentSearch() {
  return typeof location !== "undefined" ? location.search : "";
}

export function getURLParam(name, search = currentSearch()) {
  return new URLSearchParams(search).get(name);
}

export function getCookie(name, cookieStr = typeof document !== "undefined" ? document.cookie : "") {
  const nameEQ = name + "=";
  for (const part of cookieStr.split(";")) {
    const c = part.trim();
    if (c.indexOf(nameEQ) !== 0) continue;
    const raw = c.substring(nameEQ.length);
    // Legacy cookies from the old inline scripts were written raw (e.g. a stray "%").
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

// The value is URI-encoded so ";", "," or spaces from the URL cannot add cookie attributes.
export function buildCookie(name, value, days) {
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  return `${name}=${encodeURIComponent(value || "")}; expires=${date.toUTCString()}; path=/; SameSite=Lax`;
}

// The tile funnel has no [data-input-id="beds-count"]: bedrooms are picked with
// [data-room] tiles backed by a hidden [data-rooms-input]. Mark the tile the URL
// asks for (clamped to the tiles on offer) and write the input, so beds.js,
// engine.js and valuation.js all read the number the visitor chose upstream.
// Above the last tile ("4 +") that tile is marked but the input keeps the asked
// whole number (up to the hero stepper's max), so valuation and the lead get it.
export const MAX_KEPT_BEDS = 10;

export function applyBedsToTiles(doc, beds) {
  const container = doc.querySelector("[data-rooms]");
  const tiles = container ? [...container.querySelectorAll("[data-room]")] : [];
  if (!tiles.length) return false;

  const asked = Number(String(beds).trim());
  if (!Number.isFinite(asked)) return false;

  const values = tiles.map((t) => Number(t.getAttribute("data-room")));
  const top = Math.max(...values);
  const wanted = Math.min(Math.max(asked, Math.min(...values)), top);
  const kept = Number.isInteger(asked) && asked > top ? Math.min(asked, Math.max(MAX_KEPT_BEDS, top)) : wanted;
  // Last match wins: the funnel still ships a "Studio" tile sharing data-room="1" with "1".
  const tile = tiles.filter((t) => Number(t.getAttribute("data-room")) === wanted).pop();
  if (!tile) return false;

  tiles.forEach((t) => t.classList.toggle("is-bed-selected", t === tile));

  const input = container.querySelector("[data-rooms-input]");
  if (input) {
    input.value = String(kept);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return true;
}

// Check the step-1 goal radio named by ?goal. checked is set without a change
// event: engine.js auto-advances a radio step on change.
export const GOALS = ["maximise", "guaranteed", "balance"];

export function applyGoal(root, goal) {
  const value = String(goal || "").trim().toLowerCase();
  if (!GOALS.includes(value)) return false;
  const radio = root.querySelector(`input[type="radio"][name="smarthost_goals"][value="${value}"]`);
  if (!radio) return false;
  radio.checked = true;
  return true;
}

// --- Address handoff: sessionStorage written by header-address.js ---
// Same key/format as header-address.js (duplicated: modules don't import each other).
export const STORED_ADDRESS_KEY = "staymo_address";
const STORED_ADDRESS_TTL_MS = 30 * 60 * 1000;

function sessionStore() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch (e) {
    return null;
  }
}

export function readStoredAddress(storage = sessionStore(), now = Date.now()) {
  try {
    const raw = storage && storage.getItem(STORED_ADDRESS_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !entry.address || !entry.postal) return null;
    const age = now - Number(entry.ts);
    return age >= 0 && age < STORED_ADDRESS_TTL_MS ? entry : null;
  } catch (e) {
    return null;
  }
}

const samePostcode = (a, b) =>
  String(a || "").replace(/\s+/g, "").toUpperCase() === String(b || "").replace(/\s+/g, "").toUpperCase();

// Fill address + postcode (+ beds) on step 0 without starting; the visitor
// confirms bedrooms. Returns true when something was filled.
function prefillAddressStep(doc, form, { address, postalCode, beds }) {
  const addressInput = form.querySelector('[data-input-id="address-search"]');
  const postalCodeInput = form.querySelector('[data-input-id="postal-code-result"]');
  if (addressInput) {
    addressInput.value = address;
    addressInput.dataset.placeSelected = "1";
  }
  if (postalCodeInput) postalCodeInput.value = postalCode;
  if (beds !== undefined && beds !== null && beds !== "") {
    const bedsInput = form.querySelector('[data-input-id="beds-count"]');
    if (bedsInput) bedsInput.value = beds;
    else applyBedsToTiles(form, beds);
  }

  const tile = form.querySelector("[data-rooms] [data-room].is-bed-selected");
  if (tile && tile.matches('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')) {
    tile.focus({ preventScroll: true });
  }

  return true;
}

// --- Address clear (×) on step 0 ---
const clearBound = new WeakSet();

export function initAddressClear(
  doc = document,
  storage = sessionStore(),
  win = typeof window !== "undefined" ? window : undefined
) {
  doc.querySelectorAll("[data-addr-change]").forEach((btn) => {
    if (clearBound.has(btn)) return;
    const form = btn.closest('[data-form-type="start-host"]') || doc.querySelector('[data-form-type="start-host"]');
    if (!form) return;
    clearBound.add(btn);
    const addressInput = form.querySelector('[data-input-id="address-search"]');
    const postalCodeInput = form.querySelector('[data-input-id="postal-code-result"]');
    // Keep focus in the field so it doesn't blur-validate before the click.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      // Otherwise the header (header-address.js) prefills the old address again.
      try {
        if (storage) storage.removeItem(STORED_ADDRESS_KEY);
      } catch (err) {}
      if (postalCodeInput) postalCodeInput.value = "";
      if (addressInput) {
        addressInput.value = "";
        delete addressInput.dataset.placeSelected;
        if (win && typeof win.staymoClearAddrError === "function") win.staymoClearAddrError(addressInput);
        addressInput.focus();
      }
    });
  });
}

// --- Form Initializer: URL → prefill + auto-click Start ---
export function prefillFromURL(doc = document, search = currentSearch(), storage = sessionStore(), now = Date.now()) {
  const form = doc.querySelector('[data-form-type="start-host"]');
  if (!form) return false;
  const address = getURLParam("address", search);
  const postalCode = getURLParam("postal-code", search);
  const beds = getURLParam("beds", search);
  if (!(address && postalCode && beds)) {
    if (!address && !postalCode && beds) {
      applyBedsToTiles(form, beds);
      applyGoal(doc, getURLParam("goal", search));
      return true;
    }
    const stored = readStoredAddress(storage, now);
    if (postalCode && !beds) {
      const match = stored && samePostcode(stored.postal, postalCode) ? stored : null;
      return prefillAddressStep(doc, form, {
        address: address || (match ? match.address : postalCode),
        postalCode,
        beds: match ? match.beds : undefined,
      });
    }
    if (!address && !postalCode && !beds && stored) {
      return prefillAddressStep(doc, form, { address: stored.address, postalCode: stored.postal, beds: stored.beds });
    }
    return false;
  }
  const addressInput = form.querySelector('[data-input-id="address-search"]');
  const postalCodeInput = form.querySelector('[data-input-id="postal-code-result"]');
  const bedsInput = form.querySelector('[data-input-id="beds-count"]');
  if (addressInput) addressInput.value = address;
  if (postalCodeInput) postalCodeInput.value = postalCode;
  if (bedsInput) bedsInput.value = beds;
  else applyBedsToTiles(form, beds);
  const startButton = doc.querySelector("[start-start-button]");
  if (startButton) setTimeout(() => startButton.click(), 100);
  return true;
}

// --- Referrer attribution: capture cookies, inject hidden fields ---
export function hasReferrerConsent(win = typeof window !== "undefined" ? window : undefined) {
  return Boolean(win && win.Cookiebot && win.Cookiebot.consent && win.Cookiebot.consent.marketing);
}

export function captureReferrerCookies(search = currentSearch(), consented = hasReferrerConsent()) {
  if (!consented) return;
  if (getURLParam("referral-type", search) !== "referred") return;
  const name = getURLParam("referrer-name", search);
  const email = getURLParam("referrer-email", search);
  if (name) document.cookie = buildCookie("referrer-name", name, REFERRER_COOKIE_DAYS);
  if (email) document.cookie = buildCookie("referrer-email", email, REFERRER_COOKIE_DAYS);
}

export function injectReferrerFields(doc = document, consented = hasReferrerConsent()) {
  if (!consented) return;
  const name = getCookie("referrer-name");
  const email = getCookie("referrer-email");
  if (!(name || email)) return;
  doc.querySelectorAll("form").forEach((form) => {
    if (form.querySelector('input[name="referrer-name"], input[name="referrer-email"]')) return;
    const fragment = doc.createDocumentFragment();
    if (name) fragment.appendChild(hiddenInput(doc, "referrer-name", name));
    if (email) fragment.appendChild(hiddenInput(doc, "referrer-email", email));
    form.appendChild(fragment);
  });
}

function hiddenInput(doc, name, value) {
  const input = doc.createElement("input");
  input.type = "hidden";
  input.name = name;
  input.value = value;
  return input;
}

// Runs now if consent is already given, otherwise once Cookiebot reports acceptance.
export function initReferrerAttribution(win = window, doc = document, search = currentSearch()) {
  const run = () => {
    if (!hasReferrerConsent(win)) return;
    captureReferrerCookies(search, true);
    injectReferrerFields(doc, true);
  };
  run();
  win.addEventListener("CookiebotOnAccept", run);
}

// --- Referral cookie: ?referral → cookie → #referral ---
export function captureReferral(search = currentSearch()) {
  const urlReferral = getURLParam("referral", search) || "";
  if (urlReferral && !getCookie("referral")) {
    document.cookie = buildCookie("referral", urlReferral, REFERRAL_COOKIE_DAYS);
  }
}

export function injectReferral(doc = document) {
  const value = getCookie("referral");
  const input = doc.getElementById("referral");
  if (input && value) input.value = value;
}

// --- First touch: landing page + external referrer (Statistics consent only) ---
// Same key/format as lead.js (duplicated: modules don't import each other).
export const FIRST_TOUCH_KEY = "staymo_first_touch";
const FIRST_TOUCH_MAX = 255;

export function hasStatisticsConsent(win = typeof window !== "undefined" ? window : undefined) {
  return win?.Cookiebot?.consent?.statistics === true;
}

// External referrer of this page, "" when there is none; null when the referrer is
// this site (not the visit's first page).
export function externalReferrer(referrer, host) {
  const ref = String(referrer || "").trim();
  if (!ref) return "";
  try {
    return new URL(ref).host === host ? null : ref;
  } catch (e) {
    return ref;
  }
}

// Writes the first-touch entry when this page is the visit's landing page, consent
// is given and nothing is stored yet. Returns true when it wrote.
export function captureFirstTouch(win = window, doc = document, storage = sessionStore()) {
  if (!hasStatisticsConsent(win)) return false;
  const loc = win.location;
  const referrer = externalReferrer(doc.referrer, loc.host);
  if (referrer === null) return false;
  try {
    if (!storage || storage.getItem(FIRST_TOUCH_KEY)) return false;
    const entry = {
      landing: (loc.origin + loc.pathname).slice(0, FIRST_TOUCH_MAX),
      referrer: referrer.slice(0, FIRST_TOUCH_MAX),
    };
    storage.setItem(FIRST_TOUCH_KEY, JSON.stringify(entry));
    return true;
  } catch (e) {
    return false;
  }
}

// Runs now, and again if consent is accepted later on this same page.
export function initFirstTouch(win = window, doc = document, storage = sessionStore()) {
  const run = () => captureFirstTouch(win, doc, storage);
  run();
  win.addEventListener("CookiebotOnAccept", run);
}

// --- Legacy cleanup: staymo_tracking_* from the removed UTM passthrough embed ---
export const LEGACY_TRACKING_PREFIX = "staymo_tracking_";

function localStore() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (e) {
    return null;
  }
}

// The embed wrote host-only cookies with path=/; the domain variants cover a
// copy set with a domain attribute. Returns the cookie names expired.
export function clearLegacyTrackingCookies(doc = document, host = typeof location !== "undefined" ? location.hostname : "") {
  const names = [];
  try {
    for (const part of String(doc.cookie || "").split(";")) {
      const name = part.split("=")[0].trim();
      if (name.indexOf(LEGACY_TRACKING_PREFIX) === 0 && !names.includes(name)) names.push(name);
    }
    const expire = `=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=/`;
    for (const name of names) {
      doc.cookie = name + expire;
      if (host) {
        doc.cookie = `${name}${expire}; domain=${host}`;
        doc.cookie = `${name}${expire}; domain=.${host}`;
      }
    }
  } catch (e) {}
  return names;
}

// Returns the localStorage keys removed.
export function clearLegacyTrackingStorage(storage = localStore()) {
  const keys = [];
  try {
    if (!storage) return keys;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.indexOf(LEGACY_TRACKING_PREFIX) === 0) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch (e) {}
  return keys;
}

export function clearLegacyTracking(doc = document, storage = localStore()) {
  clearLegacyTrackingCookies(doc);
  clearLegacyTrackingStorage(storage);
}

if (typeof window !== "undefined") {
  clearLegacyTracking();
  // Capture the referral cookie ASAP (matches the original IIFE timing).
  captureReferral();
  window.addEventListener("DOMContentLoaded", () => {
    initAddressClear();
    prefillFromURL();
    initReferrerAttribution();
    injectReferral();
    initFirstTouch();
  });
}
