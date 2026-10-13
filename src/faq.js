/* FAQ accordion — the Webflow component "FAQ 02 | Accordion Item", plain divs
   instead of a Webflow Dropdown (a Dropdown closes on any click elsewhere on
   the page and cannot start open). Items are independent: an item opens and
   closes only by its own toggle.

   Markup (data-* contract, set in the component definition):
     [data-faq-item]          item root
       [data-faq-open]        rendered only when the item's "Open by default"
                              prop is on (element visibility bound to the prop)
       [data-faq-toggle]      the question row; gets role=button for keyboards
         [data-faq-ico] ×2    the "−" and "+" glyphs
       [data-faq-panel]       the answer

   State: class `is-expanded` on the panel and on each icon — Designer combos
   hold the open height and opacity, the base classes hold the transitions; the
   toggle carries aria-expanded. Height cannot transition to auto, so for the
   transition the panel gets px heights, cleared when it ends. */

const OPEN = "is-expanded";
const timers = new WeakMap();
let uid = 0;

// Longest height transition on the panel, in ms (computed values are in s).
function duration(panel) {
  const cs = getComputedStyle(panel);
  const s = (v) => parseFloat(v) || 0;
  return (s(cs.transitionDuration) + s(cs.transitionDelay)) * 1000;
}

export function setOpen(item, open, animate = true) {
  const toggle = item.querySelector("[data-faq-toggle]");
  const panel = item.querySelector("[data-faq-panel]");
  const ms = animate ? duration(panel) : 0;

  clearTimeout(timers.get(panel));
  if (ms) {
    // Pin the current height before the classes change, so the transition
    // starts from what is on screen (also mid-way through a previous one).
    panel.style.height = `${panel.getBoundingClientRect().height}px`;
    void panel.offsetHeight;
  }

  toggle.setAttribute("aria-expanded", String(open));
  panel.toggleAttribute("inert", !open);
  panel.classList.toggle(OPEN, open);
  item.querySelectorAll("[data-faq-ico]").forEach((ico) => ico.classList.toggle(OPEN, open));

  if (!ms) {
    panel.style.height = "";
    return;
  }
  // The open height is the panel's own auto height (scrollHeight also counts
  // glyph overflow and would overshoot), measured with the transition off.
  let to = 0;
  if (open) {
    const from = panel.style.height;
    panel.style.transition = "none";
    panel.style.height = "";
    to = panel.getBoundingClientRect().height;
    panel.style.height = from;
    void panel.offsetHeight;
    panel.style.transition = "";
  }
  panel.style.height = `${to}px`;
  timers.set(panel, setTimeout(() => (panel.style.height = ""), ms));
}

export function initFaq(doc = document) {
  doc.querySelectorAll("[data-faq-item]").forEach((item) => {
    const toggle = item.querySelector("[data-faq-toggle]");
    const panel = item.querySelector("[data-faq-panel]");
    if (!toggle || !panel || toggle.hasAttribute("aria-expanded")) return;

    if (!panel.id) panel.id = `faq-panel-${++uid}`;
    toggle.setAttribute("role", "button");
    toggle.setAttribute("tabindex", "0");
    toggle.setAttribute("aria-controls", panel.id);
    setOpen(item, !!item.querySelector(":scope > [data-faq-open]"), false);

    toggle.addEventListener("click", () => setOpen(item, toggle.getAttribute("aria-expanded") !== "true"));
    toggle.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggle.click();
    });
  });
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initFaq());
  else initFaq();
}
