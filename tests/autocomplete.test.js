import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  extractPostal,
  getNodeIndex,
  findNearestPostalInput,
  isRealAddress,
  showAddrError,
  clearAddrError,
  ADDR_HINT,
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

  it("true for a dropdown pick with a postcode, without any geocode call", async () => {
    const spy = stubGeocode("X");
    expect(await isRealAddress(mkAddr("anything", "1"), mkPostal("SW1V 1LW"))).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a pick without a postcode looks it up via the Maps JS Geocoder, never REST", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const spy = stubGeocode("SW1V 1LW");
    const postal = mkPostal();
    expect(await isRealAddress(mkAddr("Wilton Road, London", "1"), postal)).toBe(true);
    expect(postal.value).toBe("SW1V 1LW");
    expect(spy).toHaveBeenCalledWith({
      address: "Wilton Road, London",
      componentRestrictions: { country: "GB" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("true when a postcode is prefilled (pick made on another page), without geocode", async () => {
    const spy = stubGeocode("X");
    expect(await isRealAddress(mkAddr("25 Wilton Road"), mkPostal("SW1V 1LW"))).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  // Geocoder result stub: { formatted_address, partial_match, address_components }.
  const stubResult = (result) =>
    stubGeocoder(async () => (result ? { results: [result] } : Promise.reject(
      Object.assign(new Error("ZERO_RESULTS"), { code: "ZERO_RESULTS" })
    )));
  const place = (postal, formatted, partial) => ({
    formatted_address: formatted,
    partial_match: partial,
    address_components: postal ? [{ types: ["postal_code"], long_name: postal }] : [],
  });

  it("typed address resolving to a full postcode passes; field shows Google's address", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const spy = stubResult(place("SW1V 1LW", "25 Wilton Rd, London SW1V 1LW, UK"));
    const addr = mkAddr("25 wilton road london");
    const postal = mkPostal();
    expect(await isRealAddress(addr, postal)).toBe(true);
    expect(postal.value).toBe("SW1V 1LW");
    expect(addr.value).toBe("25 Wilton Rd, London SW1V 1LW");
    expect(spy).toHaveBeenCalledWith({
      address: "25 wilton road london",
      componentRestrictions: { country: "GB" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a typed postcode passes", async () => {
    stubResult(place("SW1V 1LW", "London SW1V 1LW, UK"));
    const postal = mkPostal();
    expect(await isRealAddress(mkAddr("sw1v1lw"), postal)).toBe(true);
    expect(postal.value).toBe("SW1V 1LW");
  });

  it("a partial match (Google only guessed) is rejected with the hint", async () => {
    stubResult(place("SW1V 1LW", "Wilton Rd, London SW1V 1LW, UK", true));
    document.body.innerHTML = "<div><input></div>";
    const addr = document.querySelector("input");
    addr.value = "wilten rood";
    const postal = mkPostal();
    expect(await isRealAddress(addr, postal)).toBe(false);
    expect(postal.value).toBe("");
    expect(addr.value).toBe("wilten rood");
    expect(addr.nextElementSibling.textContent).toBe(ADDR_HINT);
  });

  it("a street or district with only an outward code (e.g. 'E14') passes", async () => {
    stubResult(place("E14", "Canary Wharf, London E14, UK"));
    const postal = mkPostal();
    expect(await isRealAddress(mkAddr("canary wharf"), postal)).toBe(true);
    expect(postal.value).toBe("E14");
  });

  it("a place with no postcode at all (e.g. 'London') is rejected", async () => {
    stubResult(place("", "London, UK"));
    expect(await isRealAddress(mkAddr("london"), mkPostal())).toBe(false);
  });

  it("a pick Google has no postcode for shows the hint instead of passing silently", async () => {
    stubResult(place("", "London, UK"));
    document.body.innerHTML = "<div><input></div>";
    const addr = document.querySelector("input");
    addr.value = "London, UK";
    addr.dataset.placeSelected = "1";
    const postal = mkPostal();
    expect(await isRealAddress(addr, postal)).toBe(false);
    expect(addr.nextElementSibling.textContent).toBe(ADDR_HINT);
  });

  it("a street pick gets the street's outward postcode and passes", async () => {
    stubResult(place("NW1", "Baker St, London NW1, UK"));
    const postal = mkPostal();
    expect(await isRealAddress(mkAddr("Baker Street, London, UK", "1"), postal)).toBe(true);
    expect(postal.value).toBe("NW1");
  });

  it("junk that does not geocode is rejected and shows the hint", async () => {
    stubResult(null);
    document.body.innerHTML = "<div><input><button>Next</button></div>";
    const addr = document.querySelector("input");
    addr.value = "123123";
    expect(await isRealAddress(addr, mkPostal())).toBe(false);
    const hint = addr.nextElementSibling;
    expect(hint.className).toBe("staymo-addr-error");
    expect(hint.textContent).toBe(ADDR_HINT);
    expect(hint.getAttribute("role")).toBe("alert");
    expect(addr.classList.contains("is-error")).toBe(true);
  });

  it("false for empty input, without geocode", async () => {
    const spy = stubGeocode("X");
    expect(await isRealAddress(mkAddr("   "), mkPostal())).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a later pick clears the hint", async () => {
    stubResult(null);
    document.body.innerHTML = "<div><input></div>";
    const addr = document.querySelector("input");
    addr.value = "typed";
    expect(await isRealAddress(addr, mkPostal())).toBe(false);
    addr.dataset.placeSelected = "1";
    expect(await isRealAddress(addr, mkPostal("SW1V 1LW"))).toBe(true);
    expect(document.querySelector(".staymo-addr-error")).toBe(null);
    expect(addr.classList.contains("is-error")).toBe(false);
  });
});

describe("showAddrError / clearAddrError", () => {
  it("puts one hint right after the input, even if the input's class mentions 'input'", () => {
    document.body.innerHTML = '<div class="hero__input__col"><input class="hero__form__input"></div>';
    const addr = document.querySelector("input");
    showAddrError(addr);
    showAddrError(addr);
    const hints = document.querySelectorAll(".staymo-addr-error");
    expect(hints.length).toBe(1);
    expect(addr.nextElementSibling).toBe(hints[0]);
    expect(addr.children.length).toBe(0);
    clearAddrError(addr);
    expect(document.querySelector(".staymo-addr-error")).toBe(null);
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

  // A pick can come before the lazily loaded Maps is ready for the Geocoder.
  it("a pick without a postcode waits for Maps to load, then geocodes", async () => {
    const addr = inputWith("Wilton Road, London");
    addr.dataset.placeSelected = "1";
    const postal = inputWith("");
    const pending = isRealAddress(addr, postal);
    const geocode = vi.fn(async () => ({
      results: [{ address_components: [{ types: ["postal_code"], long_name: "SW1V 1LW" }] }],
    }));
    window.google = { maps: { Geocoder: class { geocode(r) { return geocode(r); } } } };
    window.initAutocomplete();
    expect(await pending).toBe(true);
    expect(postal.value).toBe("SW1V 1LW");
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it("a pick without a postcode is refused when Maps never loads (no postcode to estimate)", async () => {
    vi.useFakeTimers();
    try {
      const addr = inputWith("Wilton Road, London");
      addr.dataset.placeSelected = "1";
      const postal = inputWith("");
      const pending = isRealAddress(addr, postal);
      await vi.advanceTimersByTimeAsync(10000);
      expect(await pending).toBe(false);
      expect(postal.value).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});
