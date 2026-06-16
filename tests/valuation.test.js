import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  splitFullName,
  buildRequestBody,
  isValidEstimate,
  getBedsValue,
  applyOutputs,
  initValuation,
} from "../src/valuation.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("splitFullName", () => {
  it("splits first and last", () => {
    expect(splitFullName("John Smith")).toEqual({ firstName: "John", lastName: "Smith" });
  });
  it("collapses extra spaces and keeps multi-word last name", () => {
    expect(splitFullName("  Anna  De Vries ")).toEqual({ firstName: "Anna", lastName: "De Vries" });
  });
  it("handles empty", () => {
    expect(splitFullName("")).toEqual({ firstName: "", lastName: "" });
  });
});

describe("buildRequestBody", () => {
  it("encodes core fields + UTM", () => {
    const body = buildRequestBody({
      fullAddress: "75 Marsh Wall",
      postcode: "E14 9GH",
      beds: "2",
      utm: { utm_source: "google" },
    });
    expect(body).toContain("Full_Address=75%20Marsh%20Wall");
    expect(body).toContain("postcode=E14%209GH");
    expect(body).toContain("Bedrooms-4=2");
    expect(body).toContain("utm_source=google");
  });
  it("falls back to postcode when address is empty", () => {
    const body = buildRequestBody({ fullAddress: "", postcode: "E14", beds: "1", utm: {} });
    expect(body).toContain("Full_Address=E14");
  });
});

describe("isValidEstimate", () => {
  it("true for non-zero min + max", () => {
    expect(isValidEstimate({ minimum: "1000", maximum: "5000" })).toBe(true);
  });
  it("false when minimum is 0/empty/null", () => {
    expect(isValidEstimate({ minimum: "0", maximum: "5000" })).toBe(false);
    expect(isValidEstimate({ minimum: "", maximum: "5000" })).toBe(false);
    expect(isValidEstimate({ maximum: "5000" })).toBe(false);
  });
  it("false when maximum is empty", () => {
    expect(isValidEstimate({ minimum: "1000", maximum: "" })).toBe(false);
  });
});

function outputsFixture() {
  document.body.innerHTML = `
    <div data_section="main_form"></div>
    <span data-output="minimum-value"></span>
    <span data-output="maximum-value"></span>
    <span data-output="occupancy-value"></span>
    <span data-output="annual-revenue"></span>
    <span data-output="delta-annual"></span>
    <span data-output="monthly-value"></span>
    <span data-output="nightly-value"></span>
    <span data-output="address"></span>
    <input form_data="estimation">
    <input data-process="postcode"><input data-process="property_bedrooms">
    <input data-process="property_address"><input data-process="sourcepath">`;
}

describe("getBedsValue", () => {
  it("prefers data-rooms-input attribute", () => {
    const el = document.createElement("div");
    el.setAttribute("data-rooms-input", "3");
    expect(getBedsValue(el)).toBe("3");
  });
});

describe("applyOutputs", () => {
  it("writes outputs + estimation + lead fields for a valid response", () => {
    outputsFixture();
    applyOutputs(document, {
      response: { minimum: "1000", maximum: "5000", annual: "36000", occupancy: "88", show_address: "E14", ll_annual: "14600" },
      fullAddress: "75 Marsh Wall",
      postcode: "E14",
      beds: "2",
      leadstart: "ppc",
    });
    expect(document.querySelector('[data-output="minimum-value"]').textContent).toBe("£1,000");
    expect(document.querySelector('[data-output="occupancy-value"]').textContent).toBe("88%");
    expect(document.querySelector('[data-output="annual-revenue"]').textContent).toBe("£36,000");
    expect(document.querySelector('[data-output="delta-annual"]').textContent).toBe("+£21,400");
    expect(document.querySelector('[data-output="monthly-value"]').textContent).toBe("£3,000");
    expect(document.querySelector('[data-output="nightly-value"]').textContent).toBe("£114");
    expect(document.querySelector('[form_data="estimation"]').value).toBe("£1000 - £5000");
    expect(document.querySelector('[data-process="property_bedrooms"]').value).toBe("2");
  });

  it("writes the address to every data-output=address element (loading/noresults/result)", () => {
    document.body.innerHTML = `
      <div start-loading><span data-output="address"></span></div>
      <div start-noresults><span data-output="address"></span></div>
      <div start-result><span data-output="address"></span></div>`;
    applyOutputs(document, {
      response: { minimum: "1000", maximum: "5000", show_address: "12 King St" },
      fullAddress: "12 King St typed",
      postcode: "E1",
      beds: "2",
    });
    const all = document.querySelectorAll('[data-output="address"]');
    expect(all).toHaveLength(3);
    all.forEach((el) => expect(el.textContent).toBe("12 King St"));
  });
});

describe("initValuation", () => {
  it("POSTs and writes outputs on a valid response", async () => {
    outputsFixture();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div data-input-id="address-search" data-value="75 Marsh Wall"></div>
       <div data-input-id="postal-code-result" data-value="E14"></div>
       <div data-rooms-input="2"></div>
       <button aria-label="Start Estimate">Go</button>
       <div data-display="result" style="display:none"></div>`
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ minimum: "1000", maximum: "5000", annual: "36000", occupancy: "88" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    initValuation();
    document.querySelector('[aria-label="Start Estimate"]').dispatchEvent(new Event("click", { bubbles: true }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(document.querySelector('[data-output="minimum-value"]').textContent).toBe("£1,000")
    );
  });

  it("shows noresults when postcode/beds missing", async () => {
    outputsFixture();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div data-display="noresults" style="display:none"></div>
       <button aria-label="Start Estimate">Go</button>`
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    initValuation();
    document.querySelector('[aria-label="Start Estimate"]').dispatchEvent(new Event("click", { bubbles: true }));
    await vi.waitFor(() =>
      expect(document.querySelector('[data-display="noresults"]').style.display).toBe("block")
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fills the noresults address with the typed address when postcode is missing", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div start-noresults data-display="noresults" style="display:none"><span data-output="address"></span></div>
       <div data-input-id="address-search" data-value="10 Downing St"></div>
       <button aria-label="Start Estimate">Go</button>`
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    initValuation();
    document.querySelector('[aria-label="Start Estimate"]').dispatchEvent(new Event("click", { bubbles: true }));
    await vi.waitFor(() =>
      expect(document.querySelector('[start-noresults] [data-output="address"]').textContent).toBe("10 Downing St")
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
