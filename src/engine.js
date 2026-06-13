/* Stepper engine — screen transitions for the start-hosting funnel.
   Screens (one visible at a time): start-step-0..3, start-loading, start-result,
   start-noresults. step0 validates address + beds; step1/step2 radios auto-advance;
   step3 is a contact form whose submit (start-ready-button) shows the loading screen
   and lets the valuation module fetch — valuation then calls window.estGoTo('result'
   | 'noresults'). Transitions use GSAP when present, plain show/hide otherwise.
   JS binds to contract attributes only. */

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

// Screen key -> contract attribute. Order matters for the progress bar (0..3).
export const SCREEN_ATTR = {
  0: "start-step-0",
  1: "start-step-1",
  2: "start-step-2",
  3: "start-step-3",
  loading: "start-loading",
  result: "start-result",
  noresults: "start-noresults",
};

export function initStepper(doc = document) {
  const $ = (sel, root = doc) => root.querySelector(sel);
  const $$ = (sel, root = doc) => Array.from(root.querySelectorAll(sel));
  const hasGsap = typeof gsap !== "undefined";

  const screens = {};
  Object.entries(SCREEN_ATTR).forEach(([key, attr]) => {
    screens[key] = $(`[${attr}]`);
  });
  const allScreens = Object.values(screens).filter(Boolean);

  const progressSteps = $$("[start-progress-step]");
  const PROGRESS_INDEX = { 0: 0, 1: 1, 2: 2, 3: 3 };
  const ACTIVE_BG = "var(--_colors---brand--500)";
  const INACTIVE_BG = "var(--_colors---gray--100)";
  function setProgress(activeIndex) {
    progressSteps.forEach((el, i) => {
      el.style.backgroundColor = i <= activeIndex ? ACTIVE_BG : INACTIVE_BG;
    });
  }

  function showScreen(key) {
    const next = screens[key];
    if (!next) return;
    const current = allScreens.find(
      (el) => el !== next && getDisplay(el) !== "none"
    );
    if (hasGsap) {
      const tl = gsap.timeline();
      if (current) {
        tl.to(current, {
          opacity: 0,
          duration: 0.25,
          ease: "power2.inOut",
          onComplete: () => {
            current.style.display = "none";
          },
        });
      }
      tl.fromTo(
        next,
        { opacity: 0, display: "none" },
        { display: "flex", opacity: 1, duration: 0.35, ease: "power2.out" },
        "+=0.1"
      );
    } else {
      if (current) current.style.display = "none";
      next.style.display = "flex";
      next.style.opacity = "1";
    }
    // Progress bar only tracks the numbered steps.
    if (key in PROGRESS_INDEX) setProgress(PROGRESS_INDEX[key]);
  }

  function getDisplay(el) {
    if (hasGsap) return gsap.getProperty(el, "display");
    return el.style.display || "none";
  }

  // Initial state: only step0 visible.
  allScreens.forEach((el) => {
    el.style.display = "none";
    el.style.opacity = "0";
  });
  if (screens[0]) {
    screens[0].style.display = "flex";
    screens[0].style.opacity = "1";
  }
  setProgress(0);

  // step0 -> step1 (validate address + beds)
  const btnStart = $("[start-start-button]");
  const inpAddress = $('[data-input-id="address-search"]');
  const inpRooms = $("[data-rooms-input]");
  if (btnStart) {
    btnStart.addEventListener("click", () => {
      if (!validateStartInputs(inpAddress, inpRooms)) return;
      showScreen(1);
    });
  }

  // step1 -> step2, step2 -> step3: radio auto-advance
  [
    [screens[1], 2],
    [screens[2], 3],
  ].forEach(([step, nextKey]) => {
    if (!step) return;
    step.addEventListener("change", (e) => {
      if (e.target.matches('input[type="radio"]')) {
        setTimeout(() => showScreen(nextKey), 200);
      }
    });
  });

  // step3 submit -> loading (valuation listens on the same button and fetches)
  const submitBtn = screens[3] ? $("[start-ready-button]", screens[3]) : null;
  if (submitBtn) {
    submitBtn.addEventListener("click", () => {
      showScreen("loading");
      runLoadingChecklist(screens.loading);
    });
  }

  // back buttons
  const back = (stepEl) => (stepEl ? $("[start-step-back]", stepEl) : null);
  const backTargets = [
    [back(screens[1]), 0],
    [back(screens[2]), 1],
    [back(screens[3]), 2],
  ];
  backTargets.forEach(([btn, target]) => {
    if (btn) btn.addEventListener("click", () => showScreen(target));
  });

  // Let the valuation module drive the final transition.
  if (typeof window !== "undefined") {
    window.estGoTo = showScreen;
  }
}

// Reveal the loading checklist items one by one (decorative).
function runLoadingChecklist(loadingEl) {
  if (!loadingEl) return;
  const items = Array.from(loadingEl.querySelectorAll("[start-loading-step]"));
  items.forEach((el, i) => {
    setTimeout(() => el.setAttribute("data-active", "true"), i * 700);
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => initStepper());
}
