/* Bedrooms stepper — the −/+ control in the hero forms. Ported from the inline
   "Beds Counter Logic" embed, with two fixes: min="0" is read as zero (the old
   `parseInt(...) || 1` turned it into 1), and a zero shows the [data-beds-studio]
   label instead of the digit. JS only toggles is-studio / is-inactive; the styling
   of both states lives on those combo classes in the Designer. */

const INACTIVE = "is-inactive";
const STUDIO = "is-studio";

function bound(el, name, fallback) {
  const n = parseInt(el.getAttribute(name), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function syncStepper(parts) {
  const { input, decrement, increment, studio, min, max } = parts;

  let value = parseInt(input.value, 10);
  if (!Number.isFinite(value) || value < min) value = min;
  else if (value > max) value = max;
  input.value = String(value);

  if (decrement) {
    decrement.disabled = value <= min;
    decrement.classList.toggle(INACTIVE, value <= min);
  }
  if (increment) {
    increment.disabled = value >= max;
    increment.classList.toggle(INACTIVE, value >= max);
  }

  // Zero bedrooms reads as "Studio": hide the number, show the label.
  const isStudio = value === 0;
  input.classList.toggle(STUDIO, isStudio);
  if (studio) studio.classList.toggle(STUDIO, isStudio);

  return value;
}

export function initBedsStepper(doc = document) {
  doc.querySelectorAll('[data-counter-target="beds"]').forEach((control) => {
    const input = control.querySelector('[data-input-id="beds-count"]');
    const decrement = control.querySelector('[data-action="decrement"]');
    const increment = control.querySelector('[data-action="increment"]');
    if (!input || !decrement || !increment) return;

    const parts = {
      input,
      decrement,
      increment,
      studio: control.querySelector("[data-beds-studio]"),
      min: bound(input, "min", 1),
      max: bound(input, "max", 10)
    };

    const step = (delta) => (event) => {
      event.preventDefault();
      const current = parseInt(input.value, 10);
      input.value = String((Number.isFinite(current) ? current : parts.min) + delta);
      syncStepper(parts);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };

    increment.addEventListener("click", step(1));
    decrement.addEventListener("click", step(-1));
    input.addEventListener("input", () => syncStepper(parts));

    syncStepper(parts);
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => initBedsStepper());
}
