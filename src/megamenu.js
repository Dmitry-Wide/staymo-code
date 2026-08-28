/* Staymo header mega-menu controller.

   Scoped to a single `.mm` root. JS only toggles state classes — every timing,
   offset and easing lives on the class combos in the Designer, so the menu can be
   retuned without touching this file.

   Contract (attributes on the markup):
     .mm                          menu root
     .mm__bar-nav                 top nav row (hidden on scroll-down, desktop only)
     .mm__burger                  mobile toggle; .mm__burger-line children flip to the X
     .mm__trigger-wrap[data-open] top-level trigger; value = panel key
       .mm__trigger               the clickable label inside it (gets .is-active)
     .mm__panels                  dropdown/drawer surface (.is-open)
     .mm-panel[data-panel]        one per panel (.is-current)
       .mm-panel__head            mobile accordion header
       .mm-panel__inner           mobile accordion body / slide-over (.is-open)
       .mm-panel__content         faded in via .is-in
       .mm-step / .mm-hstep       revealed with a stagger via .is-in
     [data-tab]                   opens another panel (desktop) or a slide-over (mobile)
     .mm-back[data-tab]           back control: closes the slide-over on mobile,
                                  returns to the parent panel on desktop
     [data-expand]                two-state card toggle (.is-expanded on itself,
                                  on .mm-assess and on .mm-talk__reveal in the panel)
   Deep link: #mm=<panel-key>, or #mm=open for the bare surface. */

/* A secondary panel keeps its parent trigger highlighted while it is open. */
export const PARENT = {
  "how-it-works": "property-owners",
  "talk-to-team": "property-owners",
};

/* Reveal stagger between steps, ms. Pairs with the transition timings on .mm-step. */
export const STAGGER = 60;

/* Desktop nav hides only after the bar height is passed; sub-pixel jitter is ignored. */
const HIDE_AFTER = 120;
const MIN_DELTA = 4;

const SCROLL_EVENTS = ["wheel", "touchmove", "keydown"];
const SCROLL_KEYS = {
  " ": 1, PageUp: 1, PageDown: 1, Home: 1, End: 1, ArrowUp: 1, ArrowDown: 1,
};

/* happy-dom and older Safari expose different listener APIs on a MediaQueryList. */
function onMediaChange(mq, fn) {
  if (!mq) return;
  if (typeof mq.addEventListener === "function") mq.addEventListener("change", fn);
  else if (typeof mq.addListener === "function") mq.addListener(fn);
}

export function initMegaMenu(mm, { doc = document, win = window, mq } = {}) {
  if (!mm) return null;
  const panels = mm.querySelector(".mm__panels");
  if (!panels) return null;

  const burger = mm.querySelector(".mm__burger");
  const nav = mm.querySelector(".mm__bar-nav");
  const lines = burger ? burger.querySelectorAll(".mm__burger-line") : [];
  const root = doc.documentElement;
  const media = mq || (win.matchMedia ? win.matchMedia("(max-width: 767px)") : { matches: false });
  const isMobile = () => !!media.matches;

  const each = (sel, fn) => Array.from(mm.querySelectorAll(sel)).forEach(fn);
  const panelByKey = (key) => mm.querySelector(`.mm-panel[data-panel="${key}"]`);
  let timers = [];

  /* JS flips .is-active on the burger and each line; the X geometry is CSS. */
  function setBurger(on) {
    if (burger) burger.classList.toggle("is-active", on);
    Array.from(lines).forEach((l) => l.classList.toggle("is-active", on));
  }

  /* The site scrolls with Lenis, which moves the page from JS, so CSS overflow
     alone cannot stop it. While the menu is open we swallow scroll input in the
     CAPTURE phase (before Lenis sees it) — except inside the drawer, which must
     keep scrolling on mobile. */
  function blockScroll(e) {
    const t = e.target;
    if (t && t.closest && t.closest(".mm__panels")) return;
    if (e.type === "keydown") {
      if (!SCROLL_KEYS[e.key]) return;
      const tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function lock() {
    if (root.style.overflow === "hidden") return;
    const gap = win.innerWidth - root.clientWidth;
    root.style.overflow = "hidden";
    doc.body.style.overflow = "hidden";
    /* keeps the layout from jumping when the desktop scrollbar disappears */
    if (gap > 0) doc.body.style.paddingRight = `${gap}px`;
    SCROLL_EVENTS.forEach((n) => win.addEventListener(n, blockScroll, { passive: false, capture: true }));
  }

  function unlock() {
    root.style.overflow = "";
    doc.body.style.overflow = "";
    doc.body.style.paddingRight = "";
    SCROLL_EVENTS.forEach((n) => win.removeEventListener(n, blockScroll, { capture: true }));
  }

  function clearReveal() {
    timers.forEach(clearTimeout);
    timers = [];
    each(".mm-panel__content, .mm-step, .mm-hstep", (el) => el.classList.remove("is-in"));
    /* a panel always reopens collapsed */
    each(".mm-assess, .mm-talk__reveal, .mm-assess__toggle", (el) => el.classList.remove("is-expanded"));
  }

  /* JS only toggles .is-in. The promo card is deliberately NOT animated — it is
     the same card on Property owners and How it works, so fading it would make it
     flicker when switching between the two. */
  function reveal(panel) {
    const content = panel.querySelector(".mm-panel__content");
    if (content) {
      content.classList.remove("is-in");
      void content.offsetWidth; /* force reflow so the transition restarts from the hidden state */
      content.classList.add("is-in");
    }
    Array.from(panel.querySelectorAll(".mm-step, .mm-hstep")).forEach((el, i) => {
      timers.push(setTimeout(() => el.classList.add("is-in"), 80 + STAGGER * i));
    });
  }

  function closeAll() {
    panels.classList.remove("is-open");
    each(".mm-panel", (p) => p.classList.remove("is-current"));
    each(".mm-panel__inner", (i) => i.classList.remove("is-open"));
    each(".mm__trigger", (t) => t.classList.remove("is-active"));
    setBurger(false);
    unlock();
    clearReveal();
  }

  function openPanel(key) {
    const panel = panelByKey(key);
    if (!panel) return;
    clearReveal();
    each(".mm-panel", (p) => p.classList.remove("is-current"));
    panel.classList.add("is-current");
    panels.classList.add("is-open");
    lock();
    const activeKey = PARENT[key] || key;
    each(".mm__trigger-wrap", (w) => {
      const t = w.querySelector(".mm__trigger");
      if (t) t.classList.toggle("is-active", w.getAttribute("data-open") === activeKey);
    });
    reveal(panel);
  }

  /* On mobile a secondary panel is a slide-over on top of the drawer, so the
     drawer underneath is left as it is. */
  function openSub(key) {
    const panel = panelByKey(key);
    if (!panel) return;
    clearReveal();
    panel.classList.add("is-current");
    const inner = panel.querySelector(".mm-panel__inner");
    if (inner) inner.classList.add("is-open");
    reveal(panel);
  }

  function closeSub(panel) {
    panel.classList.remove("is-current");
    const inner = panel.querySelector(".mm-panel__inner");
    if (inner) inner.classList.remove("is-open");
    clearReveal();
  }

  /* Desktop only: scrolling down fades the nav out, scrolling up brings it back.
     JS toggles .is-hidden; opacity, easing and pointer-events live on that combo. */
  let lastY = win.scrollY || root.scrollTop || 0;

  function onScroll() {
    if (!nav || isMobile()) return;
    const y = win.scrollY || root.scrollTop || 0;
    const dy = y - lastY;
    if (Math.abs(dy) < MIN_DELTA) return;
    lastY = y;
    if (panels.classList.contains("is-open")) return;
    if (dy > 0 && y > HIDE_AFTER) nav.classList.add("is-hidden");
    else if (dy < 0) nav.classList.remove("is-hidden");
  }

  function onMenuClick(e) {
    if (e.target.closest(".mm__burger")) {
      e.preventDefault();
      if (panels.classList.contains("is-open")) { closeAll(); return; }
      panels.classList.add("is-open");
      setBurger(true);
      lock();
      return;
    }

    /* Two-state card: the steps bar grows while the assessment card shrinks.
       JS only flips .is-expanded — both heights and their easing are CSS. */
    const expand = e.target.closest("[data-expand]");
    if (expand) {
      e.preventDefault();
      const host = expand.closest(".mm-panel");
      const on = !expand.classList.contains("is-expanded");
      expand.classList.toggle("is-expanded", on);
      if (host) {
        Array.from(host.querySelectorAll(".mm-assess, .mm-talk__reveal"))
          .forEach((el) => el.classList.toggle("is-expanded", on));
      }
      return;
    }

    const back = e.target.closest(".mm-back");
    if (back) {
      e.preventDefault();
      const sub = back.closest(".mm-panel");
      if (isMobile()) { if (sub) closeSub(sub); }
      else openPanel(back.getAttribute("data-tab"));
      return;
    }

    const tab = e.target.closest("[data-tab]");
    if (tab) {
      e.preventDefault();
      const key = tab.getAttribute("data-tab");
      if (isMobile()) openSub(key); else openPanel(key);
      return;
    }

    const head = e.target.closest(".mm-panel__head");
    if (head && isMobile()) {
      e.preventDefault();
      const inner = head.parentElement.querySelector(".mm-panel__inner");
      if (!inner) return;
      const wasOpen = inner.classList.contains("is-open");
      each(".mm-panel__inner", (i) => i.classList.remove("is-open"));
      if (!wasOpen) inner.classList.add("is-open");
      return;
    }

    const wrap = e.target.closest(".mm__trigger-wrap");
    if (wrap && !isMobile()) {
      e.preventDefault();
      const wrapKey = wrap.getAttribute("data-open");
      const panel = panelByKey(wrapKey);
      const alreadyOpen = panels.classList.contains("is-open") && panel && panel.classList.contains("is-current");
      if (alreadyOpen) closeAll(); else openPanel(wrapKey);
    }

    /* Any working link closes the menu. A same-page anchor (How it works ->
       /#ready-to-get-started from the homepage), a tel:/mailto: or a link to the
       page you are already on never reloads, so nothing else would ever call
       closeAll(): the drawer stays open over the section it just scrolled to and
       the scroll lock is never released. This runs last because the burger and
       the triggers are anchors too and their branches return above. Placeholder
       rows (href="#") lead nowhere, so they leave the menu open. */
    const link = e.target.closest("a[href]");
    const href = link && link.getAttribute("href");
    if (href && href !== "#") closeAll();
  }

  function onOutsideClick(e) {
    if (!isMobile() && !e.target.closest(".mm")) closeAll();
  }

  function onKeydown(e) {
    if (e.key === "Escape" || e.key === "Esc") closeAll();
  }

  win.addEventListener("scroll", onScroll, { passive: true });
  mm.addEventListener("click", onMenuClick);
  doc.addEventListener("click", onOutsideClick);
  doc.addEventListener("keydown", onKeydown);
  onMediaChange(media, () => {
    closeAll();
    if (nav) nav.classList.remove("is-hidden");
  });

  /* Deep link: #mm=<panel-key>, #mm=open for the bare surface. */
  const hash = win.location && win.location.hash ? win.location.hash.match(/mm=([\w-]+)/) : null;
  if (hash) {
    panels.classList.add("is-open");
    lock();
    if (hash[1] !== "open") openPanel(hash[1]);
  }

  return { openPanel, openSub, closeAll, closeSub };
}

export function initAllMegaMenus(doc = document, options = {}) {
  return Array.from(doc.querySelectorAll(".mm"))
    .map((mm) => initMegaMenu(mm, { doc, ...options }))
    .filter(Boolean);
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => initAllMegaMenus());
}
