/* Header address bar — a compact "type your address" field in the fixed header.
   Markup contract (Webflow):
   - .hdr[data-hdr-bar] — gets data-hdr-mode="addr"|"nav" (CSS does the rest).
   - [data-hdr-addr][data-form-type="header-address"] — root; holds
     [data-input-id="address-search"], hidden [data-input-id="postal-code-result"],
     [data-hdr-addr-menu] and button[data-hdr-addr-geo] (its [data-hdr-addr-geo-label]
     shows a geolocation failure in place of the label). Gets data-menu="open" and
     data-geo="loading" | "error".
   - button[data-hdr-addr-clear] (optional, inside .hdr__addr__field) — empties the
     field, the postcode and sessionStorage; CSS hides it while the field is empty.
   - [data-hdr-addr-submit] — wraps the header's Get Started link.
   Google Places, validation and error hints come from the site-wide inline code:
   window.staymoValidateAddress / staymoShowAddrError / staymoClearAddrError.
   Mode: "addr" once the hero form is scrolled past (without one: at the first scroll
   down, NO_HERO_OFFSET), "nav" when scrolling back up; never leaves "addr" while the
   field is in use.
   Motion («Вспышка»): with window.gsap and no reduced motion the module marks the bar
   data-hdr-fx and animates the switch — the menu items [data-hdr-fx="item"] melt into a
   pill at their place, the pill glides to the field and the field's content comes in
   (the marker fades in); back the same way. [data-hdr-fx="aside"] only fades;
   [data-hdr-fx="logo"]'s last child is the menu on mobile (the wordmark). CSS keeps the
   end states (visibility) either way; without the attribute it fades as before.
   dataLayer: header_address_focus, header_address_geo, header_address_submit,
   header_address_clear.
   Picking a Google suggestion submits at once (all widths); typed text waits for
   Enter / Get Started, geo and stored fills never auto-submit.
   A valid address goes to /start-hosting?address=…&postal-code=…&sourcepath=<page title>
   — the same shape as the hero form (no beds: /start-hosting asks on step 0), plus
   ad params. sessionStorage "staymo_address" keeps it for the prefill and the ×.
   No-op on pages without the root, and when the root is not rendered
   (display:none from a Designer variant, e.g. /dubai): no mode, no listeners, no prefill. */

export const STORAGE_KEY = "staymo_address";
export const STORAGE_TTL_MS = 30 * 60 * 1000;
export const SCROLL_HYSTERESIS = 8;
export const NO_HERO_OFFSET = 24;
export const PRECISE_ACCURACY_M = 100;
export const GEO_OPTIONS = { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 };
export const MSG_OUTSIDE_UK = "Looks like you're outside the UK — type the property address";
export const MSG_DENIED = "Location access is blocked — type your address instead";
export const MSG_UNAVAILABLE = "Couldn't find your location — type your address instead";

const ADDRESS_SELECTOR = '[data-input-id="address-search"]';
const POSTAL_SELECTOR = '[data-input-id="postal-code-result"]';
const PASS_THROUGH = /^(utm_|hsa_)|^(gclid|fbclid|msclkid)$/;
const ENTER_DELAY_MS = 300;
const BLUR_DELAY_MS = 200;
const MAPS_WAIT_MS = 10000;
const MAPS_POLL_MS = 100;

// --- Pure helpers ---

// Ad/campaign params worth carrying to /start-hosting, in their original order.
export function passThroughParams(search) {
  const out = [];
  new URLSearchParams(search || "").forEach((value, key) => {
    if (PASS_THROUGH.test(key)) out.push([key, value]);
  });
  return out;
}

// Same shape and order as the hero form's link; sourcepath is the page title.
export function buildStartUrl({ address, postal, title, pathname, search }) {
  const params = new URLSearchParams();
  params.set("address", address);
  params.set("postal-code", postal);
  params.set("sourcepath", (title || "").trim() || pathname || "/");
  passThroughParams(search).forEach(([k, v]) => params.append(k, v));
  return `/start-hosting?${params.toString()}`;
}

// Fresh entry ({address, postal, beds?, ts, src}) or null. Never throws (private mode).
export function readStored(storage, now = Date.now(), ttl = STORAGE_TTL_MS) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry !== "object") return null;
    if (!entry.postal || !entry.address) return null;
    if (!(now - Number(entry.ts) < ttl) || Number(entry.ts) > now) return null;
    return entry;
  } catch (e) {
    return null;
  }
}

export function writeStored(storage, { address, postal, beds, src }, now = Date.now()) {
  try {
    const entry = { address, postal, ts: now, src };
    if (beds !== undefined && beds !== null && String(beds).trim() !== "") entry.beds = String(beds).trim();
    storage.setItem(STORAGE_KEY, JSON.stringify(entry));
    return true;
  } catch (e) {
    return false;
  }
}

export function normalizePostcode(postcode) {
  return String(postcode || "").replace(/\s+/g, "").toUpperCase();
}

// "SW1V 1AA" → "SW1V". The inward part is always digit + two letters.
export function outwardCode(postcode) {
  const p = normalizePostcode(postcode);
  return /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(p) ? p.slice(0, -3) : "";
}

// One scroll step. `past` = the hero (or first screen) is scrolled past;
// `anchor` = scrollY where the current direction started (null above the threshold).
export function decideMode({ y, past, mode, anchor, locked, hysteresis = SCROLL_HYSTERESIS }) {
  let next;
  if (!past) next = { mode: "nav", anchor: null };
  else if (anchor === null || anchor === undefined) next = { mode: "addr", anchor: y };
  else if (y >= anchor + hysteresis) next = { mode: "addr", anchor: y };
  else if (y <= anchor - hysteresis) next = { mode: "nav", anchor: y };
  else {
    // Keep the anchor at the turning point of the current direction.
    const a = mode === "addr" ? Math.max(anchor, y) : Math.min(anchor, y);
    next = { mode, anchor: a };
  }
  if (locked && mode === "addr" && next.mode !== "addr") return { mode: "addr", anchor: y };
  return next;
}

function component(result, type) {
  return (result.address_components || []).find((c) => (c.types || []).includes(type));
}

function firstComponent(results, type, test = () => true) {
  for (const r of results) {
    const c = component(r, type);
    if (c && test(c.long_name)) return c.long_name;
  }
  return "";
}

// Reverse-geocode results + accuracy → {address, postal, result} or {error}.
export function pickGeoFill(results, accuracy) {
  const list = results || [];
  if (!list.length) return { error: "unavailable" };
  const country = list.map((r) => component(r, "country")).find(Boolean);
  if (!country || country.short_name !== "GB") return { error: "outside_uk" };

  if (Number(accuracy) <= PRECISE_ACCURACY_M) {
    const first = list[0];
    const postal = component(first, "postal_code")?.long_name || firstComponent(list, "postal_code");
    if (!postal || !first.formatted_address) return { error: "unavailable" };
    return { address: first.formatted_address.replace(/,\s*UK\s*$/, ""), postal, result: "ok" };
  }

  const full = firstComponent(list, "postal_code", (v) => outwardCode(v));
  if (!full) return { error: "unavailable" };
  const postal = outwardCode(full);
  const town = firstComponent(list, "postal_town") || firstComponent(list, "locality");
  return { address: town ? `${postal}, ${town}` : postal, postal, result: "imprecise" };
}

// --- Browser glue ---

function getPosition(geolocation) {
  return new Promise((resolve, reject) => geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS));
}

// Maps loads lazily on the field's first focus — poll for the Geocoder.
export function waitForGeocoder(win, timeoutMs = MAPS_WAIT_MS, stepMs = MAPS_POLL_MS) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (win.google?.maps?.Geocoder) return resolve(win.google.maps.Geocoder);
      if (Date.now() - started >= timeoutMs) return reject(new Error("maps"));
      setTimeout(tick, stepMs);
    };
    tick();
  });
}

function reverseGeocode(Geocoder, location) {
  return new Promise((resolve, reject) => {
    try {
      const geocoder = new Geocoder();
      geocoder.geocode({ location }, (results, status) => {
        if (status === "OK" && results && results.length) resolve(results);
        else reject(new Error(status || "geocode"));
      });
    } catch (e) {
      reject(e);
    }
  });
}

function isVisible(el) {
  if (typeof el.checkVisibility === "function") return el.checkVisibility();
  return el.getClientRects().length > 0;
}

// Bounding box of several rects ({left, right, top, bottom}); null for none.
export function unionRect(rects) {
  const list = (rects || []).filter((r) => r && r.right > r.left);
  if (!list.length) return null;
  const left = Math.min(...list.map((r) => r.left));
  const right = Math.max(...list.map((r) => r.right));
  return { left, right, width: right - left, cx: (left + right) / 2 };
}

// --- Mode switch motion («Вспышка») ---
// The pill is the field itself (.hdr__addr__field: the root's child holding the input):
// it starts at the menu's box and glides to the root's box, FLIP-style, so the same code
// serves the centred desktop field and the mobile flex item. Transform/opacity, plus the
// width of that one element. Interrupts start from where the pill is.
export function createHeaderFx(win, bar, root, input) {
  const gsap = win.gsap;
  if (!bar || !gsap || typeof gsap.timeline !== "function") return null;
  const mq = typeof win.matchMedia === "function" ? win.matchMedia("(prefers-reduced-motion: reduce)") : null;
  if (mq && mq.matches) return null;
  let field = input;
  while (field.parentElement && field.parentElement !== root) field = field.parentElement;
  if (field === input || !field.parentElement) return null;
  const inner = [...field.children].filter((el) => !(el.tagName === "INPUT" && el.type === "hidden"));
  const icon = inner[0];
  const rest = inner.slice(1);
  bar.setAttribute("data-hdr-fx", "");

  // Shown items only: on mobile the menu sits in the closed drawer (laid out, visibility:hidden).
  const shown = (el) =>
    typeof el.checkVisibility === "function" ? el.checkVisibility({ visibilityProperty: true }) : isVisible(el);
  const visible = (els) => els.filter(shown);
  const items = () => {
    const desk = visible([...bar.querySelectorAll('[data-hdr-fx="item"]')]);
    if (desk.length) return desk;
    const [logo] = visible([...bar.querySelectorAll('[data-hdr-fx="logo"]')]);
    return logo && logo.lastElementChild && logo.children.length > 1 ? [logo.lastElementChild] : [];
  };
  const asides = () => visible([...bar.querySelectorAll('[data-hdr-fx="aside"]')]);
  // Mobile: the only item is the logo's wordmark.
  const isWordmark = (its) => its.length === 1 && Boolean(its[0].parentElement) && its[0].parentElement.dataset.hdrFx === "logo";
  // Boxes without the motion's own x shift.
  const box = (el) => {
    const r = el.getBoundingClientRect();
    const x = Number(gsap.getProperty(el, "x")) || 0;
    return { left: r.left - x, right: r.right - x };
  };
  let tl = null;
  const stop = () => {
    const active = Boolean(tl && tl.isActive());
    if (tl) tl.kill();
    tl = null;
    return active;
  };

  const toAddr = (before) => {
    const mid = stop();
    const its = items();
    const c = unionRect(its.map(box));
    const r = root.getBoundingClientRect();
    // Clear what the motion set: a leftover transform on the input box would become the
    // containing block of the error hint (it floats under the field, absolute).
    // The start is set at once: the mode attribute has already shown the field, and a set
    // inside the timeline lands a frame later (one frame of the full field over the menu).
    // An interrupt starts from where the pill is: its x was relative to the root's nav box,
    // and on mobile the root's box moves with the mode (the pill ran off the screen's left edge).
    if (mid) gsap.set(field, { x: before.left - r.left, width: before.width });
    else {
      gsap.set(field, c ? { x: c.left - r.left, width: c.width, opacity: 0 } : { x: 0, opacity: 0 });
      gsap.set(inner, { opacity: 0 });
    }
    tl = gsap.timeline({
      onComplete: () => {
        gsap.set(field, { clearProps: "x,width" });
        gsap.set(inner, { clearProps: "transform,opacity" });
      },
    });
    tl.to(its, {
      opacity: 0,
      x: (i, el) => (c ? (c.cx - (box(el).left + box(el).right) / 2) * 0.3 : 0),
      duration: 0.26,
      ease: "power2.in",
      stagger: { each: 0.03, from: "edges" },
    }, 0)
      .to(asides(), { opacity: 0, duration: 0.2 }, 0)
      .to(field, { opacity: 1, duration: 0.2, ease: "none" }, 0.06)
      // No spring: an overshoot runs the pill past its bounds (into the menu button on mobile) and back.
      .to(field, { x: 0, width: r.width, duration: 0.65, ease: "power3.out" }, 0.2)
      .fromTo(icon, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out", immediateRender: false }, 0.5)
      .fromTo(rest, { x: -10, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, ease: "power2.out", immediateRender: false }, 0.55);
  };

  const toNav = (before) => {
    stop();
    const r = root.getBoundingClientRect();
    gsap.set(field, { x: before.left - r.left, width: before.width });
    const its = items();
    const c = unionRect(its.map(box));
    const word = isWordmark(its);
    tl = gsap.timeline();
    if (word) {
      // Mobile: the pill fades out on its way to the wordmark and the wordmark shows through it,
      // one crossfade (Dmitry picked it on the prototype: no beige pill swapped for the word at the end).
      tl.to(inner, { opacity: 0, duration: 0.12 }, 0);
      if (c) tl.to(field, { x: c.left - r.left, width: c.width, duration: 0.5, ease: "power3.out" }, 0.04);
      tl.to(field, { opacity: 0, duration: 0.32, ease: "power2.out" }, 0.06)
        .to(its, { opacity: 1, x: 0, duration: 0.4, ease: "power1.inOut" }, 0.16)
        .to(asides(), { opacity: 1, duration: 0.3 }, 0.16)
        .set(field, { clearProps: "x,width" }, 0.54)
        .set(inner, { clearProps: "transform" }, 0.54);
      return;
    }
    tl.to(inner, { opacity: 0, duration: 0.14 }, 0);
    if (c) tl.to(field, { x: c.left - r.left, width: c.width, duration: 0.45, ease: "power3.inOut" }, 0.06);
    tl.to(its, { opacity: 1, x: 0, duration: 0.32, ease: "power2.out", stagger: { each: 0.03, from: "center" } }, 0.36)
      .to(asides(), { opacity: 1, duration: 0.3 }, 0.36)
      .to(field, { opacity: 0, duration: 0.22, ease: "none" }, 0.4)
      .set(field, { clearProps: "x,width" })
      .set(inner, { clearProps: "transform" });
  };

  return {
    // The pill's box before the mode attribute flips (mobile: the root's flex box changes).
    measure: () => field.getBoundingClientRect(),
    play: (m, before) => (m === "addr" ? toAddr(before) : toNav(before)),
  };
}

export function initHeaderAddress(win = window, doc = document) {
  const root = doc.querySelector('[data-hdr-addr][data-form-type="header-address"]');
  if (!root) return null;
  if (typeof win.getComputedStyle === "function" && win.getComputedStyle(root).display === "none") return null;
  const input = root.querySelector(ADDRESS_SELECTOR);
  if (!input) return null;
  const postalInput = root.querySelector(POSTAL_SELECTOR);
  const menu = root.querySelector("[data-hdr-addr-menu]");
  const geoButton = root.querySelector("[data-hdr-addr-geo]");
  const clearButton = root.querySelector("[data-hdr-addr-clear]");
  const geoLabel = geoButton && geoButton.querySelector("[data-hdr-addr-geo-label]");
  const geoText = geoLabel ? geoLabel.textContent : "";
  const bar = root.closest("[data-hdr-bar]") || doc.querySelector("[data-hdr-bar]");
  const html = doc.documentElement;
  const storage = (() => {
    try {
      return win.sessionStorage;
    } catch (e) {
      return null;
    }
  })();
  const dataLayer = (win.dataLayer = win.dataLayer || []);

  let mode = "nav";
  let anchor = null;
  let focused = false;
  let menuOpen = false;
  let geoBusy = false;
  let submitting = false;
  let focusTracked = false;
  let rafPending = false;
  let blurTimer = null;
  // Last programmatic fill: lets submit report "geo"/"stored" and keeps the
  // pick-submit from firing on our own placeSelected writes.
  let fill = null;

  // --- Mode ---
  const pickHero = () =>
    [...doc.querySelectorAll('[data-form-type="main-estimate"]')].find(isVisible) || null;
  let hero = pickHero();

  const isPast = () => {
    if (hero) {
      const hdrBottom = bar ? bar.getBoundingClientRect().bottom : 0;
      return hero.getBoundingClientRect().bottom < hdrBottom;
    }
    return win.scrollY > NO_HERO_OFFSET;
  };

  const fx = createHeaderFx(win, bar, root, input);

  const setMode = (m, animate = true) => {
    const before = fx && animate ? fx.measure() : null;
    mode = m;
    if (bar) bar.setAttribute("data-hdr-mode", m);
    if (before) fx.play(m, before);
  };

  const update = () => {
    rafPending = false;
    const next = decideMode({
      y: win.scrollY,
      past: isPast(),
      mode,
      anchor,
      locked: focused || menuOpen || geoBusy,
    });
    anchor = next.anchor;
    if (next.mode !== mode) setMode(next.mode);
  };

  const schedule = () => {
    if (rafPending) return;
    rafPending = true;
    (win.requestAnimationFrame || ((cb) => setTimeout(cb, 16)))(update);
  };

  setMode("nav", false);
  schedule(); // page restored mid-scroll
  win.addEventListener("scroll", schedule, { passive: true });
  win.addEventListener("resize", () => {
    hero = pickHero();
    schedule();
    if (focused) placePac();
  });

  // --- Google dropdown placement under a fixed header ---
  const placePac = () => {
    const r = input.getBoundingClientRect();
    html.style.setProperty("--hdr-pac-top", `${r.bottom}px`);
    html.style.setProperty("--hdr-pac-left", `${r.left}px`);
    html.style.setProperty("--hdr-pac-width", `${r.width}px`);
  };
  win.addEventListener("scroll", () => focused && placePac(), { passive: true });

  // --- Menu ---
  const openMenu = () => {
    if (!menu || !win.navigator?.geolocation) return;
    menuOpen = true;
    root.setAttribute("data-menu", "open");
  };
  // A geolocation failure lives in the menu row until the menu closes (typing, Escape, blur).
  const clearGeoError = () => {
    if (root.getAttribute("data-geo") !== "error") return;
    root.removeAttribute("data-geo");
    if (geoLabel) geoLabel.textContent = geoText;
  };
  const closeMenu = () => {
    menuOpen = false;
    root.removeAttribute("data-menu");
    clearGeoError();
    schedule();
  };

  root.addEventListener("focusin", () => clearTimeout(blurTimer));
  input.addEventListener("focus", () => {
    clearTimeout(blurTimer);
    focused = true;
    html.setAttribute("data-hdr-addr-focus", "");
    placePac();
    if (!focusTracked) {
      focusTracked = true;
      dataLayer.push({ event: "header_address_focus" });
    }
    if (!input.value.trim()) openMenu();
  });

  // Focus leaving the root (from the field or the geo button).
  root.addEventListener("focusout", () => {
    clearTimeout(blurTimer);
    // Delay so a click on the geo button / a Google suggestion lands first.
    blurTimer = setTimeout(() => {
      if (root.contains(doc.activeElement)) return;
      focused = false;
      html.removeAttribute("data-hdr-addr-focus");
      closeMenu();
    }, BLUR_DELAY_MS);
  });

  input.addEventListener("input", () => {
    if (menuOpen) closeMenu();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (menuOpen) closeMenu();
      return;
    }
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    if (!input.value.trim()) return;
    if (menuOpen) closeMenu();
    // Let a highlighted Google suggestion get picked first.
    setTimeout(() => submit(), ENTER_DELAY_MS);
  });

  doc.addEventListener("pointerdown", (e) => {
    if (menuOpen && !root.contains(e.target)) closeMenu();
  });

  // --- Geolocation ---
  const fillInputs = (address, postal, method) => {
    input.value = address;
    if (postalInput) postalInput.value = postal;
    fill = { value: address, method };
    input.dataset.placeSelected = "1";
    if (typeof win.staymoClearAddrError === "function") win.staymoClearAddrError(input);
  };

  const geoFail = (result) => {
    const msg = result === "outside_uk" ? MSG_OUTSIDE_UK : result === "denied" ? MSG_DENIED : MSG_UNAVAILABLE;
    dataLayer.push({ event: "header_address_geo", result });
    if (geoLabel && menu) {
      root.setAttribute("data-geo", "error");
      geoLabel.textContent = msg;
      openMenu();
    } else if (typeof win.staymoShowAddrError === "function") win.staymoShowAddrError(input, msg);
  };

  const useLocation = async () => {
    const geolocation = win.navigator?.geolocation;
    if (geoBusy || !geolocation) return;
    geoBusy = true;
    clearGeoError();
    root.setAttribute("data-geo", "loading"); // the menu stays open: its row spins
    try {
      let pos;
      try {
        pos = await getPosition(geolocation);
      } catch (err) {
        return geoFail(err && err.code === 1 ? "denied" : "unavailable");
      }
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      let results;
      try {
        const Geocoder = await waitForGeocoder(win);
        results = await reverseGeocode(Geocoder, { lat, lng });
      } catch (e) {
        return geoFail("unavailable");
      }
      const picked = pickGeoFill(results, accuracy);
      if (picked.error) return geoFail(picked.error);
      if (root.getAttribute("data-geo") === "loading") root.removeAttribute("data-geo");
      closeMenu();
      fillInputs(picked.address, picked.postal, "geo");
      dataLayer.push({ event: "header_address_geo", result: picked.result });
      input.focus();
    } finally {
      geoBusy = false;
      if (root.getAttribute("data-geo") === "loading") root.removeAttribute("data-geo");
      schedule();
    }
  };

  if (geoButton) {
    // Keep focus in the field so blur doesn't race the click.
    geoButton.addEventListener("mousedown", (e) => e.preventDefault());
    geoButton.addEventListener("click", (e) => {
      e.preventDefault();
      useLocation();
    });
  }

  // --- Clear ---
  if (clearButton) {
    clearButton.addEventListener("mousedown", (e) => e.preventDefault());
    clearButton.addEventListener("click", (e) => {
      e.preventDefault();
      input.value = "";
      if (postalInput) postalInput.value = "";
      delete input.dataset.placeSelected;
      fill = null;
      try {
        storage?.removeItem(STORAGE_KEY);
      } catch (err) {}
      if (typeof win.staymoClearAddrError === "function") win.staymoClearAddrError(input);
      input.focus();
      openMenu(); // no focus event when the field already had focus
      dataLayer.push({ event: "header_address_clear" });
    });
  }

  // --- Submit ---
  const submit = async () => {
    if (submitting) return;
    const value = input.value.trim();
    if (!value) return;
    submitting = true;
    const method =
      fill && input.value === fill.value ? fill.method : input.dataset.placeSelected === "1" ? "pick" : "typed";
    let ok = false;
    try {
      ok =
        typeof win.staymoValidateAddress === "function"
          ? Boolean(await win.staymoValidateAddress(input))
          : Boolean(postalInput && postalInput.value.trim());
    } catch (e) {
      ok = false;
    }
    const postal = postalInput ? postalInput.value.trim() : "";
    if (!ok || !postal) {
      submitting = false;
      if (typeof win.staymoShowAddrError === "function") win.staymoShowAddrError(input);
      return;
    }
    const prev = readStored(storage);
    const beds = prev && normalizePostcode(prev.postal) === normalizePostcode(postal) ? prev.beds : undefined;
    const address = input.value.trim();
    writeStored(storage, { address, postal, beds, src: "header" });
    dataLayer.push({ event: "header_address_submit", method });
    win.location.assign(
      buildStartUrl({ address, postal, title: doc.title, pathname: win.location.pathname, search: win.location.search })
    );
  };

  // Back/forward cache restores the page mid-"submitting".
  win.addEventListener("pageshow", () => {
    submitting = false;
  });

  doc.addEventListener(
    "click",
    (e) => {
      const area = e.target.closest && e.target.closest("[data-hdr-addr-submit]");
      if (!area || !input.value.trim()) return; // empty → the link works as is
      e.preventDefault();
      submit();
    },
    true
  );

  // Hero form: remember what was typed there for /start-hosting and the header.
  doc.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest && e.target.closest('[data-action="get-estimate"]');
      const form = btn && btn.closest('[data-form-type="main-estimate"]');
      if (!form) return;
      const address = form.querySelector(ADDRESS_SELECTOR)?.value.trim();
      const postal = form.querySelector(POSTAL_SELECTOR)?.value.trim();
      const beds = form.querySelector('[data-input-id="beds-count"]')?.value;
      if (address && postal) writeStored(storage, { address, postal, beds, src: "hero" });
    },
    true
  );

  // --- Prefill from a fresh stored entry ---
  const stored = readStored(storage);
  if (stored && !input.value.trim()) fillInputs(stored.address, stored.postal, "stored");

  // A dropdown pick submits at once on every width (observer set up after the prefill).
  if (typeof win.MutationObserver === "function") {
    new win.MutationObserver((records) => {
      const turnedOn = records.some((r) => r.oldValue !== "1") && input.dataset.placeSelected === "1";
      if (!turnedOn) return;
      if (fill && input.value === fill.value) return; // our own fill, not a pick
      submit();
    }).observe(input, { attributes: true, attributeFilter: ["data-place-selected"], attributeOldValue: true });
  }

  return { update, submit, useLocation, getMode: () => mode };
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => initHeaderAddress());
}
