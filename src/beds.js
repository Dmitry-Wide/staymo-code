/* Bedrooms picker — wires the est__bed click tiles to a hidden [data-rooms-input]
   that the engine validates and valuation reads. Marks the chosen tile with
   is-bed-selected. JS binds to contract attributes only. */

const SELECTED = "is-bed-selected";

export function selectBed(container, bedEl) {
  if (!container || !bedEl) return "";
  container.querySelectorAll("[data-room]").forEach((b) => {
    b.classList.toggle(SELECTED, b === bedEl);
  });
  const value = (bedEl.getAttribute("data-room") || bedEl.textContent || "").trim();
  const input = container.querySelector("[data-rooms-input]");
  if (input) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return value;
}

export function initBeds(doc = document) {
  doc.querySelectorAll("[data-rooms]").forEach((container) => {
    // Reflect a pre-selected tile from the markup into the hidden input.
    const preselected = container.querySelector(`[data-room].${SELECTED}`);
    if (preselected) selectBed(container, preselected);
    container.addEventListener("click", (e) => {
      const bed = e.target.closest("[data-room]");
      if (bed && container.contains(bed)) selectBed(container, bed);
    });
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => initBeds());
}
