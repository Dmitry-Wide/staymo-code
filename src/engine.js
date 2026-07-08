/* Funnel engine — state only; animation lives in funnel.css (toggled via .is-active).
   Data-driven: steps are all [start-step] under [start-frame] in DOM order. The step with
   [start-start-button] is the address step (validated); the step with [start-ready-button]
   is the contact step (validated -> loading). Every other step is a radio step (auto-advance
   on radio change / explicit Next / Back). Adding/removing a screen is an HTML-only change.
   valuation.js drives the final transitions via window.estGoTo. No GSAP dependency. */

export function isFilled(el) {
  return !!el && String(el.value ?? "").trim().length > 0;
}

function markInvalid(el, on) {
  if (!el) return;
  if (on) el.setAttribute("data-invalid", "true");
  else el.removeAttribute("data-invalid");
}

// Real address = a dropdown pick (dataset.placeSelected) or a resolved postcode; never bare text.
export function isResolvedAddress(inpAddress, inpPostcode) {
  if (!isFilled(inpAddress)) return false;
  if (inpAddress.dataset && inpAddress.dataset.placeSelected === "1") return true;
  return isFilled(inpPostcode);
}

export function validateStartInputs(inpAddress, inpRooms, inpPostcode) {
  const okA = isResolvedAddress(inpAddress, inpPostcode),
    okR = isFilled(inpRooms);
  markInvalid(inpAddress, !okA);
  markInvalid(inpRooms, !okR);
  return okA && okR;
}

export function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

function setStepError(step, on) {
  const err = step && step.querySelector("[start-step-error]");
  if (err) err.classList.toggle("is-active", on);
}

// contact step: name + valid email + phone + consent. Marks invalid fields.
export function validateContact(step) {
  if (!step) return true;
  let ok = true;
  const name = step.querySelector('[data-input="full-name"]');
  const email = step.querySelector('[data-input="email"]');
  const phone = step.querySelector('[data-input="phone"]');
  const consent = step.querySelector('[data-input="consent"]');
  const req = (el) => {
    const bad = !el || !String(el.value || "").trim();
    markInvalid(el, bad);
    if (bad) ok = false;
  };
  req(name);
  req(phone);
  const emailBad = !email || !isValidEmail(email.value);
  markInvalid(email, emailBad);
  if (emailBad) ok = false;
  const consentBad = !consent || !consent.checked;
  markInvalid(consent, consentBad);
  if (consentBad) ok = false;
  setStepError(step, !ok);
  return ok;
}

// Back-compat alias (previous name for the contact-step validator).
export const validateStep3 = validateContact;

// Progress fill width for a 0-based step within `count` steps.
export function progressWidth(step, count) {
  return `${((step + 1) / count) * 100}%`;
}

// True when the URL carries a full prefill (address + postal-code + beds), i.e. the
// user arrived from another page's estimate form. prelead.js fills the inputs and
// auto-advances; the engine uses this to start past the address step (no flash).
export function hasStartPrefill(search) {
  if (search == null) {
    if (typeof location === "undefined") return false;
    search = location.search;
  }
  const p = new URLSearchParams(search);
  return !!(p.get("address") && p.get("postal-code") && p.get("beds"));
}

export function initStepper(doc = document) {
  const $ = (sel, root = doc) => root.querySelector(sel);
  const setActive = (el, on) => el && el.classList.toggle("is-active", on);

  const frame = $("[start-frame]");
  if (!frame) return;

  const steps = Array.from(frame.querySelectorAll("[start-step]"));
  const count = steps.length;
  if (!count) return;

  const addressIdx = steps.findIndex((s) => s.querySelector("[start-start-button]"));
  const contactIdx = steps.findIndex((s) => s.querySelector("[start-ready-button]"));

  const finals = {
    loading: $("[start-loading]"),
    result: $("[start-result]"),
    noresults: $("[start-noresults]"),
  };
  const photos = Array.from(doc.querySelectorAll("[start-photo]"));
  const progressFill = $("[start-progress-fill]");
  const counter = $("[start-step-counter]");

  function setStep(n) {
    if (n < 0 || n >= count) return;
    setActive(frame, true);
    Object.values(finals).forEach((el) => setActive(el, false));
    steps.forEach((el, i) => setActive(el, i === n));
    photos.forEach((p) => setActive(p, Number(p.getAttribute("data-step")) === n));
    if (progressFill) progressFill.style.width = progressWidth(n, count);
    if (counter) counter.textContent = `${n + 1} of ${count} steps`;
  }

  function showFinal(key) {
    const el = finals[key];
    if (!el) return;
    setActive(frame, false);
    Object.values(finals).forEach((f) => setActive(f, f === el));
    if (key === "loading") runChecklist(el);
  }

  function estGoTo(key) {
    if (key in finals) showFinal(key);
    else setStep(Number(key));
  }

  // Initial state. If arriving with a completed address prefilled from another page's
  // form, start past the address step so it never flashes before the auto-advance.
  setStep(hasStartPrefill() && addressIdx >= 0 ? addressIdx + 1 : 0);
  // Reveal the funnel now the correct step is positioned. Pairs with the page's
  // prefill visibility guard (html.est-prefill [start-frame]{visibility:hidden}).
  if (doc.documentElement) doc.documentElement.classList.add("est-ready");

  // address step -> next step (validate a real address + beds)
  const addressStep = steps[addressIdx];
  if (addressStep) {
    const btnStart = addressStep.querySelector("[start-start-button]");
    const inpAddress = $('[data-input-id="address-search"]');
    const inpRooms = $("[data-rooms-input]");
    const inpPostcode = $('[data-input-id="postal-code-result"]');
    if (btnStart) {
      btnStart.addEventListener("click", async () => {
        // Let the autocomplete module resolve/fill the postcode (on-demand geocode)
        // before the sync gate, so a typed-but-valid address isn't wrongly blocked.
        if (
          typeof window !== "undefined" &&
          typeof window.staymoIsRealAddress === "function"
        ) {
          await window.staymoIsRealAddress(inpAddress, inpPostcode);
        }
        if (validateStartInputs(inpAddress, inpRooms, inpPostcode)) setStep(addressIdx + 1);
      });
    }
  }

  // radio steps (every step that is neither address nor contact):
  // auto-advance on radio change + explicit Next button.
  steps.forEach((step, idx) => {
    if (idx === addressIdx || idx === contactIdx) return;
    step.addEventListener("change", (e) => {
      if (e.target.matches('input[type="radio"]')) {
        setStepError(step, false);
        setTimeout(() => setStep(idx + 1), 200);
      }
    });
    const nb = step.querySelector("[start-next]");
    if (nb) {
      nb.addEventListener("click", () => {
        if (!step.querySelector('input[type="radio"]:checked')) {
          setStepError(step, true);
          return;
        }
        setStepError(step, false);
        setStep(idx + 1);
      });
    }
  });

  // contact submit -> loading. Engine runs before valuation (its tag is earlier), so
  // an invalid form stops here (stopImmediatePropagation) and valuation never fires.
  const contactStep = steps[contactIdx];
  if (contactStep) {
    const submit = contactStep.querySelector("[start-ready-button]");
    if (submit) {
      submit.addEventListener("click", (e) => {
        if (!validateContact(contactStep)) {
          e.stopImmediatePropagation();
          e.preventDefault();
          return;
        }
        showFinal("loading");
      });
    }
  }

  // back buttons -> previous step
  steps.forEach((step, idx) => {
    const b = step.querySelector("[start-step-back]");
    if (b) b.addEventListener("click", () => setStep(idx - 1));
  });

  // "Start again" from the result/noresults screen -> back to step 0
  const restart = $("[start-restart]");
  if (restart) restart.addEventListener("click", () => setStep(0));

  // Let the valuation module drive the final transitions.
  if (typeof window !== "undefined") window.estGoTo = estGoTo;
}

// Reveal loading checklist items one by one (decorative; CSS animates .is-active).
function runChecklist(loadingEl) {
  Array.from(loadingEl.querySelectorAll("[start-loading-step]")).forEach((el, i) => {
    setTimeout(() => el.classList.add("is-active"), i * 700);
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => initStepper());
}
