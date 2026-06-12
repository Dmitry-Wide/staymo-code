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

export function applyOutputs(doc, { response, fullAddress, postcode, beds, leadstart }) {
  const occupancy = response?.occupancy || "84";
  const { minimum, maximum, annual, show_address: showAddress } = response || {};
  setFieldValue(doc.querySelector('[data-process="postcode"]'), postcode);
  setFieldValue(doc.querySelector('[data-process="property_bedrooms"]'), beds);
  setFieldValue(doc.querySelector('[data-process="property_address"]'), fullAddress || showAddress || postcode);
  setFieldValue(doc.querySelector('[data-process="sourcepath"]'), leadstart || "");
  const set = (sel, val) => {
    const el = doc.querySelector(sel);
    if (el) el.textContent = val;
  };
  set('[data-output="minimum-value"]', minimum);
  set('[data-output="maximum-value"]', maximum);
  set('[data-output="occupancy-value"]', `${occupancy}%`);
  if (annual) set('[data-output="annual-revenue"]', `${annual}`);
  set('[data-output="address"]', showAddress || fullAddress || postcode);
  setFieldValue(doc.querySelector('[form_data="estimation"]'), `£${minimum} - £${maximum}`);
}

function showNoResultsState(doc) {
  const mainForm = doc.querySelector('[data_section="main_form"]');
  const noResults = doc.querySelector('[data-display="noresults"]');
  if (mainForm) mainForm.style.display = "none";
  if (noResults) noResults.style.display = "block";
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
        showNoResultsState(doc);
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
          if (!isValidEstimate(response)) {
            showNoResultsState(doc);
            return;
          }
          applyOutputs(doc, { response, fullAddress, postcode, beds, leadstart });
          const resultEl = doc.querySelector('[data-display="result"]');
          if (resultEl && window.initChart) {
            const obs = new MutationObserver(() => {
              if (getComputedStyle(resultEl).display !== "none") {
                obs.disconnect();
                window.initChart(response.minimum, response.maximum);
              }
            });
            obs.observe(resultEl, { attributes: true, attributeFilter: ["style", "class"] });
          }
        })
        .catch(() => {
          showNoResultsState(doc);
          const fail = doc.querySelector(".w-form-fail");
          if (fail) fail.style.display = "block";
        });
    }, 0);
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => initValuation());
}
