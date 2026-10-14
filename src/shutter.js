/* Shutter — photo entrance for the two intro photos on the Dubai area pages
   (motion board variant A, "bottom shutter"). Each frame stays in place and
   opens from the bottom up through a rounded clip-path while its photo
   settles from a slight zoom to its size.

   Markup (data-* contract):
     [data-shutter]           the photo row; one trigger per row on desktop
       [data-shutter-frame]   a rounded frame with overflow hidden
         img                  the photo: the frame's first img (scaled)

   Desktop (≥768px): one timeline per row when its top reaches 80% of the
   viewport, frames 0.12 s apart: clip 1.1 s expo.out, photo 1.12 → 1 over
   1.375 s. Phone: each stacked frame on its own trigger at 85%, clip 0.9 s,
   photo 1.06 → 1 over 1.125 s. Plays once. Reduced motion: nothing.

   Why this way: the clip radius is the frame's own computed corner radius,
   and the inline clip-path is kept when the clip lands — the photo is still
   scaling, and a transformed child in an overflow:hidden + radius frame
   shows square corners; the clip keeps them round. Start values are set only
   here, by gsap at init, so without JS (or GSAP) the photos are static.

   Runtime: GSAP + ScrollTrigger from the Webflow CDN, loaded before module
   scripts; never loads its own. Lenis already syncs ScrollTrigger. */

const DESKTOP = "(min-width: 768px) and (prefers-reduced-motion: no-preference)";
const PHONE = "(max-width: 767px) and (prefers-reduced-motion: no-preference)";
const WAIT_MS = 5000;
const POLL_MS = 50;

const clip = (top, r) => `inset(${top}% 0% 0% 0% round ${r}px)`;

export function frames(row) {
  return Array.from(row.querySelectorAll("[data-shutter-frame]")).map((frame) => ({
    frame,
    img: frame.querySelector("img")
  }));
}

export function radius(frame, win = window) {
  return parseFloat(win.getComputedStyle(frame).borderTopLeftRadius) || 0;
}

// Adds one frame's shutter to the timeline at `at`.
function shutter(tl, { frame, img }, { clipS, from, at }, win) {
  const r = radius(frame, win);
  tl.fromTo(frame, { clipPath: clip(100, r) }, { clipPath: clip(0, r), duration: clipS, ease: "expo.out", immediateRender: true }, at);
  if (img) tl.fromTo(img, { scale: from }, { scale: 1, duration: clipS * 1.25, ease: "expo.out", immediateRender: true }, at);
}

export function initShutter(win = window, doc = document) {
  const { gsap, ScrollTrigger } = win;
  const rows = Array.from(doc.querySelectorAll("[data-shutter]"));
  if (!gsap || !ScrollTrigger || !rows.length) return null;
  gsap.registerPlugin(ScrollTrigger);

  const mm = gsap.matchMedia();
  mm.add(DESKTOP, () => {
    rows.forEach((row) => {
      const tl = gsap.timeline({ scrollTrigger: { trigger: row, start: "top 80%", once: true } });
      frames(row).forEach((f, i) => shutter(tl, f, { clipS: 1.1, from: 1.12, at: i * 0.12 }, win));
    });
  });
  mm.add(PHONE, () => {
    rows.forEach((row) => {
      frames(row).forEach((f) => {
        const tl = gsap.timeline({ scrollTrigger: { trigger: f.frame, start: "top 85%", once: true } });
        shutter(tl, f, { clipS: 0.9, from: 1.06, at: 0 }, win);
      });
    });
  });

  if (doc.readyState !== "complete") win.addEventListener("load", () => ScrollTrigger.refresh(), { once: true });
  return mm;
}

// GSAP comes from the Webflow CDN before module scripts; a short poll covers
// a late load, then gives up and leaves the photos static.
export function startShutter(win = window, doc = document) {
  const t0 = Date.now();
  const tick = () => {
    if (win.gsap && win.ScrollTrigger) initShutter(win, doc);
    else if (Date.now() - t0 < WAIT_MS) win.setTimeout(tick, POLL_MS);
  };
  tick();
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => startShutter());
  else startShutter();
}
