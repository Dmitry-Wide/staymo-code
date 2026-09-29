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
  // google.maps.Geocoder stub: resolves { results } or rejects like ZERO_RESULTS.
  const stubGeocoder = (impl) => {
    const geocodeSpy = vi.fn(impl);
    vi.stubGlobal("google", {
      maps: { Geocoder: class { geocode(req) { return geocodeSpy(req); } } },
    });
    return geocodeSpy;
  };
  const stubGeocode = (postal) =>
    stubGeocoder(async () => {
      if (!postal) throw Object.assign(new Error("ZERO_RESULTS"), { code: "ZERO_RESULTS" });
      return { results: [{ address_components: [{ types: ["postal_code"], long_name: postal }] }] };
    });

  it("true for a dropdown pick, without any geocode call", async () => {
    const spy = stubGeocode("X");
    expect(await isRealAddress(mkAddr("anything", "1"), mkPostal())).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("true when a postcode is already filled, without geocode", async () => {
    const spy = stubGeocode("X");
    expect(await isRealAddress(mkAddr("25 Wilton Road"), mkPostal("SW1V 1LW"))).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("false for typed junk that does not geocode ('123123')", async () => {
    stubGeocode(null);
    expect(await isRealAddress(mkAddr("123123"), mkPostal())).toBe(false);
  });

  it("true for a valid typed address and fills the postcode input", async () => {
    const spy = stubGeocode("SW1V 1LW");
    const postal = mkPostal();
    expect(await isRealAddress(mkAddr("25 Wilton Road London"), postal)).toBe(true);
    expect(postal.value).toBe("SW1V 1LW");
    expect(spy).toHaveBeenCalledWith({
      address: "25 Wilton Road London",
      componentRestrictions: { country: "GB" },
    });
  });

  it("geocodes via the Maps JS Geocoder, never the REST web service", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    stubGeocode("SW1V 1LW");
    expect(await isRealAddress(mkAddr("25 Wilton Road London"), mkPostal())).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("false on a Geocoder failure (e.g. REQUEST_DENIED)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    stubGeocoder(async () => {
      throw Object.assign(new Error("REQUEST_DENIED"), { code: "REQUEST_DENIED" });
    });
    expect(await isRealAddress(mkAddr("25 Wilton Road London"), mkPostal())).toBe(false);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("false for empty input, without geocode", async () => {
    const spy = stubGeocode("X");
    expect(await isRealAddress(mkAddr("   "), mkPostal())).toBe(false);
    expect(spy).not.toHaveBeenCalled();
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

describe("lazy Maps loading", () => {
  const inputWith = (value) => {
    const i = document.createElement("input");
    i.value = value;
    return i;
  };
  const mapsScripts = () =>
    document.querySelectorAll('script[src*="maps.googleapis.com/maps/api/js"]').length;

  afterEach(() => {
    delete window.google;
  });

  it("no Maps script after DOMContentLoaded, one after focusing the address field", () => {
    document.body.innerHTML = `
      <form>
        <input id="other">
        <input data-input-id="address-search">
        <input data-input-id="postal-code-result">
      </form>`;
    window.dispatchEvent(new Event("DOMContentLoaded"));
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(mapsScripts()).toBe(0);

    document.getElementById("other").focus();
    expect(mapsScripts()).toBe(0);

    const addr = document.querySelector('[data-input-id="address-search"]');
    addr.focus();
    addr.blur();
    addr.focus();
    expect(mapsScripts()).toBe(1);

    // Maps callback attaches the already-focused field.
    const Autocomplete = vi.fn(function () {
      this.addListener = vi.fn();
    });
    window.google = { maps: { places: { Autocomplete } } };
    window.initAutocomplete();
    expect(addr.dataset.placesAttached).toBe("1");
    expect(Autocomplete).toHaveBeenCalledTimes(1);
  });

  // Engine may validate step 1 before the lazily loaded Maps is ready.
  it("isRealAddress waits for Maps to load, then geocodes", async () => {
    const pending = isRealAddress(inputWith("25 Wilton Road London"), inputWith(""));
    const geocode = vi.fn(async () => ({
      results: [{ address_components: [{ types: ["postal_code"], long_name: "SW1V 1LW" }] }],
    }));
    window.google = { maps: { Geocoder: class { geocode(r) { return geocode(r); } } } };
    window.initAutocomplete();
    expect(await pending).toBe(true);
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it("isRealAddress gives up (false) when Maps never loads", async () => {
    vi.useFakeTimers();
    try {
      const pending = isRealAddress(inputWith("25 Wilton Road London"), inputWith(""));
      await vi.advanceTimersByTimeAsync(10000);
      expect(await pending).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
