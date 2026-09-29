/* Google Places address autocomplete — fills the nearest postal-code input.
   JS binds to contract attributes only; behaviour ported 1:1 from the inline embed.
   Loads the Google Maps Places library once, on the first focus of an address
   field, and attaches on focus (works for inputs added later by the stepper/IX).
   The API key is a browser key, restricted by website referrer — already public
   in page markup. Referrer restrictions only cover client-side APIs, so
   geocoding goes through google.maps.Geocoder (Maps JS API), never the
   Geocoding REST web service.
   An address counts when it has a UK postcode — full ("SW1V 1LW") or just the
   outward part ("E14", enough for a first estimate): from a dropdown pick (looked
   up if the place has none, e.g. a street), or typed text (an address or a
   postcode) that Google resolves without a partial match; the field then shows
   the address as Google understood it. Anything else shows a hint under the
   field — never a silent dead button. */

export const GOOGLE_API_KEY = "AIzaSyBCf0dHApfYxWMyEAiR3hu4EPe6-4MzgKE";

const ADDRESS_SELECTOR = '[data-input-id="address-search"]';
const POSTAL_SELECTOR = '[data-input-id="postal-code-result"]';

// Postal code out of a Google address_components array (place or geocode result).
export function extractPostal(components) {
  const comps = components || [];
  return comps.find((c) => c.types?.includes("postal_code"))?.long_name || "";
}

// Resolves true once the Maps library is ready — loading it if nobody focused
// the address field yet (Maps is lazy) — or false after timeoutMs.
const mapsWaiters = [];
export function whenMapsReady(timeoutMs = 10000) {
  if (window.google?.maps?.Geocoder) return Promise.resolve(true);
  loadGoogleMaps();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    mapsWaiters.push(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

// Geocode through the Maps JS API (works under a referrer-restricted key).
// Resolves to the results array; [] on no match, error or Maps not loading.
export async function geocode(request) {
  if (!(await whenMapsReady())) return [];
  try {
    const { results } = await new window.google.maps.Geocoder().geocode(request);
    return results || [];
  } catch (e) {
    // ZERO_RESULTS rejects too — only real failures are worth logging.
    if (e?.code !== "ZERO_RESULTS") console.error("Geocode error:", e);
    return [];
  }
}

// --- "Choose an address from the list" hint, placed right after the input ---
const HINT_CLASS = "staymo-addr-error";
export const ADDR_HINT = "Choose an address from the list or enter a postcode";

function injectHintStyle(doc) {
  if (doc.getElementById("staymo-addr-err-style")) return;
  const s = doc.createElement("style");
  s.id = "staymo-addr-err-style";
  s.textContent =
    `.${HINT_CLASS}{color:#d92d20;margin-top:.375rem;font-size:.875rem;line-height:1.4;}` +
    `${ADDRESS_SELECTOR}.is-error{border-color:#d92d20 !important;}`;
  doc.head.appendChild(s);
}

export function showAddrError(addressInput, msg = ADDR_HINT) {
  if (!addressInput) return;
  const doc = addressInput.ownerDocument;
  injectHintStyle(doc);
  addressInput.classList.add("is-error");
  let hint = addressInput.nextElementSibling;
  if (!hint || !hint.classList.contains(HINT_CLASS)) {
    hint = doc.createElement("div");
    hint.className = HINT_CLASS;
    hint.setAttribute("role", "alert");
    addressInput.insertAdjacentElement("afterend", hint);
  }
  hint.textContent = msg;
}

export function clearAddrError(addressInput) {
  if (!addressInput) return;
  addressInput.classList.remove("is-error");
  const hint = addressInput.nextElementSibling;
  if (hint && hint.classList.contains(HINT_CLASS)) hint.remove();
}

// UK postcode, full ("SW1V 1LW") or outward only ("E14", "WC1", "SE25") — the outward
// part is enough for a first estimate (streets and districts carry only that).
const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?$/i;

// Resolve typed text (an address or a postcode) to { address, postal }, or null when
// Google only guessed (partial match) or found no postcode (e.g. just "London").
export async function resolveTypedAddress(text) {
  const results = await geocode({ address: text, componentRestrictions: { country: "GB" } });
  const top = results[0];
  if (!top || top.partial_match) return null;
  const postal = extractPostal(top.address_components);
  if (!POSTCODE.test(postal)) return null;
  const address = String(top.formatted_address || text).replace(/,\s*UK$/, "");
  return { address, postal };
}

// Ordinal position of an element in a document-order walk of element nodes.
export function getNodeIndex(el, doc = document) {
  let i = 0;
  const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  while (walk.nextNode()) {
    if (walk.currentNode === el) return i;
    i++;
  }
  return i;
}

// Find the postal-code input that belongs to a given address input: prefer the
// nearest shared container, else fall back to the DOM-position-closest one.
export function findNearestPostalInput(addressInput, doc = document) {
  const containers = [
    addressInput.closest("form"),
    addressInput.closest("[data-form-type]"),
    addressInput.closest("section"),
    addressInput.closest('[class*="block"]'),
    addressInput.closest('[class*="wrapper"]'),
    addressInput.closest('[class*="container"]'),
    addressInput.parentElement,
  ];
  for (const container of containers) {
    if (!container) continue;
    const found = container.querySelector(POSTAL_SELECTOR);
    if (found) return found;
  }
  const allPostal = [...doc.querySelectorAll(POSTAL_SELECTOR)];
  if (!allPostal.length) return null;
  if (allPostal.length === 1) return allPostal[0];
  const addrIndex = getNodeIndex(addressInput, doc);
  return allPostal.reduce((closest, el) => {
    const elDist = Math.abs(getNodeIndex(el, doc) - addrIndex);
    const closestDist = Math.abs(getNodeIndex(closest, doc) - addrIndex);
    return elDist < closestDist ? el : closest;
  });
}

export function attachPlacesOnce(addressInput) {
  if (!addressInput || addressInput.dataset.placesAttached === "1") return;
  const postalCodeInput = findNearestPostalInput(addressInput);
  if (!postalCodeInput) {
    console.warn("Postal code input not found near:", addressInput);
    return;
  }
  if (!window.google?.maps?.places?.Autocomplete) {
    console.error("Google Places not available.");
    return;
  }
  addressInput.dataset.placesAttached = "1";
  const autocomplete = new google.maps.places.Autocomplete(addressInput, {
    fields: ["address_components", "geometry"],
    componentRestrictions: { country: ["gb"] },
  });
  autocomplete.addListener("place_changed", () => {
    const place = autocomplete.getPlace();
    // A real dropdown pick carries geometry; pressing Enter on free text does not.
    if (!place || !place.geometry) {
      addressInput.dataset.placeSelected = "";
      return;
    }
    addressInput.dataset.placeSelected = "1";
    clearAddrError(addressInput);
    const postal = extractPostal(place.address_components);
    if (postal) postalCodeInput.value = postal;
    // A pick without a postcode (e.g. a street): look it up for that pick.
    else fillPostcodeFromPick(addressInput, postalCodeInput);
  });
  // Any manual edit invalidates a previous selection and its postcode.
  addressInput.addEventListener("input", () => {
    addressInput.dataset.placeSelected = "";
    postalCodeInput.value = "";
    clearAddrError(addressInput);
  });
}

// Postcode for a dropdown pick whose place carries none. Never makes typed text valid.
export async function fillPostcodeFromPick(addressInput, postalInput) {
  if (!postalInput || String(postalInput.value || "").trim()) return;
  const text = String(addressInput.value || "").trim();
  if (!text) return;
  const results = await geocode({ address: text, componentRestrictions: { country: "GB" } });
  const postal = results.length ? extractPostal(results[0].address_components) : "";
  if (POSTCODE.test(postal) && addressInput.dataset.placeSelected === "1") postalInput.value = postal;
}

// True for a dropdown pick with a postcode (looked up if the place has none), a
// postcode already filled (e.g. prefilled from another page), or typed text that
// resolves to a UK postcode — then the field shows Google's address and the
// postcode input is filled. Otherwise shows the hint. Used by the funnel engine to
// gate the address step.
export async function isRealAddress(addressInput, postcodeInput) {
  if (!addressInput) return false;
  const postal = postcodeInput || findNearestPostalInput(addressInput);
  if (addressInput.dataset.placeSelected === "1") {
    await fillPostcodeFromPick(addressInput, postal);
    // A pick Google has no postcode for (e.g. a whole city) cannot be estimated.
    if (postal && !String(postal.value || "").trim()) {
      showAddrError(addressInput);
      return false;
    }
    clearAddrError(addressInput);
    return true;
  }
  if (postal && String(postal.value || "").trim()) return true;
  const text = String(addressInput.value || "").trim();
  const found = text ? await resolveTypedAddress(text) : null;
  if (!found) {
    showAddrError(addressInput);
    return false;
  }
  addressInput.value = found.address;
  if (postal) postal.value = found.postal;
  clearAddrError(addressInput);
  return true;
}

export function initAutocomplete(doc = document) {
  doc.querySelectorAll(ADDRESS_SELECTOR).forEach(attachPlacesOnce);
}

// Load the Maps library (~400 KB) once, on demand — not on page load.
let mapsRequested = false;
function loadGoogleMaps(doc = document) {
  if (mapsRequested) return;
  mapsRequested = true;
  const script = doc.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_API_KEY}&libraries=places&callback=initAutocomplete`;
  script.async = true;
  script.defer = true;
  doc.body.appendChild(script);
}

if (typeof window !== "undefined") {
  // Attach on focus — covers inputs added later by the stepper/IX. The first
  // focus loads Maps; its callback (initAutocomplete) attaches every field.
  document.addEventListener("focusin", (e) => {
    if (!e.target?.matches(ADDRESS_SELECTOR)) return;
    if (window.google?.maps?.places?.Autocomplete) attachPlacesOnce(e.target);
    else loadGoogleMaps();
  });
  // Google Maps calls this back once the Places library is ready.
  window.initAutocomplete = () => {
    mapsWaiters.splice(0).forEach((resolve) => resolve());
    initAutocomplete();
  };
  window.geolocate = () => console.log("Geolocate called.");
  // Exposed for the funnel engine (cross-module, avoids ESM version pinning).
  window.staymoIsRealAddress = isRealAddress;
}
