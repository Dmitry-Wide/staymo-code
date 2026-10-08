/* Pre-lead: URL → form prefill + referral attribution.
   Consolidates three inline embeds, ported 1:1:
   - Form Initializer: URL params (address / postal-code / beds) prefill the
     start-host form and auto-click Start.
   - Address handoff (header-address.js): ?postal-code without beds, or no params
     but a fresh sessionStorage "staymo_address", prefills the address step
     without auto-clicking; [data-addr-change] lets the visitor clear it.
   - Referrer attribution: ?referral-type=referred stores referrer-name/email
     cookies and injects them as hidden fields into every form — only after
     Cookiebot marketing consent (personal data of the referrer). Before
     consent only the ?referral code is kept.
   - Referral cookie: ?referral is stored to a cookie and written into #referral.
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
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length);
  }
  return null;
}

export function buildCookie(name, value, days) {
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  return `${name}=${value || ""}; expires=${date.toUTCString()}; path=/; SameSite=Lax`;
}

// The tile funnel has no [data-input-id="beds-count"]: bedrooms are picked with
// [data-room] tiles backed by a hidden [data-rooms-input]. Mark the tile the URL
// asks for (clamped to the tiles on offer) and write the input, so beds.js,
// engine.js and valuation.js all read the number the visitor chose upstream.
export function applyBedsToTiles(doc, beds) {
  const container = doc.querySelector("[data-rooms]");
  const tiles = container ? [...container.querySelectorAll("[data-room]")] : [];
  if (!tiles.length) return false;

  const asked = Number(String(beds).trim());
  if (!Number.isFinite(asked)) return false;

  const values = tiles.map((t) => Number(t.getAttribute("data-room")));
  const wanted = Math.min(Math.max(asked, Math.min(...values)), Math.max(...values));
  // Last match wins: the funnel still ships a "Studio" tile sharing data-room="1" with "1".
  const tile = tiles.filter((t) => Number(t.getAttribute("data-room")) === wanted).pop();
  if (!tile) return false;

  tiles.forEach((t) => t.classList.toggle("is-bed-selected", t === tile));

  const input = container.querySelector("[data-rooms-input]");
  if (input) {
    input.value = String(wanted);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
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

  doc.querySelectorAll("[data-addr-change]").forEach((btn) => {
    btn.removeAttribute("hidden");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (postalCodeInput) postalCodeInput.value = "";
      if (addressInput) {
        addressInput.value = "";
        delete addressInput.dataset.placeSelected;
        addressInput.focus();
      }
    });
  });
  return true;
}

// --- Form Initializer: URL → prefill + auto-click Start ---
export function prefillFromURL(doc = document, search = currentSearch(), storage = sessionStore(), now = Date.now()) {
  const form = doc.querySelector('[data-form-type="start-host"]');
  if (!form) return false;
  const address = getURLParam("address", search);
  const postalCode = getURLParam("postal-code", search);
  const beds = getURLParam("beds", search);
  if (!(address && postalCode && beds)) {
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

if (typeof window !== "undefined") {
  // Capture the referral cookie ASAP (matches the original IIFE timing).
  captureReferral();
  window.addEventListener("DOMContentLoaded", () => {
    prefillFromURL();
    initReferrerAttribution();
    injectReferral();
  });
}
