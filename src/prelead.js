/* Pre-lead: URL → form prefill + referral attribution.
   Consolidates three inline embeds, ported 1:1:
   - Form Initializer: URL params (address / postal-code / beds) prefill the
     start-host form and auto-click Start.
   - Referrer attribution: ?referral-type=referred stores referrer-name/email
     cookies and injects them as hidden fields into every form.
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

// --- Form Initializer: URL → prefill + auto-click Start ---
export function prefillFromURL(doc = document, search = currentSearch()) {
  const form = doc.querySelector('[data-form-type="start-host"]');
  if (!form) return false;
  const address = getURLParam("address", search);
  const postalCode = getURLParam("postal-code", search);
  const beds = getURLParam("beds", search);
  if (!(address && postalCode && beds)) return false;
  const addressInput = form.querySelector('[data-input-id="address-search"]');
  const postalCodeInput = form.querySelector('[data-input-id="postal-code-result"]');
  const bedsInput = form.querySelector('[data-input-id="beds-count"]');
  if (addressInput) addressInput.value = address;
  if (postalCodeInput) postalCodeInput.value = postalCode;
  if (bedsInput) bedsInput.value = beds;
  const startButton = doc.querySelector("[start-start-button]");
  if (startButton) setTimeout(() => startButton.click(), 100);
  return true;
}

// --- Referrer attribution: capture cookies, inject hidden fields ---
export function captureReferrerCookies(search = currentSearch()) {
  if (getURLParam("referral-type", search) !== "referred") return;
  const name = getURLParam("referrer-name", search);
  const email = getURLParam("referrer-email", search);
  if (name) document.cookie = buildCookie("referrer-name", name, REFERRER_COOKIE_DAYS);
  if (email) document.cookie = buildCookie("referrer-email", email, REFERRER_COOKIE_DAYS);
}

export function injectReferrerFields(doc = document) {
  const name = getCookie("referrer-name");
  const email = getCookie("referrer-email");
  if (!(name || email)) return;
  doc.querySelectorAll("form").forEach((form) => {
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
    captureReferrerCookies();
    injectReferrerFields();
    injectReferral();
  });
}
