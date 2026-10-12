/* Hero forms → /start-hosting. Ported from two inline site-wide embeds with the same
   behaviour, plus one change: the ad params of the current page (utm_*, hsa_*, gclid,
   fbclid, msclkid — the same set and order as header-address.js) ride along, so HubSpot
   sees the campaign instead of "Direct". Nothing is stored.
   - Main estimate ("DataTransfer.js (Main Page Logic for MULTIPLE Forms)"): every
     [data-form-type="main-estimate"] with [data-input-id="address-search" | "postal-code-result" |
     "beds-count"] and [data-action="get-estimate"] (optional [data-input-id="page-title"]).
     A click: beds (an input's value, else the element's text, else data-value) holding
     "beds" → alert; "studio" → 0, "5+" → 5; then window.staymoValidateAddress, a failure →
     window.staymoShowAddrError; empty beds → alert. Then
     /start-hosting?address&postal-code&beds&sourcepath=<page-title value>.
   - Standalone hero (inline "SCRIPT 2: Standalone hero form redirect"): form#email-form-3.
     A click on its first [data-action="get-estimate"] / #step_continue-hero / button, or a
     submit: no address / postcode (falls back to one found in the address) → is-error on that
     field, no redirect. Beds default to 1, sourcepath to document.title, then the pathname.
     The id and name selectors are the old embed's, kept as they are: the Webflow form ships
     with them (README: data-* only, except markup that cannot carry it).
   Both bind when #email-form-3 sits inside a main-estimate wrapper (/airbnb-property-calculator):
   main first, as on the site. The hero's redirect runs at once, the main one after its async
   address check, so the main URL is the one the browser goes to, unless main stops (an alert,
   a failed address), and then the hero's URL stands. */

const PASS_THROUGH = /^(utm_|hsa_)|^(gclid|fbclid|msclkid)$/;
const START_URL = "/start-hosting";
const BEDS_ALERT = "Please select the number of bedrooms.";

const HERO_ADDRESS = '[data-places-address], [data-input-id="address-search"], [rbpu-element="address"], input[name="body"]';
const HERO_POSTAL = '[data-input-id="postal-code-result"], input[name="postal-code"], input[name="postcode"]';
const HERO_BEDS = '[data-input-id="beds-count"], [data-input="beds"], input[name="beds"]';
const HERO_TITLE = '[data-input-id="page-title"], input[name="page_title"]';
const HERO_BUTTON = '[data-action="get-estimate"], #step_continue-hero, button[type="submit"], button';

// --- Pure helpers ---

// Ad/campaign params worth carrying to /start-hosting, in their original order
// (a copy of header-address.js: modules don't import each other).
export function passThroughParams(search) {
  const out = [];
  new URLSearchParams(search || "").forEach((value, key) => {
    if (PASS_THROUGH.test(key)) out.push([key, value]);
  });
  return out;
}

// address, postal-code, beds, sourcepath — then the ad params.
export function buildStartUrl({ address, postal, beds, sourcepath, search }) {
  const params = new URLSearchParams();
  params.set("address", address);
  params.set("postal-code", postal);
  params.set("beds", beds);
  params.set("sourcepath", sourcepath);
  passThroughParams(search).forEach(([k, v]) => params.append(k, v));
  return `${START_URL}?${params.toString()}`;
}

// Main form beds: {beds} (maybe ""), or {placeholder: true} for the "N beds" text.
export function mainBeds(raw) {
  let beds = (raw || "").trim().toLowerCase();
  if (beds.includes("beds")) return { placeholder: true };
  if (beds === "studio") beds = "0";
  if (beds === "5+") beds = "5";
  return { beds };
}

// "sw1a1aa, London" → "SW1A 1AA"; "" when the text has no full postcode.
export function extractPostcode(value) {
  const match = (value || "").toString().toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i);
  if (!match) return "";
  return match[0].toUpperCase().replace(/\s+/g, "").replace(/^(.+)(\d[A-Z]{2})$/, "$1 $2");
}

// --- Browser glue ---

function go(win, url) {
  win.location.href = url;
}

export function initMainEstimate(win = window, doc = document) {
  const wrappers = [...doc.querySelectorAll('[data-form-type="main-estimate"]')];
  let bound = 0;
  wrappers.forEach((wrap) => {
    const addressInput = wrap.querySelector('[data-input-id="address-search"]');
    const postalInput = wrap.querySelector('[data-input-id="postal-code-result"]');
    const bedsInput = wrap.querySelector('[data-input-id="beds-count"]');
    const pageTitle = wrap.querySelector('[data-input-id="page-title"]');
    const button = wrap.querySelector('[data-action="get-estimate"]');
    if (!addressInput || !postalInput || !bedsInput || !button) return;
    bound++;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      const raw = bedsInput.value || bedsInput.textContent || bedsInput.getAttribute("data-value");
      const { beds, placeholder } = mainBeds(raw);
      if (placeholder) {
        win.alert(BEDS_ALERT);
        return;
      }
      // A real dropdown pick, or text that geocodes to a UK postcode.
      const ok = await win.staymoValidateAddress(addressInput);
      if (!ok) {
        win.staymoShowAddrError(addressInput);
        return;
      }
      if (!beds) {
        win.alert(BEDS_ALERT);
        return;
      }
      go(
        win,
        buildStartUrl({
          address: addressInput.value.trim(),
          postal: postalInput.value.trim(),
          beds,
          sourcepath: pageTitle ? pageTitle.value.trim() : "",
          search: win.location.search,
        })
      );
    });
  });
  return bound;
}

export function initHeroForm(win = window, doc = document) {
  const form = doc.querySelector("#email-form-3");
  if (!form) return null;
  const addressInput = form.querySelector(HERO_ADDRESS);
  const postalInput = form.querySelector(HERO_POSTAL);
  const bedsInput = form.querySelector(HERO_BEDS);
  const titleInput = form.querySelector(HERO_TITLE);
  const button = form.querySelector(HERO_BUTTON);

  const value = (input) => (!input || input.value == null ? "" : input.value.toString().trim());
  const markError = (input) => input && input.classList.add("is-error");
  const clearError = (input) => input && input.classList.remove("is-error");

  const redirect = () => {
    const address = value(addressInput);
    const postal = value(postalInput) || extractPostcode(address);
    const beds = value(bedsInput) || "1";
    const sourcepath = value(titleInput) || doc.title || win.location.pathname;
    [addressInput, postalInput, bedsInput].forEach(clearError);
    if (!address) return markError(addressInput);
    if (!postal) return markError(postalInput);
    go(win, buildStartUrl({ address, postal, beds, sourcepath, search: win.location.search }));
  };

  if (button) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      redirect();
    });
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
    redirect();
  });
  [addressInput, postalInput, bedsInput].forEach((input) => {
    if (!input) return;
    input.addEventListener("input", () => clearError(input));
    input.addEventListener("change", () => clearError(input));
  });
  return { form, button, redirect };
}

// Main before hero: the order the two embeds bound in, which decides the winner (see the header).
export function initStartRedirect(win = window, doc = document) {
  return { main: initMainEstimate(win, doc), hero: initHeroForm(win, doc) };
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => initStartRedirect());
}
