/* Header address bar — a compact "type your address" field in the fixed header.
   Markup contract (Webflow):
   - .hdr[data-hdr-bar] — gets data-hdr-mode="addr"|"nav" (CSS does the rest).
   - [data-hdr-addr][data-form-type="header-address"] — root; holds
     [data-input-id="address-search"], hidden [data-input-id="postal-code-result"],
     [data-hdr-addr-menu] and button[data-hdr-addr-geo]. Gets data-menu="open"
     and data-geo="loading".
   - [data-hdr-addr-submit] — wraps the header's Get Started link.
   Google Places, validation and error hints come from the site-wide inline code:
   window.staymoValidateAddress / staymoShowAddrError / staymoClearAddrError.
   Mode: "addr" once the hero form (or, without one, the first screen) is scrolled
   past, "nav" when scrolling back up; never leaves "addr" while the field is in use.
   A valid address goes to /start-hosting?postal-code=… (no address in the URL —
   the address itself travels through sessionStorage "staymo_address").
   No-op on pages without the root. */

export const STORAGE_KEY = "staymo_address";
export const STORAGE_TTL_MS = 30 * 60 * 1000;
export const SCROLL_HYSTERESIS = 8;
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

export function buildStartUrl(postal, pathname, search) {
  const params = new URLSearchParams();
  params.set("postal-code", postal);
  params.set("sourcepath", pathname || "/");
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
  else if (y > anchor + hysteresis) next = { mode: "addr", anchor: y };
  else if (y < anchor - hysteresis) next = { mode: "nav", anchor: y };
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

export function initHeaderAddress(win = window, doc = document) {
  const root = doc.querySelector("[data-hdr-addr]");
  if (!root) return null;
  const input = root.querySelector(ADDRESS_SELECTOR);
  if (!input) return null;
  const postalInput = root.querySelector(POSTAL_SELECTOR);
  const menu = root.querySelector("[data-hdr-addr-menu]");
  const geoButton = root.querySelector("[data-hdr-addr-geo]");
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
  const mobile = win.matchMedia ? win.matchMedia("(max-width: 767px)") : { matches: false };

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
  // mobile pick-submit from firing on our own placeSelected writes.
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
    return win.scrollY > win.innerHeight;
  };

  const setMode = (m) => {
    mode = m;
    if (bar) bar.setAttribute("data-hdr-mode", m);
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

  setMode("nav");
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
  const closeMenu = () => {
    menuOpen = false;
    root.removeAttribute("data-menu");
    schedule();
  };

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

  input.addEventListener("blur", () => {
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
    if (typeof win.staymoShowAddrError === "function") win.staymoShowAddrError(input, msg);
  };

  const useLocation = async () => {
    const geolocation = win.navigator?.geolocation;
    if (geoBusy || !geolocation) return;
    geoBusy = true;
    root.setAttribute("data-geo", "loading");
    closeMenu();
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
      fillInputs(picked.address, picked.postal, "geo");
      dataLayer.push({ event: "header_address_geo", result: picked.result });
      input.focus();
    } finally {
      geoBusy = false;
      root.removeAttribute("data-geo");
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
    writeStored(storage, { address: input.value.trim(), postal, beds, src: "header" });
    dataLayer.push({ event: "header_address_submit", method });
    win.location.assign(buildStartUrl(postal, win.location.pathname, win.location.search));
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

  // Mobile: a dropdown pick submits at once (observer set up after the prefill).
  if (typeof win.MutationObserver === "function") {
    new win.MutationObserver((records) => {
      const turnedOn = records.some((r) => r.oldValue !== "1") && input.dataset.placeSelected === "1";
      if (!turnedOn || !mobile.matches) return;
      if (fill && input.value === fill.value) return; // our own fill, not a pick
      submit();
    }).observe(input, { attributes: true, attributeFilter: ["data-place-selected"], attributeOldValue: true });
  }

  return { update, submit, useLocation, getMode: () => mode };
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => initHeaderAddress());
}
