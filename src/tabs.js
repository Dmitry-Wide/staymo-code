/* Tabs with optional auto-advance — WAI-ARIA APG Tabs (automatic activation)
   plus a carousel-style autoplay that meets WCAG 2.2 SC 2.2.2 (pause on hover
   and focus, stops for good once the visitor picks a tab). The module manages
   state only; every visual (panel fade, bar fill, description reveal) is CSS
   keyed on the state below. No dependencies; any number of roots per page.

   Markup (data-* contract):
     [data-tabs]                     root; data-tabs-interval="7000" = autoplay
                                     period in ms (absent or not > 0 → none)
       [data-tabs-list]              holds the tabs
         button[data-tabs-tab] ×N    real buttons, in order
           [data-tabs-progress]      optional: the thin bar under the tab
           [data-tabs-desc]          optional: text revealed on the active tab
                                     (it is inside the button, so it is part
                                     of the tab's accessible name: keep it short)
       [data-tabs-panel] ×N          same order as the tabs, anywhere in root
   Tabs and panels of a nested [data-tabs] belong to that root, not this one.
   The tab marked aria-selected="true" or .is-active starts active, else the
   first. Without JS nothing is hidden: all panels show as a list.

   What the module sets:
     root    data-tabs-ready         on init; hide inactive panels only under it
             data-tabs-autoplay      while autoplay is on (gone after a pick,
                                     under prefers-reduced-motion, or without an
                                     interval) — show/animate the bar only then
             data-tabs-paused        while autoplay is on but not running: before
                                     the root is ≥50% on screen, off screen, tab
                                     hidden, pointer over the root, focus inside
             --tabs-interval         the interval, e.g. "7000ms"
     list    role=tablist (aria-orientation is read, never written)
     tab     role=tab, aria-selected, aria-controls, roving tabindex, .is-active
     panel   role=tabpanel, aria-labelledby, tabindex=0, .is-active; inert
             while inactive (no stray focus during a fade-out)
     progress aria-hidden=true
   Missing ids are generated. Keys on the tablist: Left/Right, Home/End; Up/Down
   too when the list is vertical (aria-orientation="vertical", else a column
   flex-direction). Arrows wrap and activate. A click or a key that activates a
   tab turns autoplay off for good. prefers-reduced-motion: reduce → no
   autoplay (followed live). When the list overflows sideways (e.g. a row of
   pills on phones), each change of the active tab scrolls the list, never the
   page, so that tab is fully visible (instantly under reduced motion).

   The bar restarts each cycle because .is-active moves to another tab; pausing
   freezes it, and the module keeps the remaining time so both resume in step.

   Recommended CSS (Webflow side; class names are examples):
     [data-tabs-ready] [data-tabs-panel]:not(.is-active) { display: none; }
       — or, for a cross-fade, stack the panels in one grid cell:
     [data-tabs-ready] .tabs-panels { display: grid; }
     [data-tabs-ready] [data-tabs-panel] { grid-area: 1 / 1; opacity: 0;
       visibility: hidden; transition: opacity .3s, visibility 0s .3s; }
     [data-tabs-ready] [data-tabs-panel].is-active { opacity: 1;
       visibility: visible; transition: opacity .3s; }
     [data-tabs-progress] { transform: scaleX(0); transform-origin: left; }
     [data-tabs-autoplay] .is-active [data-tabs-progress] {
       animation: tabs-bar var(--tabs-interval) linear forwards; }
     [data-tabs-paused] .is-active [data-tabs-progress] {
       animation-play-state: paused; }
     @keyframes tabs-bar { to { transform: scaleX(1); } }
     [data-tabs-ready] [data-tabs-desc] { display: grid; grid-template-rows: 0fr;
       transition: grid-template-rows .3s; }  (child: overflow: hidden)
     [data-tabs-ready] .is-active [data-tabs-desc] { grid-template-rows: 1fr; }
     .is-active .bar { animation: grow .5s both; } with nth-child delays for
       bars rising one after another
     @media (prefers-reduced-motion: reduce) { …transition: none; animation: none; }
*/

let uid = 0;

const own = (root, sel) => Array.from(root.querySelectorAll(sel)).filter((el) => el.closest("[data-tabs]") === root);

function vertical(list) {
  const o = list.getAttribute("aria-orientation");
  if (o) return o === "vertical";
  return getComputedStyle(list).flexDirection.startsWith("column");
}

function setup(root) {
  const list = own(root, "[data-tabs-list]")[0];
  if (!list) return;
  const tabs = own(root, "[data-tabs-tab]");
  const panels = own(root, "[data-tabs-panel]");
  const n = Math.min(tabs.length, panels.length);
  if (!n) return;
  tabs.length = panels.length = n;

  const id = ++uid;
  list.setAttribute("role", "tablist");
  tabs.forEach((tab, i) => {
    const panel = panels[i];
    if (!tab.id) tab.id = `tabs-${id}-tab-${i + 1}`;
    if (!panel.id) panel.id = `tabs-${id}-panel-${i + 1}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panel.id);
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    panel.setAttribute("tabindex", "0");
    tab.querySelectorAll("[data-tabs-progress]").forEach((p) => p.setAttribute("aria-hidden", "true"));
  });

  let active = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true" || t.classList.contains("is-active"));
  if (active < 0) active = 0;

  const reduce = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

  // A list that overflows sideways (pills on phones) scrolls itself so the
  // active tab is fully in view; scrollIntoView would scroll the page too.
  function reveal(tab) {
    if (list.scrollWidth <= list.clientWidth) return;
    const lr = list.getBoundingClientRect();
    const tr = tab.getBoundingClientRect();
    const left = list.scrollLeft + tr.left - lr.left - list.clientLeft;
    const right = left + tr.width;
    let to;
    if (left < list.scrollLeft) to = left;
    else if (right > list.scrollLeft + list.clientWidth) to = right - list.clientWidth;
    else return;
    list.scrollTo({ left: to, behavior: reduce && reduce.matches ? "auto" : "smooth" });
  }

  function select(i) {
    active = i;
    tabs.forEach((tab, j) => {
      const on = j === i;
      tab.setAttribute("aria-selected", String(on));
      tab.setAttribute("tabindex", on ? "0" : "-1");
      tab.classList.toggle("is-active", on);
      panels[j].classList.toggle("is-active", on);
      panels[j].toggleAttribute("inert", !on);
    });
    reveal(tabs[i]);
  }
  select(active);

  // Autoplay. It runs only while every condition holds; `remaining` carries
  // the unspent part of the current cycle across pauses.
  const interval = Number(root.getAttribute("data-tabs-interval"));
  let enabled = n > 1 && interval > 0;
  let inView = typeof IntersectionObserver !== "function";
  let hover = false;
  let focus = false;
  let timer = 0;
  let startedAt = 0;
  let remaining = interval;

  const allowed = () => enabled && !(reduce && reduce.matches);
  const running = () => allowed() && inView && !hover && !focus && !document.hidden;

  function update() {
    const on = allowed();
    if (on && !root.hasAttribute("data-tabs-autoplay")) remaining = interval;
    root.toggleAttribute("data-tabs-autoplay", on);
    const run = running();
    root.toggleAttribute("data-tabs-paused", on && !run);
    if (run && !timer) {
      startedAt = Date.now();
      timer = setTimeout(tick, remaining);
    } else if (!run && timer) {
      clearTimeout(timer);
      timer = 0;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    }
  }
  function tick() {
    timer = 0;
    remaining = interval;
    select((active + 1) % n);
    update();
  }
  function stop() {
    enabled = false;
    update();
  }

  if (interval > 0) root.style.setProperty("--tabs-interval", `${interval}ms`);

  if (n > 1 && interval > 0) {
    if (!inView) {
      new IntersectionObserver(
        (entries) => {
          inView = entries[entries.length - 1].intersectionRatio >= 0.5;
          update();
        },
        { threshold: [0, 0.5, 1] },
      ).observe(root);
    }
    reduce?.addEventListener?.("change", update);
    document.addEventListener("visibilitychange", update);
    root.addEventListener("pointerenter", () => ((hover = true), update()));
    root.addEventListener("pointerleave", () => ((hover = false), update()));
    root.addEventListener("focusin", () => ((focus = true), update()));
    root.addEventListener("focusout", (e) => {
      if (root.contains(e.relatedTarget)) return;
      focus = false;
      update();
    });
  }

  tabs.forEach((tab, i) =>
    tab.addEventListener("click", () => {
      stop();
      select(i);
    }),
  );

  list.addEventListener("keydown", (e) => {
    const i = tabs.indexOf(e.target.closest?.("[data-tabs-tab]"));
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const v = vertical(list);
    let to;
    if (e.key === "ArrowRight" || (v && e.key === "ArrowDown")) to = (i + 1) % n;
    else if (e.key === "ArrowLeft" || (v && e.key === "ArrowUp")) to = (i - 1 + n) % n;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = n - 1;
    else return;
    e.preventDefault();
    stop();
    select(to);
    tabs[to].focus({ preventScroll: true });
  });

  root.setAttribute("data-tabs-ready", "");
  update();
}

export function initTabs(doc = document) {
  doc.querySelectorAll("[data-tabs]:not([data-tabs-ready])").forEach(setup);
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initTabs());
  else initTabs();
}
