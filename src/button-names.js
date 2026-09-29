/* Button link names — the Webflow "Components | Button" (and its sibling
   "Button Link", .c-button-link__*) renders its link as an empty
   <a class="v2-g--btn__link"> in a slot beside the visible caption
   (.c-button__text), so screen readers announce the URL. The link is its own
   component and cannot read Button's props, and caption and href vary
   independently, so the name is copied at runtime: aria-label = the caption of
   the same wrap. Links that already have text, aria-label or
   aria-labelledby are left alone, as are empty captions. The icon slot is not a
   part of the caption, so it never leaks into the name.

   Binds to classes, not data-* (the repo rule): this markup is the Webflow
   component's own and carries no data attributes. Buttons are static — the CMS
   lists that paginate or load more (/blog, /gallery) hold none — so one pass on
   load is enough, no MutationObserver. */

const WRAPS = [
  [".c-button__wrap", ".c-button__text"],
  [".c-button-link__wrap", ".c-button-link__text"]
];

export function initButtonNames(doc = document) {
  WRAPS.forEach(([wrap, text]) => {
    doc.querySelectorAll(`${wrap} a.v2-g--btn__link`).forEach((link) => {
      if (link.textContent.trim()) return;
      if (link.hasAttribute("aria-label") || link.hasAttribute("aria-labelledby")) return;

      const caption = link.closest(wrap).querySelector(text);
      const name = caption ? caption.textContent.trim() : "";
      if (name) link.setAttribute("aria-label", name);
    });
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => initButtonNames());
}
