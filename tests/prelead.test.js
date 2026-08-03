import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getURLParam,
  getCookie,
  buildCookie,
  prefillFromURL,
  injectReferrerFields,
  injectReferral,
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
    injectReferrerFields();
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
