/* Stack — section «Who stays for a month or more?» on /dubai/monthly-rentals,
   built as zenarate.com «Take a closer look» (motion plan
   docs/motion/plans/dubai-mid-term-rental.md in staymo-site, rows 3, 5–8).
   The sticky stack itself is CSS (Webflow styles); this module only sets the
   active list item, settles the photos and scrolls on a list click.

   Markup (data-* contract):
     [data-stack]               the section (also data-reveal-skip: the
                                site-wide reveal leaves it to this module)
       h2                       the title: house reveal, once
       [data-stack-nav]         the list
         a[href="#<card id>"]   one per card; the current one gets
                                `is-current` and aria-current
           [data-stack-dot]     optional: gets `is-current` with its link
       [data-stack-card]        a card, position: sticky (CSS)
         [data-stack-photo]     its photo, inside a rounded overflow-hidden frame

   Active item: the last card whose top has reached the list's top (+8 px),
   or 40 px below the cards' sticky top where the list is hidden (phone), on
   scroll: a card is current once it is level with the list (Dmitry
   2026-10-20 on staging: the last card sat fully beside the list while the
   third item was lit; zenarate's 60 px line under the header).
   List end (≥768): its min-height is the last card's height minus the
   card's top padding, so when the stack ends the list's top stops level with
   the last panel's top, not its bottom with the stack's bottom (Dmitry,
   same day).
   Photos: every card's photo but the last scales 1.1 → 1, power1.out, over
   the 420 px after its card sticks, scrub: true (zenarate scrubs 0.3; a
   numeric scrub over Lenis is a second lag). The start is the card's static
   offset: a stuck sticky card reports its stuck position, so it is measured
   with the cards set to position: static, never from where it sticks.
   Click: the card's static offset minus the sticky top, through Lenis
   (0.8 s easeInOutQuad, as zenarate's own 800 ms scroll); Lenis is the one
   scroll authority, `window.staymoLenis` from `Code | Lenis`; the card then
   takes focus, as with an anchor. Without Lenis the native anchor stays.
   Title: opacity 0 → 1, y 16 (phone 8), 0.6 s power2.out at top 85%, once;
   none when the title is already above that line at init.
   Reduced motion: no photo scale, no title reveal, cards in plain flow
   (Webflow styles cannot hold a reduced-motion query), the active item
   still follows, a click jumps.

   Runtime: GSAP + ScrollTrigger from the Webflow CDN, loaded before module
   scripts; never loads its own. Lenis already syncs ScrollTrigger. */

const MOTION = "(prefers-reduced-motion: no-preference)";
const DESKTOP = "(min-width: 768px) and (prefers-reduced-motion: no-preference)";
const PHONE = "(max-width: 767px) and (prefers-reduced-motion: no-preference)";
const REDUCE = "(prefers-reduced-motion: reduce)";
const CURRENT = "is-current";
const LINE_PX = 40;
const NAV_TOL_PX = 8;
const WIDE = "(min-width: 768px)";
const SETTLE_PX = 420;
const WAIT_MS = 5000;
const POLL_MS = 50;

export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function parts(stack) {
  const cards = Array.from(stack.querySelectorAll("[data-stack-card]"));
  const links = Array.from(stack.querySelectorAll("[data-stack-nav] a[href^='#']"));
  const items = links
    .map((a) => ({ a, dots: Array.from(a.querySelectorAll("[data-stack-dot]")), card: cards.find((c) => `#${c.id}` === a.getAttribute("href")) }))
    .filter((it) => it.card);
  return { cards, items, nav: stack.querySelector("[data-stack-nav]"), title: stack.querySelector("h2") };
}

// The cards' sticky top in px (the header height, a CSS variable).
export function stickyTop(card, win = window) {
  return parseFloat(win.getComputedStyle(card).top) || 0;
}

// Document y of each card in plain flow: cards set static for the read.
export function staticTops(cards, win = window) {
  const prev = cards.map((c) => c.style.position);
  cards.forEach((c) => (c.style.position = "static"));
  const tops = cards.map((c) => c.getBoundingClientRect().top + win.scrollY);
  cards.forEach((c, i) => (c.style.position = prev[i]));
  return tops;
}

// Index of the last card whose top is at or above the line; 0 before any.
export function currentIndex(cards, line) {
  let i = 0;
  cards.forEach((c, k) => {
    if (c.getBoundingClientRect().top <= line) i = k;
  });
  return i;
}

export function setCurrent(items, card) {
  items.forEach((it) => {
    const on = it.card === card;
    it.a.classList.toggle(CURRENT, on);
    it.dots.forEach((d) => d.classList.toggle(CURRENT, on));
    if (on) it.a.setAttribute("aria-current", "true");
    else it.a.removeAttribute("aria-current");
  });
}

// The line a card's top must reach to be current: the list's top when it is
// shown, never above 40 px under the sticky top.
export function activeLine(nav, cards, win = window) {
  const base = stickyTop(cards[0], win) + LINE_PX;
  const r = nav && nav.getBoundingClientRect();
  return r && r.height ? Math.max(base, r.top + NAV_TOL_PX) : base;
}

// The list stops with its top level with the last panel's top.
export function fitNav(nav, cards, win = window) {
  if (!nav || !cards.length) return;
  const last = cards[cards.length - 1];
  const h = last.offsetHeight - (parseFloat(win.getComputedStyle(last).paddingTop) || 0);
  nav.style.minHeight = win.matchMedia(WIDE).matches && h > 0 ? `${h}px` : "";
}

function watchCurrent({ cards, items, nav }, win) {
  if (!cards.length || !items.length) return;
  let queued = false;
  let last = null;
  const update = () => {
    queued = false;
    const card = cards[currentIndex(cards, activeLine(nav, cards, win))];
    if (card !== last) setCurrent(items, (last = card));
  };
  const fit = () => {
    fitNav(nav, cards, win);
    update();
  };
  win.addEventListener("resize", () => win.requestAnimationFrame(fit), { passive: true });
  win.addEventListener("load", fit, { once: true });
  fitNav(nav, cards, win);
  const queue = () => {
    if (!queued) (queued = true), win.requestAnimationFrame(update);
  };
  win.addEventListener("scroll", queue, { passive: true });
  update();
}

// Keyboard and screen-reader users land on the card, as with the native anchor.
function focusCard(card) {
  if (!card.hasAttribute("tabindex")) card.setAttribute("tabindex", "-1");
  card.focus({ preventScroll: true });
}

function watchClicks({ cards, items }, win, reduce) {
  items.forEach(({ a, card }) => {
    a.addEventListener("click", (e) => {
      const lenis = win.staymoLenis;
      if (!lenis || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      // Webflow's own anchor scroll is delegated on document and ignores
      // preventDefault: stopped here, or it races Lenis to the wrong y.
      e.preventDefault();
      e.stopPropagation();
      const y = Math.max(0, staticTops(cards, win)[cards.indexOf(card)] - stickyTop(card, win));
      const onComplete = () => focusCard(card);
      if (reduce.matches) lenis.scrollTo(y, { immediate: true, onComplete });
      else lenis.scrollTo(y, { duration: 0.8, easing: easeInOutQuad, onComplete });
    });
  });
}

export function initStack(win = window, doc = document) {
  const { gsap, ScrollTrigger } = win;
  const stacks = Array.from(doc.querySelectorAll("[data-stack]"));
  if (!stacks.length) return null;
  const reduce = win.matchMedia(REDUCE);

  const all = stacks.map(parts);
  all.forEach((p) => {
    watchCurrent(p, win);
    watchClicks(p, win, reduce);
  });
  if (!gsap || !ScrollTrigger) return null;
  gsap.registerPlugin(ScrollTrigger);

  const mm = gsap.matchMedia();
  all.forEach(({ cards, title }) => {
    mm.add(MOTION, () => {
      cards.slice(0, -1).forEach((card, i) => {
        const img = card.querySelector("[data-stack-photo]");
        if (!img) return;
        // The frame keeps its corners round while the photo is transformed.
        if (img.parentElement) img.parentElement.style.isolation = "isolate";
        gsap.fromTo(
          img,
          { scale: 1.1 },
          {
            scale: 1,
            ease: "power1.out",
            scrollTrigger: {
              trigger: card,
              start: () => staticTops(cards, win)[i] - stickyTop(card, win),
              end: `+=${SETTLE_PX}`,
              scrub: true,
              invalidateOnRefresh: true
            }
          }
        );
      });
    });
    // A title already past its start at init stays as painted: hiding it
    // then would flash the end state before the start (page restored
    // mid-section, or a tall screen; motion QA 2026-10-20).
    if (title && title.getBoundingClientRect().top > win.innerHeight * 0.85) {
      const reveal = (y) => () =>
        gsap.from(title, { opacity: 0, y, duration: 0.6, ease: "power2.out", scrollTrigger: { trigger: title, start: "top 85%", once: true } });
      mm.add(DESKTOP, reveal(16));
      mm.add(PHONE, reveal(8));
    }
    mm.add(REDUCE, () => {
      cards.forEach((c) => (c.style.position = "static"));
      return () => cards.forEach((c) => (c.style.position = ""));
    });
  });

  const refresh = () => ScrollTrigger.refresh();
  if (doc.readyState !== "complete") win.addEventListener("load", refresh, { once: true });
  if (doc.fonts?.ready) doc.fonts.ready.then(refresh);
  return mm;
}

// GSAP comes from the Webflow CDN before module scripts; a short poll covers
// a late load, then the list and the click still work without the photo scrub.
export function startStack(win = window, doc = document) {
  const t0 = Date.now();
  const tick = () => {
    if ((win.gsap && win.ScrollTrigger) || Date.now() - t0 >= WAIT_MS) initStack(win, doc);
    else win.setTimeout(tick, POLL_MS);
  };
  tick();
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => startStack());
  else startStack();
}
