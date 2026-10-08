import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getURLParam,
  getCookie,
  buildCookie,
  prefillFromURL,
  injectReferrerFields,
  injectReferral,
  initReferrerAttribution,
  hasReferrerConsent,
  readStoredAddress,
} from "../src/prelead.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("getURLParam", () => {
  it("reads a param from an explicit search string, null when absent", () => {
    expect(getURLParam("beds", "?address=x&beds=2")).toBe("2");
    expect(getURLParam("nope", "?beds=2")).toBe(null);
  });
});

describe("getCookie", () => {
  it("reads a value from a cookie string, null when absent", () => {
    expect(getCookie("referral", "a=1; referral=spring; b=2")).toBe("spring");
    expect(getCookie("missing", "a=1")).toBe(null);
  });
});

describe("buildCookie", () => {
  it("formats name=value with path and SameSite", () => {
    const c = buildCookie("referral", "spring", 30);
    expect(c).toContain("referral=spring");
    expect(c).toContain("path=/");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("expires=");
  });
});

describe("prefillFromURL", () => {
  function formFixture() {
    document.body.innerHTML = `
      <form data-form-type="start-host">
        <input data-input-id="address-search">
        <input data-input-id="postal-code-result">
        <input data-input-id="beds-count">
      </form>
      <button start-start-button></button>`;
  }

  it("returns false when no start-host form", () => {
    expect(prefillFromURL(document, "?address=a&postal-code=p&beds=2")).toBe(false);
  });

  it("returns false when any param missing", () => {
    formFixture();
    expect(prefillFromURL(document, "?address=a&beds=2")).toBe(false);
    expect(document.querySelector('[data-input-id="address-search"]').value).toBe("");
  });

  it("fills inputs and clicks Start when all params present", () => {
    vi.useFakeTimers();
    formFixture();
    const btn = document.querySelector("[start-start-button]");
    const clicked = vi.fn();
    btn.addEventListener("click", clicked);
    const result = prefillFromURL(document, "?address=10+High+St&postal-code=SW1A1AA&beds=3");
    expect(result).toBe(true);
    expect(document.querySelector('[data-input-id="address-search"]').value).toBe("10 High St");
    expect(document.querySelector('[data-input-id="postal-code-result"]').value).toBe("SW1A1AA");
    expect(document.querySelector('[data-input-id="beds-count"]').value).toBe("3");
    vi.runAllTimers();
    expect(clicked).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

describe("prefillFromURL on the tile-based funnel", () => {
  // The live /start-hosting form has no [data-input-id="beds-count"]: bedrooms are
  // picked with [data-room] tiles backed by a hidden [data-rooms-input].
  function tileFormFixture() {
    document.body.innerHTML = `
      <form data-form-type="start-host">
        <input data-input-id="address-search">
        <input data-input-id="postal-code-result">
        <div data-rooms>
          <div data-room="0">Studio</div>
          <div data-room="1">1</div>
          <div data-room="2" class="is-bed-selected">2</div>
          <div data-room="3">3</div>
          <div data-room="4">4 +</div>
          <input type="hidden" data-rooms-input value="2">
        </div>
      </form>
      <button start-start-button></button>`;
  }

  it("selects the tile named by the URL and writes the hidden input", () => {
    vi.useFakeTimers();
    tileFormFixture();
    expect(prefillFromURL(document, "?address=a&postal-code=p&beds=3")).toBe(true);
    expect(document.querySelector('[data-room="3"]').classList.contains("is-bed-selected")).toBe(true);
    expect(document.querySelector('[data-room="2"]').classList.contains("is-bed-selected")).toBe(false);
    expect(document.querySelector("[data-rooms-input]").value).toBe("3");
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("selects the Studio tile for beds=0", () => {
    vi.useFakeTimers();
    tileFormFixture();
    prefillFromURL(document, "?address=a&postal-code=p&beds=0");
    expect(document.querySelector('[data-room="0"]').classList.contains("is-bed-selected")).toBe(true);
    expect(document.querySelector("[data-rooms-input]").value).toBe("0");
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("clamps a value above the last tile onto that tile", () => {
    vi.useFakeTimers();
    tileFormFixture();
    prefillFromURL(document, "?address=a&postal-code=p&beds=9");
    expect(document.querySelector('[data-room="4"]').classList.contains("is-bed-selected")).toBe(true);
    expect(document.querySelector("[data-rooms-input]").value).toBe("4");
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("leaves the preselected tile alone when beds is not a number", () => {
    vi.useFakeTimers();
    tileFormFixture();
    prefillFromURL(document, "?address=a&postal-code=p&beds=lots");
    expect(document.querySelector('[data-room="2"]').classList.contains("is-bed-selected")).toBe(true);
    expect(document.querySelector("[data-rooms-input]").value).toBe("2");
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("fires input/change on the hidden input so valuation.js sees the value", () => {
    vi.useFakeTimers();
    tileFormFixture();
    let changed = false;
    document.querySelector("[data-rooms-input]").addEventListener("change", () => (changed = true));
    prefillFromURL(document, "?address=a&postal-code=p&beds=1");
    expect(changed).toBe(true);
    vi.runAllTimers();
    vi.useRealTimers();
  });
});

describe("injectReferrerFields", () => {
  it("adds hidden inputs to every form when cookies present", () => {
    document.cookie = "referrer-name=Jane";
    document.cookie = "referrer-email=jane@x.io";
    document.body.innerHTML = `<form id="f1"></form><form id="f2"></form>`;
    injectReferrerFields(document, true);
    for (const id of ["f1", "f2"]) {
      const form = document.getElementById(id);
      expect(form.querySelector('input[name="referrer-name"]').value).toBe("Jane");
      expect(form.querySelector('input[name="referrer-email"]').value).toBe("jane@x.io");
    }
    // cleanup cookies
    document.cookie = "referrer-name=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    document.cookie = "referrer-email=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });
});

describe("injectReferral", () => {
  it("writes the referral cookie into #referral", () => {
    document.cookie = "referral=spring";
    document.body.innerHTML = `<input id="referral">`;
    injectReferral();
    expect(document.getElementById("referral").value).toBe("spring");
    document.cookie = "referral=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });
});

describe("referrer attribution under Cookiebot consent", () => {
  const search = "?referral-type=referred&referrer-name=Ann&referrer-email=ann%40x.com";
  function clearCookies() {
    for (const n of ["referrer-name", "referrer-email"]) {
      document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  }
  beforeEach(() => {
    clearCookies();
    delete window.Cookiebot;
    document.body.innerHTML = "<form></form>";
  });

  it("writes no cookie and no hidden fields without consent", () => {
    initReferrerAttribution(window, document, search);
    expect(getCookie("referrer-name")).toBe(null);
    expect(getCookie("referrer-email")).toBe(null);
    expect(document.querySelector('input[name^="referrer-"]')).toBe(null);
  });

  it("writes cookies and hidden fields once consent is accepted", () => {
    initReferrerAttribution(window, document, search);
    window.Cookiebot = { consent: { marketing: true } };
    window.dispatchEvent(new Event("CookiebotOnAccept"));
    expect(getCookie("referrer-name")).toBe("Ann");
    expect(document.querySelector('input[name="referrer-name"]').value).toBe("Ann");
    expect(document.querySelectorAll('input[name="referrer-email"]').length).toBe(1);
  });

  it("injects nothing even with stale cookies when consent is missing", () => {
    document.cookie = "referrer-name=Old";
    injectReferrerFields(document, hasReferrerConsent(window));
    expect(document.querySelector('input[name="referrer-name"]')).toBe(null);
  });
});

describe("prefillFromURL: address handoff without beds", () => {
  const NOW = 1_800_000_000_000;
  function memStore(entry) {
    const data = {};
    if (entry) data.staymo_address = JSON.stringify(entry);
    return {
      data,
      getItem: (k) => (k in data ? data[k] : null),
      setItem: (k, v) => (data[k] = String(v)),
      removeItem: (k) => delete data[k],
    };
  }
  function fixture() {
    document.body.innerHTML = `
      <form data-form-type="start-host">
        <input data-input-id="address-search">
        <input data-input-id="postal-code-result">
        <div data-rooms>
          <div data-room="1" tabindex="0">1</div>
          <div data-room="2" tabindex="0" class="is-bed-selected">2</div>
          <div data-room="3" tabindex="0">3</div>
          <input type="hidden" data-rooms-input value="2">
        </div>
        <button type="button" data-addr-change hidden>Change</button>
      </form>
      <button start-start-button></button>`;
  }
  const $ = (s) => document.querySelector(s);
  let clicked;
  beforeEach(() => {
    vi.useFakeTimers();
    fixture();
    clicked = vi.fn();
    $("[start-start-button]").addEventListener("click", clicked);
  });
  afterEach(() => {
    vi.runAllTimers();
    expect(clicked).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("postal-code only, no storage → the postcode doubles as the address", () => {
    expect(prefillFromURL(document, "?postal-code=SW1V+1AA", memStore(), NOW)).toBe(true);
    expect($('[data-input-id="address-search"]').value).toBe("SW1V 1AA");
    expect($('[data-input-id="postal-code-result"]').value).toBe("SW1V 1AA");
    expect($('[data-input-id="address-search"]').dataset.placeSelected).toBe("1");
    expect($("[data-addr-change]").hasAttribute("hidden")).toBe(false);
  });

  it("uses the stored address and beds when the stored postcode matches", () => {
    const store = memStore({ address: "1 Rose St, London", postal: "SW1V 1AA", beds: "3", ts: NOW - 1000 });
    prefillFromURL(document, "?postal-code=sw1v1aa&sourcepath=%2F", store, NOW);
    expect($('[data-input-id="address-search"]').value).toBe("1 Rose St, London");
    expect($('[data-room="3"]').classList.contains("is-bed-selected")).toBe(true);
    expect($("[data-rooms-input]").value).toBe("3");
    expect(document.activeElement).toBe($('[data-room="3"]'));
  });

  it("ignores a stored entry for another postcode", () => {
    const store = memStore({ address: "1 Rose St", postal: "E14 1AA", beds: "3", ts: NOW - 1000 });
    prefillFromURL(document, "?postal-code=SW1V+1AA", store, NOW);
    expect($('[data-input-id="address-search"]').value).toBe("SW1V 1AA");
    expect($("[data-rooms-input]").value).toBe("2");
  });

  it("prefers the URL address over storage", () => {
    const store = memStore({ address: "Stored", postal: "SW1V 1AA", ts: NOW - 1000 });
    prefillFromURL(document, "?postal-code=SW1V+1AA&address=From+URL", store, NOW);
    expect($('[data-input-id="address-search"]').value).toBe("From URL");
  });

  it("no params + fresh stored entry → the same prefill", () => {
    const store = memStore({ address: "1 Rose St", postal: "E14 1AA", ts: NOW - 1000 });
    expect(prefillFromURL(document, "", store, NOW)).toBe(true);
    expect($('[data-input-id="address-search"]').value).toBe("1 Rose St");
    expect($('[data-input-id="postal-code-result"]').value).toBe("E14 1AA");
    expect(document.activeElement).toBe($('[data-room="2"]'));
  });

  it("Change clears the fields and the stored address", () => {
    const store = memStore({ address: "1 Rose St", postal: "E14 1AA", ts: NOW - 1000 });
    prefillFromURL(document, "", store, NOW);
    $("[data-addr-change]").click();
    expect($('[data-input-id="address-search"]').value).toBe("");
    expect($('[data-input-id="postal-code-result"]').value).toBe("");
    expect(store.data.staymo_address).toBeUndefined();
  });

  it("no params + stale or broken storage → nothing", () => {
    expect(prefillFromURL(document, "", memStore({ address: "a", postal: "E14", ts: NOW - 31 * 60 * 1000 }), NOW)).toBe(false);
    const broken = { getItem: () => "{oops" };
    expect(prefillFromURL(document, "", broken, NOW)).toBe(false);
    const throwing = { getItem: () => { throw new Error("denied"); } };
    expect(prefillFromURL(document, "", throwing, NOW)).toBe(false);
    expect($('[data-input-id="address-search"]').value).toBe("");
    expect($("[data-addr-change]").hasAttribute("hidden")).toBe(true);
  });

  it("[data-addr-change] clears the address and focuses the field", () => {
    prefillFromURL(document, "?postal-code=SW1V+1AA", memStore(), NOW);
    $("[data-addr-change]").click();
    const input = $('[data-input-id="address-search"]');
    expect(input.value).toBe("");
    expect($('[data-input-id="postal-code-result"]').value).toBe("");
    expect(input.dataset.placeSelected).toBeUndefined();
    expect(document.activeElement).toBe(input);
  });

  it("does not focus a tile that isn't focusable", () => {
    $('[data-room="2"]').removeAttribute("tabindex");
    prefillFromURL(document, "?postal-code=SW1V+1AA", memStore(), NOW);
    expect(document.activeElement).not.toBe($('[data-room="2"]'));
  });
});

describe("readStoredAddress", () => {
  it("returns a fresh entry, null for stale/future/incomplete ones", () => {
    const at = (entry) => ({ getItem: () => JSON.stringify(entry) });
    expect(readStoredAddress(at({ address: "a", postal: "p", ts: 1000 }), 2000)).toMatchObject({ address: "a" });
    expect(readStoredAddress(at({ address: "a", postal: "p", ts: 0 }), 30 * 60 * 1000)).toBe(null);
    expect(readStoredAddress(at({ address: "a", postal: "p", ts: 5000 }), 2000)).toBe(null);
    expect(readStoredAddress(at({ address: "a", ts: 1000 }), 2000)).toBe(null);
    expect(readStoredAddress(null)).toBe(null);
  });
});
