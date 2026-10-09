import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  passThroughParams,
  buildStartUrl,
  readStored,
  writeStored,
  outwardCode,
  decideMode,
  pickGeoFill,
  initHeaderAddress,
  unionRect,
  NO_HERO_OFFSET,
  STORAGE_KEY,
  MSG_OUTSIDE_UK,
  MSG_DENIED,
  MSG_UNAVAILABLE,
} from "../src/header-address.js";

function memStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => (data[k] = String(v)),
    removeItem: (k) => delete data[k],
  };
}

describe("pure helpers", () => {
  it("passThroughParams keeps utm_*, hsa_*, gclid, fbclid, msclkid only", () => {
    const s = "?utm_source=g&x=1&hsa_cam=7&gclid=G&fbclid=F&msclkid=M&address=secret&utm=bad";
    expect(passThroughParams(s)).toEqual([
      ["utm_source", "g"],
      ["hsa_cam", "7"],
      ["gclid", "G"],
      ["fbclid", "F"],
      ["msclkid", "M"],
    ]);
    expect(passThroughParams("")).toEqual([]);
  });

  it("buildStartUrl matches the hero link: address, postcode, page title, then ad params", () => {
    const url = buildStartUrl({
      address: "1 Rose St, London",
      postal: "SW1V 1AA",
      title: "Rent & Earn | Staymo",
      pathname: "/guides/x",
      search: "?utm_source=g&address=Old&beds=3&gclid=abc",
    });
    expect(url).toBe(
      "/start-hosting?address=1+Rose+St%2C+London&postal-code=SW1V+1AA&sourcepath=Rent+%26+Earn+%7C+Staymo&utm_source=g&gclid=abc"
    );
    const params = new URLSearchParams(url.split("?")[1]);
    expect([...params.keys()]).toEqual(["address", "postal-code", "sourcepath", "utm_source", "gclid"]);
    expect(params.get("sourcepath")).toBe("Rent & Earn | Staymo");
    expect(params.has("beds")).toBe(false);
  });

  it("buildStartUrl falls back to the pathname without a title", () => {
    expect(buildStartUrl({ address: "a", postal: "E14", title: "  ", pathname: "/guides/x", search: "" })).toBe(
      "/start-hosting?address=a&postal-code=E14&sourcepath=%2Fguides%2Fx"
    );
    expect(buildStartUrl({ address: "a", postal: "E14", pathname: "" })).toBe(
      "/start-hosting?address=a&postal-code=E14&sourcepath=%2F"
    );
  });

  it("readStored/writeStored round-trip with a 30 min TTL", () => {
    const store = memStore();
    expect(writeStored(store, { address: "1 Rose St", postal: "SW1V 1AA", beds: 3, src: "hero" }, 1000)).toBe(true);
    expect(JSON.parse(store.data[STORAGE_KEY])).toEqual({ address: "1 Rose St", postal: "SW1V 1AA", beds: "3", ts: 1000, src: "hero" });
    expect(readStored(store, 1000 + 29 * 60 * 1000)).toMatchObject({ postal: "SW1V 1AA" });
    expect(readStored(store, 1000 + 30 * 60 * 1000)).toBe(null);
    writeStored(store, { address: "a", postal: "b", beds: "", src: "header" }, 1000);
    expect(JSON.parse(store.data[STORAGE_KEY]).beds).toBeUndefined();
  });

  it("storage errors never throw", () => {
    const bad = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(readStored(bad)).toBe(null);
    expect(writeStored(bad, { address: "a", postal: "b" })).toBe(false);
    expect(readStored(null)).toBe(null);
    expect(readStored(memStore({ [STORAGE_KEY]: "{nope" }))).toBe(null);
  });

  it("outwardCode", () => {
    expect(outwardCode("SW1V 1AA")).toBe("SW1V");
    expect(outwardCode("e14 9gp")).toBe("E14");
    expect(outwardCode("M1 1AE")).toBe("M1");
    expect(outwardCode("SW1V")).toBe("");
    expect(outwardCode("")).toBe("");
  });

  describe("decideMode", () => {
    it("is nav above the threshold, addr once past it", () => {
      expect(decideMode({ y: 100, past: false, mode: "nav", anchor: null })).toEqual({ mode: "nav", anchor: null });
      expect(decideMode({ y: 700, past: true, mode: "nav", anchor: null })).toEqual({ mode: "addr", anchor: 700 });
    });
    it("goes nav on scrolling up ≥ 8px, addr again on scrolling down ≥ 8px", () => {
      let s = { mode: "addr", anchor: 900 };
      s = decideMode({ y: 905, past: true, ...s });
      expect(s).toEqual({ mode: "addr", anchor: 905 });
      s = decideMode({ y: 899, past: true, ...s });
      expect(s.mode).toBe("addr");
      s = decideMode({ y: 897, past: true, ...s });
      expect(s).toEqual({ mode: "nav", anchor: 897 });
      s = decideMode({ y: 880, past: true, ...s });
      expect(s).toEqual({ mode: "nav", anchor: 880 });
      s = decideMode({ y: 887, past: true, ...s });
      expect(s.mode).toBe("nav");
      s = decideMode({ y: 888, past: true, ...s });
      expect(s).toEqual({ mode: "addr", anchor: 888 });
    });
    it("never leaves addr while locked", () => {
      expect(decideMode({ y: 100, past: true, mode: "addr", anchor: 900, locked: true }).mode).toBe("addr");
      expect(decideMode({ y: 0, past: false, mode: "addr", anchor: 900, locked: true }).mode).toBe("addr");
    });
  });

  describe("pickGeoFill", () => {
    const gb = { long_name: "United Kingdom", short_name: "GB", types: ["country", "political"] };
    const results = [
      {
        formatted_address: "10 Rose St, London SW1V 1AA, UK",
        address_components: [
          { long_name: "SW1V 1AA", types: ["postal_code"] },
          { long_name: "London", types: ["postal_town"] },
          gb,
        ],
      },
      { formatted_address: "London, UK", address_components: [{ long_name: "London", types: ["locality"] }, gb] },
    ];
    it("precise → full address without ', UK' and its postcode", () => {
      expect(pickGeoFill(results, 20)).toEqual({ address: "10 Rose St, London SW1V 1AA", postal: "SW1V 1AA", result: "ok" });
    });
    it("precise falls back to the first postcode among results", () => {
      const r = [{ formatted_address: "Rose St, London, UK", address_components: [gb] }, results[0]];
      expect(pickGeoFill(r, 50).postal).toBe("SW1V 1AA");
    });
    it("imprecise → district only", () => {
      expect(pickGeoFill(results, 500)).toEqual({ address: "SW1V, London", postal: "SW1V", result: "imprecise" });
    });
    it("imprecise uses locality when there's no postal_town", () => {
      const r = [
        { address_components: [{ long_name: "E14", types: ["postal_code"] }, gb] },
        { address_components: [{ long_name: "E14 9GP", types: ["postal_code"] }, { long_name: "Poplar", types: ["locality"] }, gb] },
      ];
      expect(pickGeoFill(r, 500)).toEqual({ address: "E14, Poplar", postal: "E14", result: "imprecise" });
    });
    it("outside the UK / nothing usable", () => {
      const fr = [{ formatted_address: "Paris, France", address_components: [{ short_name: "FR", types: ["country"] }] }];
      expect(pickGeoFill(fr, 10)).toEqual({ error: "outside_uk" });
      expect(pickGeoFill([], 10)).toEqual({ error: "unavailable" });
      expect(pickGeoFill([{ formatted_address: "x", address_components: [gb] }], 10)).toEqual({ error: "unavailable" });
    });
  });
});

describe("unionRect", () => {
  it("boxes several rects, skips empty ones", () => {
    expect(unionRect([{ left: 10, right: 50 }, { left: 80, right: 120 }, { left: 0, right: 0 }])).toEqual({
      left: 10, right: 120, width: 110, cx: 65,
    });
    expect(unionRect([])).toBe(null);
  });
});

// A recording stand-in for GSAP: timelines log their calls, kill() is observable.
function fakeGsap() {
  const timelines = [];
  const sets = [];
  return {
    timelines,
    sets,
    timeline() {
      const tl = { calls: [], killed: false };
      ["set", "to", "fromTo"].forEach((m) => (tl[m] = (...a) => (tl.calls.push([m, ...a]), tl)));
      tl.isActive = () => !tl.killed;
      tl.kill = () => (tl.killed = true);
      timelines.push(tl);
      return tl;
    },
    set: (target, vars) => sets.push([target, vars]),
    getProperty: () => 0,
  };
}

describe("initHeaderAddress", () => {
  let store, win, input, postal, root, bar, assign;
  const $ = (s) => document.querySelector(s);

  function setup({ hero = false, storage = memStore(), geo, clear = false, hidden = false, gsap, reduce = false } = {}) {
    document.body.innerHTML = `
      <div class="hdr" data-hdr-bar>
        <a data-hdr-fx="logo"><i>icon</i><i id="word">Staymo</i></a>
        <nav><a data-hdr-fx="item" id="i1">Locations</a><a data-hdr-fx="item" id="i2">Pricing</a></nav>
        <a data-hdr-fx="aside" id="login">Log in</a>
        <div data-hdr-addr data-form-type="header-address">
          <div class="hdr__addr__field"><input data-input-id="address-search">${
            clear ? `<button type="button" data-hdr-addr-clear aria-label="Clear address">×</button>` : ""
          }</div>
          <input type="hidden" data-input-id="postal-code-result">
          <div data-hdr-addr-menu><button data-hdr-addr-geo><i></i><span data-hdr-addr-geo-label>Use my current location</span></button></div>
        </div>
        <div data-hdr-addr-submit><a href="/start-hosting" id="go">Get Started</a></div>
      </div>
      ${hero ? `<div data-form-type="main-estimate" id="hero">
        <input data-input-id="address-search" value="">
        <input data-input-id="postal-code-result" value="">
        <input data-input-id="beds-count" value="">
        <button data-action="get-estimate">Go</button></div>` : ""}`;
    store = storage;
    assign = vi.fn();
    const listeners = {};
    win = {
      scrollY: 0,
      innerHeight: 800,
      sessionStorage: store,
      dataLayer: undefined,
      navigator: geo === null ? {} : { geolocation: geo || { getCurrentPosition: vi.fn() } },
      location: { pathname: "/blog/a", search: "?utm_source=x&foo=1", assign },
      matchMedia: (q) => ({ matches: reduce && q.includes("reduce") }),
      gsap,
      requestAnimationFrame: (cb) => cb(),
      MutationObserver: window.MutationObserver,
      getComputedStyle: (el) => window.getComputedStyle(el),
      addEventListener: (t, fn) => (listeners[t] = listeners[t] || []).push(fn),
      fire: (t) => (listeners[t] || []).forEach((fn) => fn(new Event(t))),
    };
    if (hidden) $("[data-hdr-addr]").style.display = "none";
    const api = initHeaderAddress(win, document);
    input = $("[data-hdr-addr] [data-input-id=address-search]");
    postal = $("[data-hdr-addr] [data-input-id=postal-code-result]");
    root = $("[data-hdr-addr]");
    bar = $("[data-hdr-bar]");
    return api;
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute("data-hdr-addr-focus");
  });

  it("is a no-op without the root", () => {
    document.body.innerHTML = `<div data-hdr-bar></div>`;
    expect(initHeaderAddress({}, document)).toBe(null);
    expect($("[data-hdr-bar]").hasAttribute("data-hdr-mode")).toBe(false);
  });

  describe("hidden root (e.g. /dubai)", () => {
    const entry = () =>
      memStore({ staymo_address: JSON.stringify({ address: "1 Rose St", postal: "SW1V 1AA", ts: Date.now() - 1000 }) });

    it("is off: no mode, no prefill, the CTA link works as is", async () => {
      const api = setup({ storage: entry(), hidden: true });
      expect(api).toBe(null);
      expect(bar.hasAttribute("data-hdr-mode")).toBe(false);
      win.scrollY = 900;
      win.fire("scroll");
      expect(bar.hasAttribute("data-hdr-mode")).toBe(false);
      expect(input.value).toBe("");
      expect(postal.value).toBe("");
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
      $("#go").dispatchEvent(ev);
      await vi.advanceTimersByTimeAsync(500);
      expect(ev.defaultPrevented).toBe(false);
      expect(assign).not.toHaveBeenCalled();
      expect(win.dataLayer).toBeUndefined();
    });

    it("works as before when the root is visible", () => {
      const api = setup({ storage: entry() });
      expect(api).not.toBe(null);
      expect(bar.dataset.hdrMode).toBe("nav");
      expect(input.value).toBe("1 Rose St");
      input.value = ""; // its document-level click handler outlives this test
    });

    it("works when getComputedStyle is missing", () => {
      document.body.innerHTML = `<div data-hdr-bar><div data-hdr-addr data-form-type="header-address">
        <input data-input-id="address-search"></div></div>`;
      const w = { addEventListener: () => {}, scrollY: 0, innerHeight: 800, requestAnimationFrame: (cb) => cb(), location: {} };
      expect(initHeaderAddress(w, document)).not.toBe(null);
    });
  });

  it("no hero: switches at the first scroll down, back to nav at the top", () => {
    setup();
    win.scrollY = NO_HERO_OFFSET;
    win.fire("scroll");
    expect(bar.dataset.hdrMode).toBe("nav");
    win.scrollY = NO_HERO_OFFSET + 1;
    win.fire("scroll");
    expect(bar.dataset.hdrMode).toBe("addr");
    win.scrollY = 0;
    win.fire("scroll");
    expect(bar.dataset.hdrMode).toBe("nav");
  });

  it("starts in nav and follows the scroll direction (no hero)", () => {
    setup();
    expect(bar.dataset.hdrMode).toBe("nav");
    win.scrollY = 900;
    win.fire("scroll");
    expect(bar.dataset.hdrMode).toBe("addr");
    win.scrollY = 880;
    win.fire("scroll");
    expect(bar.dataset.hdrMode).toBe("nav");
    win.scrollY = 900;
    win.fire("scroll");
    expect(bar.dataset.hdrMode).toBe("addr");
    win.scrollY = 300;
    win.fire("scroll");
    expect(bar.dataset.hdrMode).toBe("nav");
  });

  it("uses the hero's bottom vs the header's bottom", () => {
    const proto = HTMLElement.prototype;
    const orig = proto.checkVisibility;
    proto.checkVisibility = function () { return true; };
    let heroBottom = 600;
    const rect = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function () {
      if (this.id === "hero") return { top: 0, bottom: heroBottom, left: 0, width: 0 };
      if (this.hasAttribute("data-hdr-bar")) return { top: 0, bottom: 80, left: 0, width: 0 };
      return rect.call(this);
    };
    try {
      setup({ hero: true });
      win.scrollY = 100;
      win.fire("scroll");
      expect(bar.dataset.hdrMode).toBe("nav");
      heroBottom = 60;
      win.scrollY = 540;
      win.fire("scroll");
      expect(bar.dataset.hdrMode).toBe("addr");
    } finally {
      proto.getBoundingClientRect = rect;
      if (orig) proto.checkVisibility = orig; else delete proto.checkVisibility;
    }
  });

  describe("motion", () => {
    let orig;
    beforeEach(() => {
      orig = HTMLElement.prototype.checkVisibility;
      HTMLElement.prototype.checkVisibility = function () { return true; };
    });
    afterEach(() => {
      if (orig) HTMLElement.prototype.checkVisibility = orig; else delete HTMLElement.prototype.checkVisibility;
    });

    it("off without GSAP: no data-hdr-fx, CSS fades as before", () => {
      setup();
      expect(bar.hasAttribute("data-hdr-fx")).toBe(false);
      expect(document.querySelector("[data-hdr-fx-ring]")).toBe(null);
    });

    it("off with reduced motion", () => {
      const gsap = fakeGsap();
      setup({ gsap, reduce: true });
      expect(bar.hasAttribute("data-hdr-fx")).toBe(false);
      win.scrollY = 900;
      win.fire("scroll");
      expect(gsap.timelines.length).toBe(0);
    });

    it("marks the bar, adds shine and ring to the field, no motion on load", () => {
      const gsap = fakeGsap();
      setup({ gsap });
      expect(bar.hasAttribute("data-hdr-fx")).toBe(true);
      const field = document.querySelector(".hdr__addr__field");
      expect(field.querySelector("[data-hdr-fx-glow] i")).not.toBe(null);
      expect(field.lastElementChild.hasAttribute("data-hdr-fx-ring")).toBe(true);
      expect(gsap.timelines.length).toBe(0);
    });

    it("addr: the menu items melt, the pill starts at their box; nav: back; an interrupt kills and resets", () => {
      const gsap = fakeGsap();
      setup({ gsap });
      win.scrollY = 900;
      win.fire("scroll");
      expect(bar.dataset.hdrMode).toBe("addr");
      const [inTl] = gsap.timelines;
      const field = document.querySelector(".hdr__addr__field");
      const startsAt = inTl.calls.find((c) => c[0] === "set" && c[1] === field);
      expect(startsAt[2]).toMatchObject({ opacity: 0 });
      const melt = inTl.calls.find((c) => c[0] === "to" && Array.isArray(c[1]) && c[1][0]?.id === "i1");
      expect(melt[1].map((e) => e.id)).toEqual(["i1", "i2"]);
      expect(melt[2]).toMatchObject({ opacity: 0 });
      expect(inTl.calls.some((c) => c[0] === "to" && c[1]?.[0]?.id === "login")).toBe(true);

      win.scrollY = 880;
      win.fire("scroll");
      expect(bar.dataset.hdrMode).toBe("nav");
      expect(inTl.killed).toBe(true);
      const ring = document.querySelector("[data-hdr-fx-ring]");
      expect(gsap.sets.some(([t, v]) => t === ring && v.opacity === 0)).toBe(true);
      const back = gsap.timelines[1].calls.find((c) => c[0] === "to" && c[1]?.[0]?.id === "i1");
      expect(back[2]).toMatchObject({ opacity: 1, x: 0 });
      // the shine rests hidden; the way back clears the field content's transforms
      const shine = document.querySelector("[data-hdr-fx-glow] i");
      expect(gsap.sets.some(([tg, v]) => tg === shine && v.opacity === 0)).toBe(true);
      expect(gsap.timelines[1].calls.some((c) => c[0] === "set" && Array.isArray(c[1]) && c[2].clearProps === "transform")).toBe(true);
    });

    it("mobile: the wordmark is the menu when no item is visible", () => {
      HTMLElement.prototype.checkVisibility = function () { return this.dataset.hdrFx !== "item"; };
      const gsap = fakeGsap();
      setup({ gsap });
      win.scrollY = 900;
      win.fire("scroll");
      const melt = gsap.timelines[0].calls.find((c) => c[0] === "to" && c[1]?.[0]?.id === "word");
      expect(melt).toBeTruthy();
    });
  });

  it("stays in addr while the field is focused", () => {
    setup();
    win.scrollY = 900;
    win.fire("scroll");
    input.focus();
    win.scrollY = 10;
    win.fire("scroll");
    expect(bar.dataset.hdrMode).toBe("addr");
    input.blur();
    vi.advanceTimersByTime(250);
    expect(bar.dataset.hdrMode).toBe("nav");
  });

  it("menu opens on focus when empty, closes on typing / Escape / blur", () => {
    setup();
    input.focus();
    expect(root.dataset.menu).toBe("open");
    expect(document.documentElement.hasAttribute("data-hdr-addr-focus")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--hdr-pac-top")).toMatch(/px$/);
    input.value = "1";
    input.dispatchEvent(new Event("input"));
    expect(root.hasAttribute("data-menu")).toBe(false);
    input.blur();
    input.value = "";
    input.focus();
    expect(root.dataset.menu).toBe("open");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(root.hasAttribute("data-menu")).toBe(false);
    input.blur();
    vi.advanceTimersByTime(250);
    expect(document.documentElement.hasAttribute("data-hdr-addr-focus")).toBe(false);
  });

  it("releases focus state when focus leaves via the geo button", () => {
    setup();
    win.scrollY = 900;
    win.fire("scroll");
    input.focus();
    $("[data-hdr-addr-geo]").focus();
    vi.advanceTimersByTime(250);
    expect(document.documentElement.hasAttribute("data-hdr-addr-focus")).toBe(true);
    $("#go").focus();
    vi.advanceTimersByTime(250);
    expect(document.documentElement.hasAttribute("data-hdr-addr-focus")).toBe(false);
    expect(root.hasAttribute("data-menu")).toBe(false);
    win.scrollY = 300;
    win.fire("scroll");
    expect(bar.dataset.hdrMode).toBe("nav");
  });

  it("no menu without geolocation", () => {
    setup({ geo: null });
    input.focus();
    expect(root.hasAttribute("data-menu")).toBe(false);
  });

  it("pushes header_address_focus once per page", () => {
    setup();
    input.focus();
    input.blur();
    input.focus();
    expect(win.dataLayer.filter((e) => e.event === "header_address_focus")).toHaveLength(1);
  });

  describe("submit", () => {
    it("empty field: the link works, Enter does nothing", async () => {
      setup();
      win.staymoValidateAddress = vi.fn();
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
      $("#go").dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      await vi.advanceTimersByTimeAsync(400);
      expect(win.staymoValidateAddress).not.toHaveBeenCalled();
    });

    it("click → validate → store → /start-hosting with postcode and ad params", async () => {
      setup();
      win.staymoValidateAddress = vi.fn(async () => {
        postal.value = "SW1V 1AA";
        return true;
      });
      input.value = "1 Rose St";
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
      $("#go").dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      $("#go").click(); // double submit guarded
      await vi.advanceTimersByTimeAsync(0);
      expect(win.staymoValidateAddress).toHaveBeenCalledTimes(1);
      expect(assign).toHaveBeenCalledWith(
        "/start-hosting?address=1+Rose+St&postal-code=SW1V+1AA&sourcepath=%2Fblog%2Fa&utm_source=x"
      );
      expect(JSON.parse(store.data.staymo_address)).toMatchObject({ address: "1 Rose St", postal: "SW1V 1AA", src: "header" });
      const ev2 = win.dataLayer.find((e) => e.event === "header_address_submit");
      expect(ev2).toEqual({ event: "header_address_submit", method: "typed" });
    });

    it("sourcepath is the page title, the address is the trimmed field value", async () => {
      setup();
      document.title = "Short-let guide | Staymo";
      try {
        win.staymoValidateAddress = vi.fn(async () => true);
        input.value = "  1 Rose St  ";
        postal.value = "SW1V 1AA";
        $("#go").click();
        await vi.advanceTimersByTimeAsync(0);
        expect(assign).toHaveBeenCalledWith(
          "/start-hosting?address=1+Rose+St&postal-code=SW1V+1AA&sourcepath=Short-let+guide+%7C+Staymo&utm_source=x"
        );
      } finally {
        document.title = "";
      }
    });

    it("invalid → shows the error, no navigation, can retry", async () => {
      setup();
      win.staymoValidateAddress = vi.fn(async () => false);
      win.staymoShowAddrError = vi.fn();
      input.value = "nowhere";
      $("#go").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(win.staymoShowAddrError).toHaveBeenCalledWith(input);
      expect(assign).not.toHaveBeenCalled();
      $("#go").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(win.staymoValidateAddress).toHaveBeenCalledTimes(2);
    });

    it("Enter submits typed text after a short delay", async () => {
      setup();
      win.staymoValidateAddress = vi.fn(async () => true);
      input.value = "1 Rose St";
      postal.value = "SW1V 1AA";
      const ev = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
      input.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(win.staymoValidateAddress).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(300);
      expect(assign).toHaveBeenCalled();
      expect(win.dataLayer.find((e) => e.event === "header_address_submit").method).toBe("typed");
    });

    it("a dropdown pick submits at once at desktop width", async () => {
      setup();
      win.staymoValidateAddress = vi.fn(async () => true);
      input.value = "1 Rose St";
      postal.value = "SW1V 1AA";
      input.dataset.placeSelected = "1";
      await vi.advanceTimersByTimeAsync(0);
      expect(assign).toHaveBeenCalledTimes(1);
      expect(assign.mock.calls[0][0]).toMatch(/^\/start-hosting\?address=1\+Rose\+St&postal-code=SW1V\+1AA&/);
      expect(win.dataLayer.filter((e) => e.event === "header_address_submit")).toEqual([
        { event: "header_address_submit", method: "pick" },
      ]);
    });

    it("Enter on a highlighted suggestion submits once", async () => {
      setup();
      win.staymoValidateAddress = vi.fn(async () => true);
      input.focus();
      input.value = "1 Rose";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
      // Google then picks the highlighted suggestion.
      input.value = "1 Rose St, London";
      postal.value = "SW1V 1AA";
      input.dataset.placeSelected = "1";
      await vi.advanceTimersByTimeAsync(500);
      expect(assign).toHaveBeenCalledTimes(1);
      expect(win.dataLayer.filter((e) => e.event === "header_address_submit")).toHaveLength(1);
    });

    it("typed text without a pick waits for Enter / Get Started", async () => {
      setup();
      win.staymoValidateAddress = vi.fn(async () => true);
      input.value = "1 Rose St";
      postal.value = "SW1V 1AA";
      input.dispatchEvent(new Event("input"));
      await vi.advanceTimersByTimeAsync(500);
      expect(assign).not.toHaveBeenCalled();
    });
  });

  describe("storage", () => {
    it("prefills from a fresh entry and reports method=stored", async () => {
      const s = memStore({ staymo_address: JSON.stringify({ address: "1 Rose St", postal: "SW1V 1AA", ts: Date.now() - 1000 }) });
      setup({ storage: s });
      expect(input.value).toBe("1 Rose St");
      expect(postal.value).toBe("SW1V 1AA");
      expect(input.dataset.placeSelected).toBe("1");
      await vi.advanceTimersByTimeAsync(0);
      expect(assign).not.toHaveBeenCalled(); // prefill is not a pick
      win.staymoValidateAddress = vi.fn(async () => true);
      $("#go").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(win.dataLayer.find((e) => e.event === "header_address_submit").method).toBe("stored");
    });

    it("ignores a stale entry", () => {
      const s = memStore({ staymo_address: JSON.stringify({ address: "a", postal: "b", ts: Date.now() - 31 * 60 * 1000 }) });
      setup({ storage: s });
      expect(input.value).toBe("");
    });

    it("works when sessionStorage throws", () => {
      const bad = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
      expect(() => setup({ storage: bad })).not.toThrow();
    });

    it("hero click stores address/postcode/beds when the postcode is filled", () => {
      setup({ hero: true });
      const btn = $('[data-action="get-estimate"]');
      $("#hero [data-input-id=address-search]").value = "2 Elm Rd";
      btn.click();
      expect(store.data.staymo_address).toBeUndefined();
      $("#hero [data-input-id=postal-code-result]").value = "E14 9GP";
      $("#hero [data-input-id=beds-count]").value = "2";
      btn.click();
      expect(JSON.parse(store.data.staymo_address)).toMatchObject({ address: "2 Elm Rd", postal: "E14 9GP", beds: "2", src: "hero" });
    });

    it("header submit keeps stored beds for the same postcode", async () => {
      const s = memStore({ staymo_address: JSON.stringify({ address: "a", postal: "SW1V1AA", beds: "3", ts: Date.now() }) });
      setup({ storage: s });
      win.staymoValidateAddress = vi.fn(async () => true);
      input.value = "1 Rose St";
      postal.value = "SW1V 1AA";
      $("#go").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(JSON.parse(store.data.staymo_address).beds).toBe("3");
    });
  });

  describe("clear button", () => {
    const entry = () =>
      memStore({ staymo_address: JSON.stringify({ address: "1 Rose St", postal: "SW1V 1AA", ts: Date.now() - 1000 }) });

    it("empties the field, postcode and storage, refocuses and opens the menu", async () => {
      setup({ storage: entry(), clear: true });
      win.staymoClearAddrError = vi.fn();
      expect(input.value).toBe("1 Rose St");
      input.focus(); // already focused: no new focus event on clear
      expect(root.hasAttribute("data-menu")).toBe(false);
      $("[data-hdr-addr-clear]").click();
      expect(input.value).toBe("");
      expect(postal.value).toBe("");
      expect(input.dataset.placeSelected).toBeUndefined();
      expect(store.data.staymo_address).toBeUndefined();
      expect(win.staymoClearAddrError).toHaveBeenCalledWith(input);
      expect(document.activeElement).toBe(input);
      expect(root.dataset.menu).toBe("open");
      expect(win.dataLayer).toContainEqual({ event: "header_address_clear" });
      await vi.advanceTimersByTimeAsync(500);
      expect(assign).not.toHaveBeenCalled();
    });

    it("mousedown keeps focus in the field", () => {
      setup({ clear: true });
      const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      $("[data-hdr-addr-clear]").dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    });

    it("a later submit reports typed / pick, not stored", async () => {
      setup({ storage: entry(), clear: true });
      win.staymoValidateAddress = vi.fn(async () => true);
      $("[data-hdr-addr-clear]").click();
      input.value = "1 Rose St"; // same text as the old fill
      postal.value = "SW1V 1AA";
      $("#go").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(win.dataLayer.find((e) => e.event === "header_address_submit").method).toBe("typed");

      setup({ storage: entry(), clear: true });
      win.staymoValidateAddress = vi.fn(async () => true);
      $("[data-hdr-addr-clear]").click();
      input.value = "2 Elm Rd";
      postal.value = "E14 9GP";
      input.dataset.placeSelected = "1";
      $("#go").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(win.dataLayer.find((e) => e.event === "header_address_submit").method).toBe("pick");
    });

    it("a pick after clearing submits at once", async () => {
      setup({ storage: entry(), clear: true });
      win.staymoValidateAddress = vi.fn(async () => true);
      $("[data-hdr-addr-clear]").click();
      input.value = "2 Elm Rd";
      postal.value = "E14 9GP";
      input.dataset.placeSelected = "1";
      await vi.advanceTimersByTimeAsync(0);
      expect(assign).toHaveBeenCalledTimes(1);
      expect(win.dataLayer.find((e) => e.event === "header_address_submit").method).toBe("pick");
    });

    it("works with sessionStorage null or throwing", () => {
      setup({ storage: null, clear: true });
      input.value = "x";
      expect(() => $("[data-hdr-addr-clear]").click()).not.toThrow();
      expect(input.value).toBe("");
      const bad = { getItem: () => null, setItem: () => {}, removeItem: () => { throw new Error("x"); } };
      setup({ storage: bad, clear: true });
      input.value = "x";
      expect(() => $("[data-hdr-addr-clear]").click()).not.toThrow();
      expect(win.dataLayer).toContainEqual({ event: "header_address_clear" });
    });

    it("module works without the button", () => {
      setup({ storage: entry() });
      expect($("[data-hdr-addr-clear]")).toBe(null);
      expect(input.value).toBe("1 Rose St");
    });
  });

  describe("geolocation", () => {
    const gb = { short_name: "GB", types: ["country"] };
    function mapsWith(results, status = "OK") {
      const geocode = vi.fn((req, cb) => cb(results, status));
      return { geocode, maps: { Geocoder: function () { return { geocode }; } } };
    }
    function geoOk(accuracy = 10) {
      return { getCurrentPosition: vi.fn((ok) => ok({ coords: { latitude: 51.5, longitude: -0.1, accuracy } })) };
    }
    const results = [
      {
        formatted_address: "10 Rose St, London SW1V 1AA, UK",
        address_components: [{ long_name: "SW1V 1AA", types: ["postal_code"] }, { long_name: "London", types: ["postal_town"] }, gb],
      },
    ];

    it("fills the full address on a precise fix, waits for Maps, no navigation", async () => {
      const geo = geoOk(15);
      setup({ geo });
      const { geocode, maps } = mapsWith(results);
      input.focus();
      $("[data-hdr-addr-geo]").click();
      expect(root.dataset.geo).toBe("loading");
      expect(geo.getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
      await vi.advanceTimersByTimeAsync(300);
      expect(input.value).toBe("");
      win.google = { maps };
      await vi.advanceTimersByTimeAsync(200);
      expect(geocode.mock.calls[0][0]).toEqual({ location: { lat: 51.5, lng: -0.1 } });
      expect(input.value).toBe("10 Rose St, London SW1V 1AA");
      expect(postal.value).toBe("SW1V 1AA");
      expect(input.dataset.placeSelected).toBe("1");
      expect(root.hasAttribute("data-geo")).toBe(false);
      expect(assign).not.toHaveBeenCalled();
      expect(win.dataLayer).toContainEqual({ event: "header_address_geo", result: "ok" });
      win.staymoValidateAddress = vi.fn(async () => true);
      $("#go").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(win.dataLayer.find((e) => e.event === "header_address_submit").method).toBe("geo");
    });

    it("district only on a coarse fix", async () => {
      setup({ geo: geoOk(800) });
      win.google = mapsWith(results);
      $("[data-hdr-addr-geo]").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(input.value).toBe("SW1V, London");
      expect(postal.value).toBe("SW1V");
      expect(win.dataLayer).toContainEqual({ event: "header_address_geo", result: "imprecise" });
    });

    it.each([
      ["denied", { getCurrentPosition: (ok, err) => err({ code: 1 }) }, null, MSG_DENIED],
      ["unavailable", { getCurrentPosition: (ok, err) => err({ code: 3 }) }, null, MSG_UNAVAILABLE],
      ["outside_uk", geoOk(), [{ formatted_address: "Paris", address_components: [{ short_name: "FR", types: ["country"] }] }], MSG_OUTSIDE_UK],
      ["unavailable", geoOk(), [], MSG_UNAVAILABLE],
    ])("%s → message in the menu row", async (result, geo, res, msg) => {
      setup({ geo });
      win.staymoShowAddrError = vi.fn();
      if (res) win.google = mapsWith(res, res.length ? "OK" : "ZERO_RESULTS");
      input.focus();
      $("[data-hdr-addr-geo]").click();
      await vi.advanceTimersByTimeAsync(0);
      const label = $("[data-hdr-addr-geo-label]");
      expect(label.textContent).toBe(msg);
      expect(root.dataset.geo).toBe("error");
      expect(root.dataset.menu).toBe("open");
      expect(win.staymoShowAddrError).not.toHaveBeenCalled();
      expect(win.dataLayer).toContainEqual({ event: "header_address_geo", result });
      // typing closes the menu and brings the label back
      input.value = "1";
      input.dispatchEvent(new Event("input"));
      expect(root.hasAttribute("data-geo")).toBe(false);
      expect(label.textContent).toBe("Use my current location");
    });

    it("keeps the menu open while locating", async () => {
      setup({ geo: geoOk() });
      input.focus();
      $("[data-hdr-addr-geo]").click();
      expect(root.dataset.geo).toBe("loading");
      expect(root.dataset.menu).toBe("open");
    });

    it("without a label element the hint under the field takes the message", async () => {
      setup({ geo: { getCurrentPosition: (ok, err) => err({ code: 1 }) } });
      $("[data-hdr-addr-geo-label]").remove();
      win.staymoShowAddrError = vi.fn();
      // the module read the label at init; a fresh init sees none
      document.body.innerHTML = document.body.innerHTML;
      const api = initHeaderAddress(win, document);
      await api.useLocation();
      expect(win.staymoShowAddrError).toHaveBeenCalledWith(document.querySelector("[data-hdr-addr] [data-input-id=address-search]"), MSG_DENIED);
    });

    it("gives up when Maps never loads", async () => {
      setup({ geo: geoOk() });
      $("[data-hdr-addr-geo]").click();
      await vi.advanceTimersByTimeAsync(10500);
      expect($("[data-hdr-addr-geo-label]").textContent).toBe(MSG_UNAVAILABLE);
    });

    it("events carry no address or postcode", async () => {
      setup({ geo: geoOk() });
      win.google = mapsWith(results);
      $("[data-hdr-addr-geo]").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(JSON.stringify(win.dataLayer)).not.toMatch(/SW1V|Rose/);
    });
  });
});
