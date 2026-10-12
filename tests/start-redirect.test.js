import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  passThroughParams,
  buildStartUrl,
  mainBeds,
  extractPostcode,
  initMainEstimate,
  initHeroForm,
  initStartRedirect,
} from "../src/start-redirect.js";

const ADS = "?utm_source=x&gclid=y&fbclid=z&msclkid=w&hsa_cam=1&foo=bar";
const ADS_TAIL = "&utm_source=x&gclid=y&fbclid=z&msclkid=w&hsa_cam=1";

// window stand-in: every location.href assignment is recorded, in order.
function fakeWin({ search = "", pathname = "/", valid = true } = {}) {
  const hrefs = [];
  const location = { search, pathname };
  Object.defineProperty(location, "href", { set: (v) => hrefs.push(v), get: () => hrefs.at(-1) || "" });
  return {
    hrefs,
    location,
    alert: vi.fn(),
    staymoValidateAddress: vi.fn(async () => valid),
    staymoShowAddrError: vi.fn(),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

function mainMarkup({ beds = '<input data-input-id="beds-count" value="2">', title = "Home | Staymo" } = {}) {
  return `
    <div data-form-type="main-estimate">
      <input data-input-id="address-search" value=" 10 Downing St, London ">
      <input data-input-id="postal-code-result" value=" SW1A 2AA ">
      ${beds}
      ${title === null ? "" : `<input data-input-id="page-title" value="${title}">`}
      <button data-action="get-estimate">Get Estimate</button>
    </div>`;
}

function heroMarkup({ address = "10 Downing St, London", postal = "SW1A 2AA", beds = "3", title = "Soho | Staymo" } = {}) {
  return `
    <form id="email-form-3">
      <input name="body" data-places-address data-input-id="address-search" value="${address}">
      <input name="postal-code" data-input-id="postal-code-result" value="${postal}">
      <input name="page_title" data-input-id="page-title" value="${title}">
      ${beds === null ? "" : `<input type="number" name="beds" data-input-id="beds-count" value="${beds}">`}
      <button data-action="get-estimate" id="step_continue-hero">Get Estimate</button>
      <button id="book-call-hero">Book a call</button>
    </form>`;
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.title = "";
});

describe("pure helpers", () => {
  it("passThroughParams keeps utm_*, hsa_*, gclid, fbclid, msclkid in order", () => {
    expect(passThroughParams(ADS)).toEqual([
      ["utm_source", "x"],
      ["gclid", "y"],
      ["fbclid", "z"],
      ["msclkid", "w"],
      ["hsa_cam", "1"],
    ]);
    expect(passThroughParams("?utm=1&gclid_x=2&address=a")).toEqual([]);
    expect(passThroughParams("")).toEqual([]);
    expect(passThroughParams(undefined)).toEqual([]);
  });

  it("buildStartUrl: address, postal-code, beds, sourcepath, then the ad params", () => {
    const base = { address: "1 A St", postal: "E1 6AN", beds: "2", sourcepath: "Home" };
    expect(buildStartUrl({ ...base, search: "" })).toBe(
      "/start-hosting?address=1+A+St&postal-code=E1+6AN&beds=2&sourcepath=Home"
    );
    expect(buildStartUrl({ ...base, search: ADS })).toBe(
      "/start-hosting?address=1+A+St&postal-code=E1+6AN&beds=2&sourcepath=Home" + ADS_TAIL
    );
  });

  it("mainBeds maps studio → 0, 5+ → 5, flags the placeholder", () => {
    expect(mainBeds("Studio")).toEqual({ beds: "0" });
    expect(mainBeds(" 5+ ")).toEqual({ beds: "5" });
    expect(mainBeds("3")).toEqual({ beds: "3" });
    expect(mainBeds("0")).toEqual({ beds: "0" });
    expect(mainBeds("Number of Beds")).toEqual({ placeholder: true });
    expect(mainBeds("")).toEqual({ beds: "" });
    expect(mainBeds(null)).toEqual({ beds: "" });
  });

  it("extractPostcode finds a full UK postcode and spaces it", () => {
    expect(extractPostcode("10 Downing St, sw1a2aa")).toBe("SW1A 2AA");
    expect(extractPostcode("Flat 2, E1 6AN, London")).toBe("E1 6AN");
    expect(extractPostcode("Soho, London")).toBe("");
    expect(extractPostcode("")).toBe("");
  });
});

describe("main estimate", () => {
  it("redirects with the fields, no ad params", async () => {
    document.body.innerHTML = mainMarkup();
    const win = fakeWin();
    expect(initMainEstimate(win, document)).toBe(1);
    click(document.querySelector("[data-action]"));
    await flush();
    expect(win.staymoValidateAddress).toHaveBeenCalledWith(document.querySelector('[data-input-id="address-search"]'));
    expect(win.hrefs).toEqual([
      "/start-hosting?address=10+Downing+St%2C+London&postal-code=SW1A+2AA&beds=2&sourcepath=Home+%7C+Staymo",
    ]);
  });

  it("carries the ad params and drops the rest", async () => {
    document.body.innerHTML = mainMarkup();
    const win = fakeWin({ search: ADS });
    initMainEstimate(win, document);
    click(document.querySelector("[data-action]"));
    await flush();
    expect(win.hrefs).toEqual([
      "/start-hosting?address=10+Downing+St%2C+London&postal-code=SW1A+2AA&beds=2&sourcepath=Home+%7C+Staymo" + ADS_TAIL,
    ]);
  });

  it("prevents the default action", () => {
    document.body.innerHTML = mainMarkup();
    initMainEstimate(fakeWin(), document);
    const e = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.querySelector("[data-action]").dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it.each([
    ['<input data-input-id="beds-count" value="studio">', "0"],
    ['<input data-input-id="beds-count" value="5+">', "5"],
    ['<div data-input-id="beds-count"> Studio </div>', "0"],
    ['<div data-input-id="beds-count">4</div>', "4"],
    ['<div data-input-id="beds-count" data-value="3"></div>', "3"],
  ])("beds %s → %s", async (beds, expected) => {
    document.body.innerHTML = mainMarkup({ beds });
    const win = fakeWin();
    initMainEstimate(win, document);
    click(document.querySelector("[data-action]"));
    await flush();
    expect(new URL(win.hrefs[0], "https://x").searchParams.get("beds")).toBe(expected);
  });

  it("no page-title field → empty sourcepath", async () => {
    document.body.innerHTML = mainMarkup({ title: null });
    document.title = "Ignored";
    const win = fakeWin();
    initMainEstimate(win, document);
    click(document.querySelector("[data-action]"));
    await flush();
    expect(win.hrefs[0]).toContain("&sourcepath=");
    expect(win.hrefs[0].endsWith("sourcepath=")).toBe(true);
  });

  it("placeholder beds → alert, no address check, no redirect", async () => {
    document.body.innerHTML = mainMarkup({ beds: '<div data-input-id="beds-count">Number of beds</div>' });
    const win = fakeWin();
    initMainEstimate(win, document);
    click(document.querySelector("[data-action]"));
    await flush();
    expect(win.alert).toHaveBeenCalledWith("Please select the number of bedrooms.");
    expect(win.staymoValidateAddress).not.toHaveBeenCalled();
    expect(win.hrefs).toEqual([]);
  });

  it("failed address → staymoShowAddrError, no redirect", async () => {
    document.body.innerHTML = mainMarkup();
    const win = fakeWin({ valid: false, search: ADS });
    initMainEstimate(win, document);
    click(document.querySelector("[data-action]"));
    await flush();
    expect(win.staymoShowAddrError).toHaveBeenCalledWith(document.querySelector('[data-input-id="address-search"]'));
    expect(win.alert).not.toHaveBeenCalled();
    expect(win.hrefs).toEqual([]);
  });

  it("empty beds → alert after the address check, no redirect", async () => {
    document.body.innerHTML = mainMarkup({ beds: '<div data-input-id="beds-count"></div>' });
    const win = fakeWin();
    initMainEstimate(win, document);
    click(document.querySelector("[data-action]"));
    await flush();
    expect(win.staymoValidateAddress).toHaveBeenCalled();
    expect(win.alert).toHaveBeenCalledWith("Please select the number of bedrooms.");
    expect(win.hrefs).toEqual([]);
  });

  it("reads the fields after the address check (it may rewrite them)", async () => {
    document.body.innerHTML = mainMarkup();
    const win = fakeWin();
    win.staymoValidateAddress = vi.fn(async (input) => {
      input.value = "10 Downing Street, London SW1A 2AA";
      document.querySelector('[data-input-id="postal-code-result"]').value = "SW1A 2AB";
      return true;
    });
    initMainEstimate(win, document);
    click(document.querySelector("[data-action]"));
    await flush();
    const p = new URL(win.hrefs[0], "https://x").searchParams;
    expect(p.get("address")).toBe("10 Downing Street, London SW1A 2AA");
    expect(p.get("postal-code")).toBe("SW1A 2AB");
  });

  it("skips an incomplete wrapper, binds each complete one to its own fields", async () => {
    document.body.innerHTML =
      '<div data-form-type="main-estimate"><button data-action="get-estimate"></button></div>' +
      mainMarkup() +
      mainMarkup({ title: "Second" }).replace('value="2"', 'value="4"');
    const win = fakeWin();
    expect(initMainEstimate(win, document)).toBe(2);
    click(document.querySelectorAll("[data-action]")[2]);
    await flush();
    const p = new URL(win.hrefs[0], "https://x").searchParams;
    expect(p.get("beds")).toBe("4");
    expect(p.get("sourcepath")).toBe("Second");
  });

  it("no wrappers → nothing bound", () => {
    expect(initMainEstimate(fakeWin(), document)).toBe(0);
  });
});

describe("standalone hero (#email-form-3)", () => {
  it("button click redirects with the fields, no ad params", () => {
    document.body.innerHTML = heroMarkup();
    const win = fakeWin();
    initHeroForm(win, document);
    click(document.querySelector("#step_continue-hero"));
    expect(win.hrefs).toEqual([
      "/start-hosting?address=10+Downing+St%2C+London&postal-code=SW1A+2AA&beds=3&sourcepath=Soho+%7C+Staymo",
    ]);
  });

  it("carries the ad params and drops the rest", () => {
    document.body.innerHTML = heroMarkup();
    const win = fakeWin({ search: ADS });
    initHeroForm(win, document);
    click(document.querySelector("#step_continue-hero"));
    expect(win.hrefs).toEqual([
      "/start-hosting?address=10+Downing+St%2C+London&postal-code=SW1A+2AA&beds=3&sourcepath=Soho+%7C+Staymo" + ADS_TAIL,
    ]);
  });

  it("the click is prevented and does not bubble", () => {
    document.body.innerHTML = heroMarkup();
    initHeroForm(fakeWin(), document);
    const onDoc = vi.fn();
    document.addEventListener("click", onDoc);
    const e = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.querySelector("#step_continue-hero").dispatchEvent(e);
    document.removeEventListener("click", onDoc);
    expect(e.defaultPrevented).toBe(true);
    expect(onDoc).not.toHaveBeenCalled();
  });

  it("binds the first matching button; another submit button goes through the form's submit", () => {
    document.body.innerHTML = heroMarkup();
    const win = fakeWin();
    const { button } = initHeroForm(win, document);
    expect(button.id).toBe("step_continue-hero");
    // As on the site today: "Book a call" is a plain <button> in the form, so it submits it.
    click(document.querySelector("#book-call-hero"));
    expect(win.hrefs).toHaveLength(1);
  });

  it("submit redirects too", () => {
    document.body.innerHTML = heroMarkup();
    const win = fakeWin({ search: "?gclid=g" });
    initHeroForm(win, document);
    const e = new Event("submit", { bubbles: true, cancelable: true });
    document.querySelector("form").dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(win.hrefs).toEqual([
      "/start-hosting?address=10+Downing+St%2C+London&postal-code=SW1A+2AA&beds=3&sourcepath=Soho+%7C+Staymo&gclid=g",
    ]);
  });

  it("beds default to 1; no beds field at all → 1", () => {
    document.body.innerHTML = heroMarkup({ beds: "" });
    let win = fakeWin();
    initHeroForm(win, document);
    click(document.querySelector("#step_continue-hero"));
    expect(new URL(win.hrefs[0], "https://x").searchParams.get("beds")).toBe("1");

    document.body.innerHTML = heroMarkup({ beds: null });
    win = fakeWin();
    initHeroForm(win, document);
    click(document.querySelector("#step_continue-hero"));
    expect(new URL(win.hrefs[0], "https://x").searchParams.get("beds")).toBe("1");
  });

  it("beds are passed as typed (no studio/5+ mapping on this path)", () => {
    document.body.innerHTML = heroMarkup({ beds: "0" });
    const win = fakeWin();
    initHeroForm(win, document);
    click(document.querySelector("#step_continue-hero"));
    expect(new URL(win.hrefs[0], "https://x").searchParams.get("beds")).toBe("0");
  });

  it("sourcepath falls back to document.title, then the pathname", () => {
    document.body.innerHTML = heroMarkup({ title: "" });
    document.title = "Blog | Staymo";
    let win = fakeWin({ pathname: "/blog" });
    initHeroForm(win, document);
    click(document.querySelector("#step_continue-hero"));
    expect(new URL(win.hrefs[0], "https://x").searchParams.get("sourcepath")).toBe("Blog | Staymo");

    document.body.innerHTML = heroMarkup({ title: "" });
    document.title = "";
    win = fakeWin({ pathname: "/blog" });
    initHeroForm(win, document);
    click(document.querySelector("#step_continue-hero"));
    expect(new URL(win.hrefs[0], "https://x").searchParams.get("sourcepath")).toBe("/blog");
  });

  it("no postcode field value → the postcode is taken from the address", () => {
    document.body.innerHTML = heroMarkup({ address: "1 Main St, e16an", postal: "" });
    const win = fakeWin();
    initHeroForm(win, document);
    click(document.querySelector("#step_continue-hero"));
    expect(new URL(win.hrefs[0], "https://x").searchParams.get("postal-code")).toBe("E1 6AN");
  });

  it("no address → is-error on the address, no redirect", () => {
    document.body.innerHTML = heroMarkup({ address: "  ", postal: "SW1A 2AA" });
    const win = fakeWin({ search: ADS });
    initHeroForm(win, document);
    click(document.querySelector("#step_continue-hero"));
    expect(document.querySelector('[name="body"]').classList.contains("is-error")).toBe(true);
    expect(win.hrefs).toEqual([]);
  });

  it("no postcode anywhere → is-error on the postcode, no redirect; typing clears it", () => {
    document.body.innerHTML = heroMarkup({ address: "Soho, London", postal: "" });
    const win = fakeWin();
    initHeroForm(win, document);
    click(document.querySelector("#step_continue-hero"));
    const postal = document.querySelector('[name="postal-code"]');
    expect(postal.classList.contains("is-error")).toBe(true);
    expect(document.querySelector('[name="body"]').classList.contains("is-error")).toBe(false);
    expect(win.hrefs).toEqual([]);
    postal.dispatchEvent(new Event("input"));
    expect(postal.classList.contains("is-error")).toBe(false);
  });

  it("a retry clears the old error before checking again", () => {
    document.body.innerHTML = heroMarkup({ address: "", postal: "" });
    const win = fakeWin();
    initHeroForm(win, document);
    const address = document.querySelector('[name="body"]');
    click(document.querySelector("#step_continue-hero"));
    expect(address.classList.contains("is-error")).toBe(true);
    address.value = "Soho";
    click(document.querySelector("#step_continue-hero"));
    expect(address.classList.contains("is-error")).toBe(false);
    expect(document.querySelector('[name="postal-code"]').classList.contains("is-error")).toBe(true);
  });

  it("no #email-form-3 → nothing bound", () => {
    expect(initHeroForm(fakeWin(), document)).toBe(null);
  });
});

describe("both bound (#email-form-3 inside a main-estimate wrapper, /airbnb-property-calculator)", () => {
  function calculator(beds = "2") {
    document.body.innerHTML = `
      <div data-form-type="main-estimate">
        <form id="email-form-3">
          <input name="body" data-input-id="address-search" value="10 Downing St, London">
          <input name="postal-code" data-input-id="postal-code-result" value="SW1A 2AA">
          <input name="page_title" data-input-id="page-title" value="">
          <input type="number" name="beds" data-input-id="beds-count" value="${beds}">
          <div data-action="get-estimate">Get Estimate</div>
        </form>
      </div>`;
    document.title = "Calculator | Staymo";
  }

  it("hero navigates at once, main after its address check — main's URL is the last one", async () => {
    calculator();
    const win = fakeWin({ search: ADS });
    initStartRedirect(win, document);
    click(document.querySelector("[data-action]"));
    expect(win.hrefs).toEqual([
      "/start-hosting?address=10+Downing+St%2C+London&postal-code=SW1A+2AA&beds=2&sourcepath=Calculator+%7C+Staymo" + ADS_TAIL,
    ]);
    await flush();
    expect(win.hrefs).toHaveLength(2);
    expect(win.hrefs[1]).toBe(
      "/start-hosting?address=10+Downing+St%2C+London&postal-code=SW1A+2AA&beds=2&sourcepath=" + ADS_TAIL
    );
  });

  it("main stops on a failed address → the hero's URL stands", async () => {
    calculator();
    const win = fakeWin({ valid: false });
    initStartRedirect(win, document);
    click(document.querySelector("[data-action]"));
    await flush();
    expect(win.staymoShowAddrError).toHaveBeenCalled();
    expect(win.hrefs).toEqual([
      "/start-hosting?address=10+Downing+St%2C+London&postal-code=SW1A+2AA&beds=2&sourcepath=Calculator+%7C+Staymo",
    ]);
  });
});
