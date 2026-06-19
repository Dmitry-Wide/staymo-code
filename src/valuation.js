/* Valuation + lead-transfer. JS binds to data-* / contract attributes only.
   Behaviour ported 1:1 from the inline embed; contract unchanged (rename = Plan 2c). */

export function getUTMFromURL(href) {
  const q = new URL(href).searchParams;
  const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
  const out = {};
  keys.forEach((k) => {
    const v = q.get(k);
    if (v !== null) out[k] = v;
  });
  return out;
}

export function splitFullName(fullName) {
  const parts = (fullName || "").toString().trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.length > 1 ? parts.slice(1).join(" ") : "" };
}

export function buildRequestBody({ fullAddress, postcode, beds, utm }) {
  const parts = [
    `Full_Address=${encodeURIComponent(fullAddress || postcode)}`,
    `postcode=${encodeURIComponent(postcode)}`,
    `Bedrooms-4=${encodeURIComponent(beds)}`,
  ];
  for (const [k, v] of Object.entries(utm || {})) {
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.join("&");
}

export function isValidEstimate(r) {
  const min = r?.minimum,
    max = r?.maximum;
  const okMin = min != null && String(min).trim() !== "" && String(min).trim() !== "0";
  const okMax = max != null && String(max).trim() !== "";
  return okMin && okMax;
}

export function getValue(el) {
  if (!el) return "";
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return (el.value || "").toString().trim();
  return (el.getAttribute("data-value") || el.getAttribute("value") || el.textContent || "").toString().trim();
}

export function getBedsValue(el) {
  if (!el) return "";
  const a = el.getAttribute("data-rooms-input");
  return a && a.trim() ? a.trim() : getValue(el);
}

function setFieldValue(el, value) {
  if (!el || value == null) return;
  const v = value.toString();
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    el.textContent = v;
  }
}

// Write a value to EVERY matching output (the same data-output can appear on the
// loading, noresults and result screens — a single querySelector would only fill one).
function writeOutputs(doc, sel, val) {
  doc.querySelectorAll(sel).forEach((el) => { el.textContent = val; });
}

export function applyOutputs(doc, { response, fullAddress, postcode, beds, leadstart }) {
  const occupancy = response?.occupancy || "84";
  const { minimum, maximum, annual, show_address: showAddress, ll_annual: llAnnual } = response || {};
  setFieldValue(doc.querySelector('[data-process="postcode"]'), postcode);
  setFieldValue(doc.querySelector('[data-process="property_bedrooms"]'), beds);
  setFieldValue(doc.querySelector('[data-process="property_address"]'), fullAddress || showAddress || postcode);
  setFieldValue(doc.querySelector('[data-process="sourcepath"]'), leadstart || "");
  const set = (sel, val) => writeOutputs(doc, sel, val);
  const num = (v) => Number(String(v ?? "").replace(/[^0-9.]/g, "")) || 0;
  const money = (v) => `£${num(v).toLocaleString("en-GB")}`;
  set('[data-output="minimum-value"]', money(minimum));
  set('[data-output="maximum-value"]', money(maximum));
  set('[data-output="estimate-range"]', response?.estimate || `${money(minimum)} - ${money(maximum)}`);
set('[data-output="occupancy-value"]', `${occupancy}%`);
  if (annual) set('[data-output="annual-revenue"]', money(annual));
  // Uplift vs a standard long-term let = short-term annual − long-term annual (ll_annual).
  const annualN = num(annual),
    occN = num(occupancy),
    llAnnualN = num(llAnnual);
  if (annualN && llAnnualN) set('[data-output="delta-annual"]', `+${money(annualN - llAnnualN)}`);
  // Derived stats (avg per month / avg nightly) — API gives annual + occupancy only.
  if (annualN) {
    const monthly = Math.round(annualN / 12);
    set('[data-output="monthly-value"]', money(monthly));
    if (occN) set('[data-output="nightly-value"]', money(Math.round(monthly / (30 * (occN / 100)))));
  }
  set('[data-output="address"]', showAddress || fullAddress || postcode);
const estimationValue = response?.estimate || `${money(response?.minimum)} - ${money(response?.maximum)}`;
const estimationField = doc.querySelector('[form_data="estimation"]');

function writeEstimationField() {
  if (!estimationField) return;

  estimationField.value = estimationValue;
  estimationField.defaultValue = estimationValue;
  estimationField.setAttribute("value", estimationValue);
}

writeEstimationField();
setTimeout(writeEstimationField, 100);
setTimeout(writeEstimationField, 500);
setTimeout(writeEstimationField, 1000);
window.dispatchEvent(new CustomEvent("staymo:estimate-ready", {
  detail: {
    response,
    estimationValue
  }
}));
window.estimateDebug = {
  fullResponse: response,
  estimate: response?.estimate,
  minimum: response?.minimum,
  maximum: response?.maximum,
  annual: response?.annual,
  estimationValue,
  fieldValue: estimationField ? estimationField.value : null,
  fieldAttribute: estimationField ? estimationField.getAttribute("value") : null,
  fieldDefaultValue: estimationField ? estimationField.defaultValue : null
};

try {
  localStorage.setItem("estimateDebug", JSON.stringify(window.estimateDebug, null, 2));
} catch (e) {}
}

// Drive the funnel transition. Prefers the engine's screen controller; falls back
// to toggling the legacy data-display marker if the engine did not load.
function goTo(doc, key) {
  if (typeof window !== "undefined" && typeof window.estGoTo === "function") {
    window.estGoTo(key);
    return;
  }
  const el = doc.querySelector(`[data-display="${key}"]`);
  if (el) el.style.display = key === "result" ? "flex" : "block";
}

// Show the noresults screen. applyOutputs never runs on this path, so write the
// user's attempted address here too — the screen says "we couldn't find <address>".
function showNoResultsState(doc, address) {
  if (address != null) writeOutputs(doc, '[data-output="address"]', address);
  goTo(doc, "noresults");
}

// Draw the chart once the result screen is actually visible (GSAP fades it in).
// longTerm = ll_estimate (monthly long-term rent) → drives the chart baseline.
function drawChartWhenVisible(doc, min, max, longTerm) {
  if (!window.initChart) return;
  const screen =
    doc.querySelector("[start-result]") || doc.querySelector('[data-display="result"]');
  if (!screen) {
    window.initChart(min, max, longTerm);
    return;
  }
  if (getComputedStyle(screen).display !== "none") {
    window.initChart(min, max, longTerm);
    return;
  }
  const obs = new MutationObserver(() => {
    if (getComputedStyle(screen).display !== "none") {
      obs.disconnect();
      window.initChart(min, max, longTerm);
    }
  });
  obs.observe(screen, { attributes: true, attributeFilter: ["style", "class"] });
}

export function initValuation(doc = document) {
  doc.addEventListener("click", (e) => {
    const trigger =
      e.target.closest('[aria-label="Start Estimate"]') || e.target.closest("[start-ready-button]");
    if (!trigger) return;
    setTimeout(() => {
      const addressEl =
        doc.querySelector("#autocompleteHero") || doc.querySelector('[data-input-id="address-search"]');
      const postcodeEl = doc.querySelector('[data-input-id="postal-code-result"]');
      const bedsEl = doc.querySelector("[data-rooms-input]");
      const fullAddress = getValue(addressEl);
      const postcode = getValue(postcodeEl);
      const beds = getBedsValue(bedsEl);
      if (!postcode || !beds) {
        showNoResultsState(doc, fullAddress || postcode);
        return;
      }
      const leadstart = (new URL(doc.location?.href || location.href).searchParams.get("sourcepath") || "").trim();
      const body = buildRequestBody({ fullAddress, postcode, beds, utm: getUTMFromURL(location.href) });
      fetch("https://valuation.smarthost.co.uk/smarthost-estimate.php", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((response) => {
  // DEBUG: store the API response so we can inspect it on the live site
  window.latestEstimateApiResponse = response;

  try {
    localStorage.setItem(
      "latestEstimateApiResponse",
      JSON.stringify(response, null, 2)
    );
  } catch (e) {}

  console.log("Estimate API response:", response);

  if (!isValidEstimate(response)) {
    showNoResultsState(doc, response.show_address || fullAddress || postcode);
    return;
  }

  applyOutputs(doc, { response, fullAddress, postcode, beds, leadstart });
  goTo(doc, "result");
  drawChartWhenVisible(doc, response.minimum, response.maximum, response.ll_estimate);
})
        .catch(() => {
          showNoResultsState(doc, fullAddress || postcode);
        });
    }, 0);
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => initValuation());
}
