/* Reviews carousel — "What owners say" testimonial slider.
   Vanilla, attribute-driven. JS binds to data-* attributes only; the active
   slide and active dot are flagged with the `is-active` combo class (styled in
   Webflow). Pagination dots are generated at runtime: placeholder dots in the
   markup are cloned (so the designer's base class is preserved), then replaced
   with exactly one dot per slide.

   Contract (attributes on the markup):
     [data-reviews]                 carousel root
       data-reviews-autoplay="6000" optional, ms between slides (absent/0 = off)
       data-reviews-loop="false"    optional, disable wrap-around (default: loop)
       data-reviews-pause-on-hover="false" optional (default: pause on hover)
     [data-reviews-slide]           one per testimonial (searched within root)
     [data-reviews-dots]            dots container (within root)
     [data-reviews-dot]             placeholder dot — first is used as template
   State: the `is-active` class is toggled on the current slide and dot. */

export const ACTIVE_CLASS = "is-active";

export function getSlides(root) {
  return Array.from(root.querySelectorAll("[data-reviews-slide]"));
}

// Rebuild the dots container so it holds exactly `count` dots. The first
// existing dot is cloned as the template (keeps the designer's classes); if
// there is none, a bare <div data-reviews-dot> is created. Returns the dots.
export function buildDots(root, count, { doc = document } = {}) {
  const container = root.querySelector("[data-reviews-dots]");
  if (!container || count < 1) return [];
  const existing = container.querySelectorAll("[data-reviews-dot]");
  let template = existing[0] ? existing[0].cloneNode(true) : null;
  if (!template) {
    template = doc.createElement("div");
    template.setAttribute("data-reviews-dot", "");
  }
  template.classList.remove(ACTIVE_CLASS);
  existing.forEach((dot) => dot.remove());
  const dots = [];
  for (let i = 0; i < count; i++) {
    const dot = template.cloneNode(true);
    dot.setAttribute("data-reviews-index", String(i));
    dot.setAttribute("role", "button");
    dot.setAttribute("tabindex", "0");
    dot.setAttribute("aria-label", `Show review ${i + 1}`);
    container.appendChild(dot);
    dots.push(dot);
  }
  return dots;
}

export function setActive(slides, dots, index) {
  slides.forEach((slide, i) => slide.classList.toggle(ACTIVE_CLASS, i === index));
  dots.forEach((dot, i) => {
    dot.classList.toggle(ACTIVE_CLASS, i === index);
    if (i === index) dot.setAttribute("aria-current", "true");
    else dot.removeAttribute("aria-current");
  });
}

function readBool(root, attr, fallback) {
  if (!root.hasAttribute(attr)) return fallback;
  return root.getAttribute(attr) !== "false";
}

export function initReviews(root, { doc = document } = {}) {
  if (!root || root.__reviews) return root && root.__reviews;
  const slides = getSlides(root);
  if (slides.length === 0) return null;

  const dots = buildDots(root, slides.length, { doc });
  const loop = readBool(root, "data-reviews-loop", true);
  const pauseOnHover = readBool(root, "data-reviews-pause-on-hover", true);
  const autoplayMs = parseInt(root.getAttribute("data-reviews-autoplay") || "0", 10);

  let index = 0;
  let timer = null;

  function go(to) {
    const n = slides.length;
    index = loop ? ((to % n) + n) % n : Math.max(0, Math.min(to, n - 1));
    setActive(slides, dots, index);
  }
  const next = () => go(index + 1);
  const prev = () => go(index - 1);

  function start() {
    if (timer || !(autoplayMs > 0) || slides.length < 2) return;
    timer = setInterval(next, autoplayMs);
  }
  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  const container = root.querySelector("[data-reviews-dots]");
  if (container) {
    container.addEventListener("click", (e) => {
      const dot = e.target.closest("[data-reviews-dot]");
      if (dot && container.contains(dot)) go(Number(dot.getAttribute("data-reviews-index")));
    });
    container.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const dot = e.target.closest("[data-reviews-dot]");
      if (dot && container.contains(dot)) {
        e.preventDefault();
        go(Number(dot.getAttribute("data-reviews-index")));
      }
    });
  }

  if (pauseOnHover) {
    root.addEventListener("mouseenter", stop);
    root.addEventListener("mouseleave", start);
  }

  go(0);
  start();

  const controller = { root, go, next, prev, start, stop, get index() { return index; }, get count() { return slides.length; } };
  root.__reviews = controller;
  return controller;
}

export function initAllReviews(doc = document) {
  return Array.from(doc.querySelectorAll("[data-reviews]"))
    .map((root) => initReviews(root, { doc }))
    .filter(Boolean);
}

if (typeof window !== "undefined") {
  const boot = () => initAllReviews(document);
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  // Pause autoplay when the tab is hidden, resume when visible.
  document.addEventListener("visibilitychange", () => {
    document.querySelectorAll("[data-reviews]").forEach((root) => {
      if (!root.__reviews) return;
      if (document.hidden) root.__reviews.stop();
      else root.__reviews.start();
    });
  });
}
