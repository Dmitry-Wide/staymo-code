import { describe, it, expect, beforeEach } from "vitest";
import {
  extractPostal,
  getNodeIndex,
  findNearestPostalInput,
} from "../src/autocomplete.js";

beforeEach(() => {
  document.body.innerHTML = "";
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
