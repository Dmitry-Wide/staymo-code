/* Focus ring colour — the site CSS (in Webflow) draws the keyboard focus ring
   as `outline: 2px solid var(--focus-ring, <brand purple>)` on :focus-visible,
   on `.c-button__wrap:has(:focus-visible)` and `.w-dropdown-toggle`, plus rules
   keyed on [data-focus-photo] (a two-tone ring) and [data-focus-kb] (the beds
   counter wrapper). Purple vanishes on purple or dark sections, so on focusin
   this script looks at the background behind the focused element and picks:

   - brand #6938b8 contrasts ≥ 3:1 with it → nothing, the CSS default stays;
   - else white contrasts ≥ 3:1 → `--focus-ring: #fff` on the host;
   - else (a photo, or no clear colour) → white + [data-focus-photo], keyboard
     focus only and not on form fields.

   The host is the beds-counter wrapper [data-counter-target] when its input is
   focused from the keyboard (marked [data-focus-kb]), else the .c-button__wrap
   around the target, else the target. The background is the first ancestor
   whose box covers the host and paints something: a url() image means photo,
   a gradient is judged by its colour stops, a colour counts at alpha ≥ 0.5.
   focusout clears it all. Any failure is swallowed and leaves the CSS default.

   Binds to .c-button__wrap (the repo rule is data-* only): the Button component
   is Webflow's own markup and carries no data attributes. */

const PROP = "--focus-ring";
const PHOTO = "data-focus-photo";
const KB = "data-focus-kb";

const NONE = 0;
const WHITE = 1;
const PHOTO_RING = 2;

// WCAG 2 relative luminance of an sRGB triple given as strings or numbers.
function channel(c) {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const luminance = (rgb) => 0.2126 * channel(+rgb[0]) + 0.7152 * channel(+rgb[1]) + 0.0722 * channel(+rgb[2]);
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const BRAND = luminance([105, 56, 184]); // #6938b8
const WHITE_L = 1;

// Does box `q` cover box `r` (1px slack)?
const covers = (q, r) =>
  q.left <= r.left + 1 && q.top <= r.top + 1 && q.right >= r.right - 1 && q.bottom >= r.bottom - 1;

// Which ring the host needs, judged by the background behind it.
function pick(el, win) {
  const r = el.getBoundingClientRect();
  for (let a = el.parentElement; a; a = a.parentElement) {
    if (!covers(a.getBoundingClientRect(), r)) continue;

    const s = win.getComputedStyle(a);
    const image = s.backgroundImage;
    let colours;
    if (image && image !== "none") {
      if (image.indexOf("url(") >= 0) return PHOTO_RING;
      colours = image.match(/rgba?\([^)]*\)/g);
      if (!colours) return PHOTO_RING;
    } else {
      if (s.backgroundColor.indexOf("rgb") !== 0) return NONE;
      colours = [s.backgroundColor];
    }

    // The worst stop decides; translucent stops (alpha < 0.5) don't count.
    let brand = 99;
    let white = 99;
    let opaque = 0;
    for (const c of colours) {
      const m = c.match(/[\d.]+/g);
      if (!m || m.length < 3 || (m.length > 3 && +m[3] < 0.5)) continue;
      opaque++;
      const y = luminance(m);
      brand = Math.min(brand, contrast(y, BRAND));
      white = Math.min(white, contrast(y, WHITE_L));
    }
    if (!opaque) continue;
    return brand >= 3 ? NONE : white >= 3 ? WHITE : PHOTO_RING;
  }
  return NONE;
}

export function initFocusRing(doc = document) {
  const win = doc.defaultView;
  let host = null;
  let keyboard = false;

  const off = () => {
    if (!host) return;
    host.style.removeProperty(PROP);
    host.removeAttribute(PHOTO);
    host.removeAttribute(KB);
    host = null;
  };

  const onKey = () => (keyboard = true);
  const onPointer = () => (keyboard = false);

  const onFocusIn = (e) => {
    try {
      off();
      const t = e.target;
      if (!t || !t.style) return;

      const counter = t.closest && t.matches("input") && t.closest("[data-counter-target]");
      if (counter) {
        if (!keyboard) return;
        host = counter;
        host.setAttribute(KB, "");
      } else {
        host = (t.closest && t.closest(".c-button__wrap")) || t;
      }

      const ring = pick(host, win);
      if (ring) host.style.setProperty(PROP, "#fff");
      if (ring === PHOTO_RING && keyboard && !/^(INPUT|TEXTAREA|SELECT)$/.test(host.tagName)) {
        host.setAttribute(PHOTO, "");
      }
    } catch (x) {}
  };

  const onFocusOut = () => {
    try {
      off();
    } catch (x) {}
  };

  // Capture phase: know the input kind before any focusin it causes.
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("mousedown", onPointer, true);
  doc.addEventListener("pointerdown", onPointer, true);
  doc.addEventListener("touchstart", onPointer, true);
  doc.addEventListener("focusin", onFocusIn);
  doc.addEventListener("focusout", onFocusOut);
}

if (typeof window !== "undefined") {
  try {
    initFocusRing();
  } catch (x) {}
}
