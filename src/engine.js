/* Stepper engine — GSAP fade transitions, radio auto-advance, ready/not-ready branch.
   JS binds to contract attributes only; behaviour ported 1:1 from the inline embed.
   Depends on the global `gsap` (loaded by a non-defer script before this module). */

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

export function initStepper(doc = document) {
  if (typeof gsap === "undefined") return;
  const $ = (sel, root = doc) => root.querySelector(sel);
  const $$ = (sel, root = doc) => Array.from(root.querySelectorAll(sel));

  const progressSteps = $$("[start-progress-step]");
  const ACTIVE_BG = "var(--_colors---brand--500)";
  const INACTIVE_BG = "var(--_colors---gray--100)";
  function setProgress(activeIndex) {
    progressSteps.forEach((el, i) => {
      el.style.backgroundColor = i <= activeIndex ? ACTIVE_BG : INACTIVE_BG;
    });
  }

  const stepStart = $("[start-step-0]");
  const step1 = $("[start-step-1]");
  const step2 = $("[start-step-2]");
  const step3 = $("[start-step-3]");
  const ready = $("[start-ready]");
  const notReady = $("[start-not-ready]");
  const allSteps = [stepStart, step1, step2, step3, ready, notReady];

  const btnStart = $("[start-start-button]");
  const inpAddress = $('[data-input-id="address-search"]');
  const inpRooms = $("[data-rooms-input]");
  const back1 = step1 ? $("[start-step-back]", step1) : null;
  const back2 = step2 ? $("[start-step-back]", step2) : null;
  const back3 = step3 ? $("[start-step-back]", step3) : null;

  function fadeToStep(nextStepEl) {
    if (!nextStepEl) return;
    const currentStep = allSteps.find((el) => el && gsap.getProperty(el, "display") !== "none");
    const tl = gsap.timeline();
    if (currentStep && currentStep !== nextStepEl) {
      tl.to(currentStep, {
        opacity: 0,
        duration: 0.25,
        ease: "power2.inOut",
        onComplete: () => {
          currentStep.style.display = "none";
        },
      });
    }
    tl.fromTo(
      nextStepEl,
      { opacity: 0, display: "none" },
      { display: "flex", opacity: 1, duration: 0.35, ease: "power2.out" },
      "+=0.1"
    );
  }

  function goTo(key) {
    if (key === "start") { fadeToStep(stepStart); setProgress(0); }
    if (key === "s1") { fadeToStep(step1); setProgress(1); }
    if (key === "s2") { fadeToStep(step2); setProgress(2); }
    if (key === "s3") { fadeToStep(step3); setProgress(3); }
  }
  function goToFinal(which) {
    setProgress(4);
    if (which === "ready") {
      if (notReady) notReady.remove();
      fadeToStep(ready);
    } else {
      if (ready) ready.remove();
      fadeToStep(notReady);
    }
  }

  allSteps.forEach((el) => {
    if (el) gsap.set(el, { display: "none", opacity: 0 });
  });
  if (stepStart) gsap.set(stepStart, { display: "flex", opacity: 1 });
  setProgress(0);

  if (btnStart) {
    btnStart.addEventListener("click", () => {
      if (!validateStartInputs(inpAddress, inpRooms)) return;
      goTo("s1");
    });
  }
  [step1, step2].forEach((step, idx) => {
    if (step) {
      step.addEventListener("change", (e) => {
        if (e.target.matches('input[type="radio"]')) {
          setTimeout(() => goTo(`s${idx + 2}`), 200);
        }
      });
    }
  });
  if (step3) {
    step3.addEventListener("change", (e) => {
      const t = e.target;
      if (!t || !t.matches('input[type="radio"][start-step-radio]')) return;
      const val = t.getAttribute("start-step-radio");
      setTimeout(() => goToFinal(val === "ready" ? "ready" : "not-ready"), 200);
    });
  }
  if (back1) back1.addEventListener("click", () => goTo("start"));
  if (back2) back2.addEventListener("click", () => goTo("s1"));
  if (back3) back3.addEventListener("click", () => goTo("s2"));
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => initStepper());
}
