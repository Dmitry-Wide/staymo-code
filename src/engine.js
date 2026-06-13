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

  function setStep(n) {
    setActive(frame, true);
    Object.values(finals).forEach((el) => setActive(el, false));
    Object.entries(contents).forEach(([k, el]) => setActive(el, Number(k) === n));
    photos.forEach((p) => setActive(p, Number(p.getAttribute("data-step")) === n));
    if (progressFill) progressFill.style.width = progressWidth(n);
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
        setTimeout(() => setStep(next), 200);
      }
    });
  });

  // step3 submit -> loading (valuation listens on the same button and fetches)
  const submit = contents[3] ? $("[start-ready-button]", contents[3]) : null;
  if (submit) submit.addEventListener("click", () => showFinal("loading"));

  // back buttons
  [
    [contents[1], 0],
    [contents[2], 1],
    [contents[3], 2],
  ].forEach(([step, target]) => {
    const b = step ? $("[start-step-back]", step) : null;
    if (b) b.addEventListener("click", () => setStep(target));
  });

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
