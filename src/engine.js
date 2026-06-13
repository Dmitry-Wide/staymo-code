/* Funnel engine — state only; animation lives in funnel.css (toggled via .is-active).
   Persistent frame (photo + card content + progress) for steps 0-3; full-screen
   loading / result / noresults shown by deactivating the frame. Flow:
   step0 (address+beds, validated) -> step1/step2 radios auto-advance -> step3 contact
   form -> loading -> result|noresults (valuation calls window.estGoTo). JS binds to
   contract attributes only; no GSAP dependency. */

export const STEP_COUNT = 4;

export function isFilled(el) {
  return !!el && String(el.value ?? "").trim().length > 0;
}

function markInvalid(el, on) {
  if (!el) return;
  if (on) el.setAttribute("data-invalid", "true");
  else el.removeAttribute("data-invalid");
}

export function validateStartInputs(inpAddress, inpRooms) {
  const okA = isFilled(inpAddress),
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

// step3 contact form: name + valid email + phone + consent. Marks invalid fields.
export function validateStep3(step) {
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

// Progress fill width for a given 0-based step.
export function progressWidth(step) {
  return `${((step + 1) / STEP_COUNT) * 100}%`;
}

export function initStepper(doc = document) {
  const $ = (sel, root = doc) => root.querySelector(sel);
  const $$ = (sel, root = doc) => Array.from(root.querySelectorAll(sel));
  const setActive = (el, on) => el && el.classList.toggle("is-active", on);

  const frame = $("[start-frame]");
  const contents = {
    0: $("[start-step-0]"),
    1: $("[start-step-1]"),
    2: $("[start-step-2]"),
    3: $("[start-step-3]"),
  };
  const finals = {
    loading: $("[start-loading]"),
    result: $("[start-result]"),
    noresults: $("[start-noresults]"),
  };
  const photos = $$("[start-photo]");
  const progressFill = $("[start-progress-fill]");
  const counter = $("[start-step-counter]");

  function setStep(n) {
    setActive(frame, true);
    Object.values(finals).forEach((el) => setActive(el, false));
    Object.entries(contents).forEach(([k, el]) => setActive(el, Number(k) === n));
    photos.forEach((p) => setActive(p, Number(p.getAttribute("data-step")) === n));
    if (progressFill) progressFill.style.width = progressWidth(n);
    if (counter) counter.textContent = `${n + 1} of ${STEP_COUNT} steps`;
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

  // Initial state: step 0.
  setStep(0);

  // step0 -> step1 (validate address + beds)
  const btnStart = $("[start-start-button]");
  const inpAddress = $('[data-input-id="address-search"]');
  const inpRooms = $("[data-rooms-input]");
  if (btnStart) {
    btnStart.addEventListener("click", () => {
      if (validateStartInputs(inpAddress, inpRooms)) setStep(1);
    });
  }

  // step1 -> step2, step2 -> step3: radio auto-advance
  [
    [contents[1], 2],
    [contents[2], 3],
  ].forEach(([step, next]) => {
    if (!step) return;
    step.addEventListener("change", (e) => {
      if (e.target.matches('input[type="radio"]')) {
        setStepError(step, false);
        setTimeout(() => setStep(next), 200);
      }
    });
  });

  // explicit Next buttons (complement radio auto-advance; needed after Back,
  // when the already-checked radio fires no change event)
  [
    [contents[1], 2],
    [contents[2], 3],
  ].forEach(([step, next]) => {
    const nb = step ? $("[start-next]", step) : null;
    if (!nb) return;
    nb.addEventListener("click", () => {
      if (!step.querySelector('input[type="radio"]:checked')) {
        setStepError(step, true);
        return;
      }
      setStepError(step, false);
      setStep(next);
    });
  });

  // step3 submit -> loading. Engine runs before valuation (its tag is earlier), so
  // an invalid form stops here (stopImmediatePropagation) and valuation never fires.
  const submit = contents[3] ? $("[start-ready-button]", contents[3]) : null;
  if (submit) {
    submit.addEventListener("click", (e) => {
      if (!validateStep3(contents[3])) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      showFinal("loading");
    });
  }

  // back buttons
  [
    [contents[1], 0],
    [contents[2], 1],
    [contents[3], 2],
  ].forEach(([step, target]) => {
    const b = step ? $("[start-step-back]", step) : null;
    if (b) b.addEventListener("click", () => setStep(target));
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
