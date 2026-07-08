/* Google Places address autocomplete — fills the nearest postal-code input.
   JS binds to contract attributes only; behaviour ported 1:1 from the inline embed.
   Loads the Google Maps Places library once and attaches on focus (works for
   inputs added later by the stepper/IX). The API key is a client-side,
   referrer-restricted Maps key — already public in page markup. */

export const GOOGLE_API_KEY = "AIzaSyBCf0dHApfYxWMyEAiR3hu4EPe6-4MzgKE";

const ADDRESS_SELECTOR = '[data-input-id="address-search"]';
const POSTAL_SELECTOR = '[data-input-id="postal-code-result"]';

// Postal code out of a Google address_components array (place or geocode result).
export function extractPostal(components) {
  const comps = components || [];
  return comps.find((c) => c.types?.includes("postal_code"))?.long_name || "";
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
  let hasSelectedPlace = false;
  function runGeocodingFallback() {
    if (postalCodeInput.value) return;
    const placeText = addressInput.value.trim();
    if (!placeText) return;
    fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        placeText
      )}&key=${GOOGLE_API_KEY}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.status !== "OK" || !data.results?.length) return;
        const postal = extractPostal(data.results[0].address_components);
        if (postal) postalCodeInput.value = postal;
      })
      .catch((err) => console.error("Geocode fallback error:", err));
  }
  const autocomplete = new google.maps.places.Autocomplete(addressInput, {
    fields: ["address_components", "geometry"],
    componentRestrictions: { country: ["gb"] },
  });
  autocomplete.addListener("place_changed", () => {
    const place = autocomplete.getPlace();
    // A real dropdown pick carries geometry; pressing Enter on free text does not.
    if (!place || !place.geometry) {
      hasSelectedPlace = false;
      addressInput.dataset.placeSelected = "";
      return;
    }
    hasSelectedPlace = true;
    addressInput.dataset.placeSelected = "1";
    const postal = extractPostal(place.address_components);
    if (postal) postalCodeInput.value = postal;
    else runGeocodingFallback();
  });
  addressInput.addEventListener("focus", () => {
    hasSelectedPlace = false;
  });
  // Any manual edit invalidates a previous selection (postcode refilled on blur/next).
  addressInput.addEventListener("input", () => {
    hasSelectedPlace = false;
    addressInput.dataset.placeSelected = "";
    postalCodeInput.value = "";
  });
  addressInput.addEventListener("blur", () => {
    if (!hasSelectedPlace) runGeocodingFallback();
  });
}

// True if the address is a real dropdown pick or resolves to a UK postcode.
// Fills the postcode input as a side effect (on-demand geocode when needed).
// Used by the funnel engine to gate the address step.
export async function isRealAddress(addressInput, postcodeInput) {
  if (!addressInput) return false;
  const postal = postcodeInput || findNearestPostalInput(addressInput);
  if (addressInput.dataset.placeSelected === "1") return true;
  if (postal && String(postal.value || "").trim()) return true;
  const text = String(addressInput.value || "").trim();
  if (!text) return false;
  try {
    const r = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        text
      )}&components=country:GB&key=${GOOGLE_API_KEY}`
    );
    const data = await r.json();
    if (data.status !== "OK" || !data.results?.length) return false;
    const found = extractPostal(data.results[0].address_components);
    if (found && postal) postal.value = found;
    return !!found;
  } catch (e) {
    return false;
  }
}

export function initAutocomplete(doc = document) {
  doc.querySelectorAll(ADDRESS_SELECTOR).forEach(attachPlacesOnce);
}

function loadGoogleMaps(doc = document) {
  const script = doc.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_API_KEY}&libraries=places&callback=initAutocomplete`;
  script.async = true;
  script.defer = true;
  doc.body.appendChild(script);
}

if (typeof window !== "undefined") {
  // Attach on focus — covers inputs added later by the stepper/IX.
  document.addEventListener("focusin", (e) => {
    if (e.target?.matches(ADDRESS_SELECTOR)) attachPlacesOnce(e.target);
  });
  // Google Maps calls this back once the Places library is ready.
  window.initAutocomplete = () => initAutocomplete();
  window.geolocate = () => console.log("Geolocate called.");
  // Exposed for the funnel engine (cross-module, avoids ESM version pinning).
  window.staymoIsRealAddress = isRealAddress;
  window.addEventListener("DOMContentLoaded", () => loadGoogleMaps());
}
