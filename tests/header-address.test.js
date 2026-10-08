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

  it("buildStartUrl carries postcode, sourcepath and ad params, never the address", () => {
    const url = buildStartUrl("SW1V 1AA", "/guides/x", "?utm_source=g&address=1+Rose+St");
    expect(url).toBe("/start-hosting?postal-code=SW1V+1AA&sourcepath=%2Fguides%2Fx&utm_source=g");
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

describe("initHeaderAddress", () => {
  let store, win, input, postal, root, bar, assign;
  const $ = (s) => document.querySelector(s);

  function setup({ hero = false, storage = memStore(), mobile = false, geo } = {}) {
    document.body.innerHTML = `
      <div class="hdr" data-hdr-bar>
        <div data-hdr-addr data-form-type="header-address">
          <input data-input-id="address-search">
          <input type="hidden" data-input-id="postal-code-result">
          <div data-hdr-addr-menu><button data-hdr-addr-geo>Use my current location</button></div>
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
      matchMedia: () => ({ matches: mobile }),
      requestAnimationFrame: (cb) => cb(),
      MutationObserver: window.MutationObserver,
      addEventListener: (t, fn) => (listeners[t] = listeners[t] || []).push(fn),
      fire: (t) => (listeners[t] || []).forEach((fn) => fn(new Event(t))),
    };
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

  it("starts in nav and switches on scroll past the first screen (no hero)", () => {
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

  it("stays in addr while the field is focused", () => {
    setup();
    win.scrollY = 900;
    win.fire("scroll");
    input.focus();
    win.scrollY = 100;
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
      expect(assign).toHaveBeenCalledWith("/start-hosting?postal-code=SW1V+1AA&sourcepath=%2Fblog%2Fa&utm_source=x");
      expect(JSON.parse(store.data.staymo_address)).toMatchObject({ address: "1 Rose St", postal: "SW1V 1AA", src: "header" });
      const ev2 = win.dataLayer.find((e) => e.event === "header_address_submit");
      expect(ev2).toEqual({ event: "header_address_submit", method: "typed" });
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

    it("Enter submits after a short delay, as a pick when a place was selected", async () => {
      setup();
      win.staymoValidateAddress = vi.fn(async () => true);
      input.value = "1 Rose St";
      postal.value = "SW1V 1AA";
      const ev = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
      input.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      input.dataset.placeSelected = "1";
      await vi.advanceTimersByTimeAsync(100);
      expect(win.staymoValidateAddress).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(300);
      expect(assign).toHaveBeenCalled();
      expect(win.dataLayer.find((e) => e.event === "header_address_submit").method).toBe("pick");
    });

    it("on mobile a dropdown pick submits; on desktop it doesn't", async () => {
      setup({ mobile: true });
      win.staymoValidateAddress = vi.fn(async () => true);
      input.value = "1 Rose St";
      postal.value = "SW1V 1AA";
      input.dataset.placeSelected = "1";
      await vi.advanceTimersByTimeAsync(0);
      expect(assign).toHaveBeenCalledTimes(1);

      setup({ mobile: false });
      win.staymoValidateAddress = vi.fn(async () => true);
      input.value = "1 Rose St";
      postal.value = "SW1V 1AA";
      input.dataset.placeSelected = "1";
      await vi.advanceTimersByTimeAsync(0);
      expect(assign).not.toHaveBeenCalled();
    });
  });

  describe("storage", () => {
    it("prefills from a fresh entry and reports method=stored", async () => {
      const s = memStore({ staymo_address: JSON.stringify({ address: "1 Rose St", postal: "SW1V 1AA", ts: Date.now() - 1000 }) });
      setup({ storage: s, mobile: true });
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
      setup({ geo, mobile: true });
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
    ])("%s → message", async (result, geo, res, msg) => {
      setup({ geo });
      win.staymoShowAddrError = vi.fn();
      if (res) win.google = mapsWith(res, res.length ? "OK" : "ZERO_RESULTS");
      $("[data-hdr-addr-geo]").click();
      await vi.advanceTimersByTimeAsync(0);
      expect(win.staymoShowAddrError).toHaveBeenCalledWith(input, msg);
      expect(win.dataLayer).toContainEqual({ event: "header_address_geo", result });
      expect(root.hasAttribute("data-geo")).toBe(false);
    });

    it("gives up when Maps never loads", async () => {
      setup({ geo: geoOk() });
      win.staymoShowAddrError = vi.fn();
      $("[data-hdr-addr-geo]").click();
      await vi.advanceTimersByTimeAsync(10500);
      expect(win.staymoShowAddrError).toHaveBeenCalledWith(input, MSG_UNAVAILABLE);
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
