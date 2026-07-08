import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  extractPostal,
  getNodeIndex,
  findNearestPostalInput,
  isRealAddress,
} from "../src/autocomplete.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("isRealAddress", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const mkAddr = (value, placeSelected) => {
    const a = document.createElement("input");
    a.value = value;
    if (placeSelected) a.dataset.placeSelected = placeSelected;
    return a;
  };
  const mkPostal = (value) => {
    const p = document.createElement("input");
    if (value) p.value = value;
    return p;
  };
  const stubGeocode = (postal) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () =>
        postal
          ? { status: "OK", results: [{ address_components: [{ types: ["postal_code"], long_name: postal }] }] }
          : { status: "ZERO_RESULTS", results: [] },
    })));

  it("true for a dropdown pick, without any geocode call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await isRealAddress(mkAddr("anything", "1"), mkPostal())).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("true when a postcode is already filled, without geocode", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await isRealAddress(mkAddr("25 Wilton Road"), mkPostal("SW1V 1LW"))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("false for typed junk that does not geocode ('123123')", async () => {
    stubGeocode(null);
    expect(await isRealAddress(mkAddr("123123"), mkPostal())).toBe(false);
  });

  it("true for a valid typed address and fills the postcode input", async () => {
    stubGeocode("SW1V 1LW");
    const postal = mkPostal();
    expect(await isRealAddress(mkAddr("25 Wilton Road London"), postal)).toBe(true);
    expect(postal.value).toBe("SW1V 1LW");
  });

  it("false for empty input, without geocode", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await isRealAddress(mkAddr("   "), mkPostal())).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("extractPostal", () => {
  it("returns the postal_code long_name, '' when absent", () => {
    const comps = [
      { types: ["locality"], long_name: "London" },
      { types: ["postal_code"], long_name: "SW1A 1AA" },
    ];
    expect(extractPostal(comps)).toBe("SW1A 1AA");
    expect(extractPostal([{ types: ["locality"], long_name: "London" }])).toBe("");
    expect(extractPostal(null)).toBe("");
    expect(extractPostal(undefined)).toBe("");
  });
});

describe("getNodeIndex", () => {
  it("orders elements by document position", () => {
    document.body.innerHTML = `<div id="a"></div><div id="b"></div>`;
    const a = document.getElementById("a");
    const b = document.getElementById("b");
    expect(getNodeIndex(a)).toBeLessThan(getNodeIndex(b));
  });
});

describe("findNearestPostalInput", () => {
  it("returns the postal input inside the same form", () => {
    document.body.innerHTML = `
      <form>
        <input data-input-id="address-search">
        <input data-input-id="postal-code-result" value="own">
      </form>
      <form>
        <input data-input-id="postal-code-result" value="other">
      </form>`;
    const addr = document.querySelector('[data-input-id="address-search"]');
    expect(findNearestPostalInput(addr).value).toBe("own");
  });

  it("returns the single postal input when no shared container", () => {
    document.body.innerHTML = `
      <div><input data-input-id="address-search"></div>
      <div><input data-input-id="postal-code-result" value="solo"></div>`;
    const addr = document.querySelector('[data-input-id="address-search"]');
    expect(findNearestPostalInput(addr).value).toBe("solo");
  });

  it("returns null when no postal input exists", () => {
    document.body.innerHTML = `<input data-input-id="address-search">`;
    const addr = document.querySelector('[data-input-id="address-search"]');
    expect(findNearestPostalInput(addr)).toBe(null);
  });

  it("picks the DOM-closest postal when several exist with no shared container", () => {
    // addr wrapped in a container that holds no postal → distance fallback runs.
    document.body.innerHTML = `
      <input data-input-id="postal-code-result" value="far">
      <span></span><span></span>
      <div><input data-input-id="address-search"></div>
      <input data-input-id="postal-code-result" value="near">`;
    const addr = document.querySelector('[data-input-id="address-search"]');
    expect(findNearestPostalInput(addr).value).toBe("near");
  });
});
