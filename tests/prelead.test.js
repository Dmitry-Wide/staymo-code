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
