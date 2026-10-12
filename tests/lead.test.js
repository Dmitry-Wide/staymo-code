import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initLead,
  splitName,
  buildPayload,
  readDomEstimate,
  HS_ENDPOINT,
  RESULT_HOLD_CAP,
} from "../src/lead.js";

const RANGE = "£2,483 - £4,034";

let destroy;
let fetchMock;
let form;

function fixture({ beds = "", rooms = "3", name = "  Anna   De  Vries ", email = "anna@example.com", phone = "07700 900123", formPhone = "+447700900123", postcode = "E14 9GH" } = {}) {
  document.title = "Start hosting | Staymo";
  document.body.innerHTML = `
    <input data-input-id="address-search" value="75 Marsh Wall, London">
    <input data-input-id="postal-code-result" value="${postcode}">
    <input data-input-id="beds-count" value="${beds}">
    <input data-rooms-input value="${rooms}">
    <input data-input="full-name" value="${name}">
    <input data-input="email" value="${email}">
    <input data-input="phone" value="${phone}">
    <button start-ready-button>Get my estimate</button>
    <div start-result><span data-output="estimate-range">Calculating…</span>
      <button start-restart>Start again</button>
      <button data-lead-retry>Retry</button>
    </div>
    <form id="wf-form-start-hosting-copy">
      <input type="hidden" name="phone" value="${formPhone}">
      <input type="hidden" name="firstname">
      <input type="hidden" name="lastname">
      <input type="hidden" name="property_address">
      <input type="hidden" name="zip">
      <input type="hidden" name="property_bedrooms">
      <input type="hidden" name="Lead Start">
      <input type="hidden" name="rental_estimation">
    </form>`;
  form = document.querySelector("form");
  form.requestSubmit = vi.fn();
}

const res = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const click = (sel) => document.querySelector(sel).click();
const estimateReady = (detail = { estimateRange: RANGE }) => {
  document.querySelector('[data-output="estimate-range"]').textContent = detail.estimateRange || RANGE;
  window.dispatchEvent(new CustomEvent("staymo:estimate-ready", { detail }));
};
const flush = () => vi.advanceTimersByTimeAsync(0);
const sentFields = (i = 0) =>
  Object.fromEntries(JSON.parse(fetchMock.mock.calls[i][1].body).fields.map((f) => [f.name, f.value]));
const sentBody = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body);
const state = () => document.documentElement.getAttribute("data-lead-state");

beforeEach(() => {
  vi.useFakeTimers();
  delete window.estGoTo;
  delete window.Cookiebot;
  document.cookie = "hubspotutk=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  document.documentElement.removeAttribute("data-lead-state");
  fetchMock = vi.fn(async () => res(200));
  vi.stubGlobal("fetch", fetchMock);
  fixture();
});

afterEach(() => {
  if (destroy) destroy();
  destroy = null;
  delete window.estGoTo;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("helpers", () => {
  it("splitName: first word / rest, whitespace collapsed", () => {
    expect(splitName("  Anna   De  Vries ")).toEqual({ firstname: "Anna", lastname: "De Vries" });
    expect(splitName("Cher")).toEqual({ firstname: "Cher", lastname: "" });
  });

  it("buildPayload omits empty fields and hutk unless given", () => {
    const p = buildPayload({ email: "a@b.c", lastname: "", zip: undefined }, { pageUri: "u", pageName: "n" });
    expect(p.fields).toEqual([{ objectTypeId: "0-1", name: "email", value: "a@b.c" }]);
    expect(p.context).toEqual({ pageUri: "u", pageName: "n" });
  });

  it("readDomEstimate ignores Calculating placeholders", () => {
    const el = document.querySelector('[data-output="estimate-range"]');
    expect(readDomEstimate()).toBe("");
    el.textContent = "Calculating...";
    expect(readDomEstimate()).toBe("");
    el.textContent = RANGE;
    expect(readDomEstimate()).toBe(RANGE);
  });
});

describe("init", () => {
  it("marks the Webflow form do-not-collect", () => {
    destroy = initLead();
    expect(form.getAttribute("data-hs-do-not-collect")).toBe("true");
  });
});

describe("payload", () => {
  it("sends every field with the right names and values (bedrooms fallback, form phone)", async () => {
    destroy = initLead();
    click("[start-ready-button]");
    estimateReady();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(HS_ENDPOINT);
    expect(opts.method).toBe("POST");
    expect(opts.keepalive).toBe(true);
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(sentFields()).toEqual({
      email: "anna@example.com",
      full_name: "Anna De Vries",
      firstname: "Anna",
      lastname: "De Vries",
      phone: "+447700900123",
      lead_start: "Start hosting | Staymo",
      rental_estimation: RANGE,
      property_address: "75 Marsh Wall, London",
      property_bedrooms: "3",
      zip: "E14 9GH",
    });
    expect(sentBody().fields.every((f) => f.objectTypeId === "0-1")).toBe(true);
    expect(sentBody().context).toEqual({ pageUri: window.location.href, pageName: "Start hosting | Staymo" });
  });

  it("prefers beds-count, falls back to the contact phone, omits empty fields", async () => {
    fixture({ beds: "2", name: "Cher", formPhone: "", postcode: "" });
    destroy = initLead();
    click("[start-ready-button]");
    estimateReady();
    await flush();

    const f = sentFields();
    expect(f.property_bedrooms).toBe("2");
    expect(f.phone).toBe("07700 900123");
    expect(f.firstname).toBe("Cher");
    expect("lastname" in f).toBe(false);
    expect("zip" in f).toBe(false);
    expect(sentBody().fields.some((x) => x.value === "")).toBe(false);
  });

  it("values are read at send time", async () => {
    destroy = initLead();
    click("[start-ready-button]");
    document.querySelector('[data-input="email"]').value = "late@example.com";
    estimateReady();
    await flush();
    expect(sentFields().email).toBe("late@example.com");
  });

  it("uses the DOM estimate when the event carries none", async () => {
    destroy = initLead();
    click("[start-ready-button]");
    document.querySelector('[data-output="estimate-range"]').textContent = "£1,000 - £2,000";
    window.dispatchEvent(new CustomEvent("staymo:estimate-ready", { detail: {} }));
    await flush();
    expect(sentFields().rental_estimation).toBe("£1,000 - £2,000");
  });
});

describe("consent / hutk", () => {
  async function run() {
    destroy = initLead();
    click("[start-ready-button]");
    estimateReady();
    await flush();
    return sentBody().context;
  }

  it("no hutk without Statistics consent, even with the cookie", async () => {
    document.cookie = "hubspotutk=abc123; path=/";
    window.Cookiebot = { consent: { statistics: false } };
    expect("hutk" in (await run())).toBe(false);
  });

  it("hutk with Statistics consent and the cookie", async () => {
    document.cookie = "hubspotutk=abc123; path=/";
    window.Cookiebot = { consent: { statistics: true } };
    expect((await run()).hutk).toBe("abc123");
  });

  it("no hutk with consent but no cookie; the submission still goes", async () => {
    window.Cookiebot = { consent: { statistics: true } };
    expect("hutk" in (await run())).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("when to send", () => {
  it("never before the estimate is known", async () => {
    destroy = initLead();
    click("[start-ready-button]");
    await vi.advanceTimersByTimeAsync(20000);
    window.dispatchEvent(new CustomEvent("staymo:estimate-ready", { detail: {} })); // DOM still Calculating…
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state()).toBe(null);
  });

  it("not without a valid contact click", async () => {
    fixture({ email: "nope" });
    destroy = initLead();
    click("[start-ready-button]");
    estimateReady();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("not on an estimate without a ready click", async () => {
    destroy = initLead();
    estimateReady();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exactly once for double clicks and repeated estimate events", async () => {
    destroy = initLead();
    click("[start-ready-button]");
    click("[start-ready-button]");
    estimateReady();
    estimateReady();
    click("[start-ready-button]");
    estimateReady();
    await vi.advanceTimersByTimeAsync(2000);
    window.estGoTo = vi.fn();
    window.estGoTo("result");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(form.requestSubmit).toHaveBeenCalledTimes(1);
  });

  it("a new enquiry after [start-restart] sends again", async () => {
    destroy = initLead();
    click("[start-ready-button]");
    estimateReady();
    await flush();
    expect(state()).toBe("sent");

    click("[start-restart]");
    expect(state()).toBe(null);
    estimateReady(); // stale event before a new ready click
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    document.querySelector('[data-input="email"]').value = "second@example.com";
    click("[start-ready-button]");
    estimateReady({ estimateRange: "£3,000 - £5,000" });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentFields(1)).toMatchObject({ email: "second@example.com", rental_estimation: "£3,000 - £5,000" });
    expect(form.requestSubmit).toHaveBeenCalledTimes(2);
  });
});

describe("retries and outcome", () => {
  it("retries 5xx / 429 / network errors with backoff, then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(res(503))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(res(429))
      .mockResolvedValueOnce(res(200));
    const sent = vi.fn();
    window.addEventListener("staymo:lead-sent", sent);
    destroy = initLead();
    click("[start-ready-button]");
    estimateReady();
    await flush();
    expect(state()).toBe("sending");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(form.requestSubmit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(state()).toBe("sent");
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0][0].detail.status).toBe(200);
    expect(form.requestSubmit).toHaveBeenCalledTimes(1);
    window.removeEventListener("staymo:lead-sent", sent);
  });

  it("fails after 3 retries; the Webflow record is still submitted", async () => {
    fetchMock.mockResolvedValue(res(500));
    vi.spyOn(console, "error").mockImplementation(() => {});
    destroy = initLead();
    click("[start-ready-button]");
    estimateReady();
    await vi.advanceTimersByTimeAsync(7000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(state()).toBe("failed");
    expect(form.requestSubmit).toHaveBeenCalledTimes(1);
  });

  it("no retry on 400: failed state, event with errors, errors logged", async () => {
    const errors = [{ message: "Invalid email", errorType: "INVALID_EMAIL" }];
    fetchMock.mockResolvedValue(res(400, { status: "error", errors }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = vi.fn();
    window.addEventListener("staymo:lead-failed", failed);
    destroy = initLead();
    click("[start-ready-button]");
    estimateReady();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state()).toBe("failed");
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0][0].detail).toEqual({ status: 400, errors });
    expect(err.mock.calls.some((c) => c.includes(errors))).toBe(true);
    expect(form.requestSubmit).toHaveBeenCalledTimes(1);
    window.removeEventListener("staymo:lead-failed", failed);
  });

  it("[data-lead-retry] re-sends a failed submission without a second Webflow submit", async () => {
    fetchMock.mockResolvedValueOnce(res(400, { errors: [] }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    destroy = initLead();
    click("[data-lead-retry]"); // nothing to retry yet
    click("[start-ready-button]");
    estimateReady();
    await flush();
    expect(state()).toBe("failed");

    click("[data-lead-retry]");
    expect(state()).toBe("sending");
    click("[data-lead-retry]"); // ignored while sending
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentFields(1)).toEqual(sentFields(0));
    expect(state()).toBe("sent");
    expect(form.requestSubmit).toHaveBeenCalledTimes(1);
  });

  it("fills the Webflow hidden inputs before the native submit", async () => {
    const changed = vi.fn();
    form.querySelector('[name="rental_estimation"]').addEventListener("change", changed);
    let snapshot;
    form.requestSubmit = vi.fn(() => {
      snapshot = Object.fromEntries(
        ["firstname", "lastname", "property_address", "zip", "property_bedrooms", "Lead Start", "rental_estimation"].map(
          (n) => [n, form.querySelector(`[name="${n}"]`).getAttribute("value")]
        )
      );
    });
    destroy = initLead();
    click("[start-ready-button]");
    estimateReady();
    await flush();
    expect(snapshot).toEqual({
      firstname: "Anna",
      lastname: "De Vries",
      property_address: "75 Marsh Wall, London",
      zip: "E14 9GH",
      property_bedrooms: "3",
      "Lead Start": "Start hosting | Staymo",
      rental_estimation: RANGE,
    });
    expect(form.querySelector('[name="rental_estimation"]').value).toBe(RANGE);
    expect(changed).toHaveBeenCalled();
  });

  it("falls back to a cancelable submit event without requestSubmit", async () => {
    form.requestSubmit = undefined;
    const onSubmit = vi.fn((e) => e.preventDefault());
    form.addEventListener("submit", onSubmit);
    destroy = initLead();
    click("[start-ready-button]");
    estimateReady();
    await flush();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].cancelable).toBe(true);
  });
});

describe("result-screen gate (window.estGoTo)", () => {
  function deferredFetch() {
    let resolve;
    fetchMock.mockImplementation(() => new Promise((r) => (resolve = r)));
    return (v) => resolve(v);
  }

  it("holds estGoTo('result') until the submission settles", async () => {
    const engine = vi.fn();
    window.estGoTo = engine;
    destroy = initLead();
    const respond = deferredFetch();
    click("[start-ready-button]");
    estimateReady();
    window.estGoTo("result");
    await vi.advanceTimersByTimeAsync(3000);
    expect(engine).not.toHaveBeenCalled();
    respond(res(200));
    await flush();
    expect(engine).toHaveBeenCalledWith("result");
    expect(state()).toBe("sent");
  });

  it("proceeds after the 10 s cap even if HubSpot never answers", async () => {
    const engine = vi.fn();
    window.estGoTo = engine;
    destroy = initLead();
    deferredFetch();
    click("[start-ready-button]");
    estimateReady();
    window.estGoTo("result");
    await vi.advanceTimersByTimeAsync(RESULT_HOLD_CAP - 1);
    expect(engine).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(engine).toHaveBeenCalledWith("result");
    expect(state()).toBe("sending");
  });

  it("does not hold when nothing is in flight, nor for other keys", async () => {
    const engine = vi.fn();
    destroy = initLead();
    window.estGoTo = engine; // defined after init
    window.estGoTo("result");
    window.estGoTo(2);
    expect(engine.mock.calls).toEqual([["result"], [2]]);
  });

  it("noresults path: no send, transition immediate", async () => {
    const engine = vi.fn();
    destroy = initLead();
    window.estGoTo = engine;
    click("[start-ready-button]");
    window.estGoTo("noresults");
    expect(engine).toHaveBeenCalledWith("noresults");
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state()).toBe(null);
  });

  it("estGoTo('result') without an event sends from the DOM estimate and waits", async () => {
    const engine = vi.fn();
    destroy = initLead();
    window.estGoTo = engine;
    const respond = deferredFetch();
    click("[start-ready-button]");
    document.querySelector('[data-output="estimate-range"]').textContent = RANGE;
    window.estGoTo("result");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(engine).not.toHaveBeenCalled();
    respond(res(200));
    await flush();
    expect(engine).toHaveBeenCalledWith("result");
  });

  it("chains with a page wrapper installed before init (dwell wrapper)", async () => {
    const engine = vi.fn();
    window.estGoTo = engine;
    const inner = window.estGoTo;
    window.estGoTo = function (key) {
      if (key === "result") setTimeout(() => inner(key), 5000);
      else inner(key);
    };
    destroy = initLead();
    const respond = deferredFetch();
    click("[start-ready-button]");
    estimateReady();
    window.estGoTo("result");
    await vi.advanceTimersByTimeAsync(2000);
    respond(res(200));
    await flush();
    expect(engine).not.toHaveBeenCalled(); // dwell still running
    await vi.advanceTimersByTimeAsync(5000);
    expect(engine).toHaveBeenCalledTimes(1);
    window.estGoTo("noresults");
    expect(engine).toHaveBeenLastCalledWith("noresults");
  });

  it("chains with estGoTo defined after init and a wrapper added after that", async () => {
    const engine = vi.fn();
    destroy = initLead();
    window.estGoTo = engine; // engine.js runs later
    const prev = window.estGoTo;
    window.estGoTo = function (key) {
      if (key === "result") setTimeout(() => prev(key), 5000);
      else prev(key);
    };
    deferredFetch();
    click("[start-ready-button]");
    estimateReady();
    window.estGoTo("result");
    // Outer and inner gates share one hold: the cap applies once, then the dwell.
    await vi.advanceTimersByTimeAsync(RESULT_HOLD_CAP);
    expect(engine).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(engine).toHaveBeenCalledTimes(1);
    expect(engine).toHaveBeenCalledWith("result");
    window.estGoTo(1);
    expect(engine).toHaveBeenLastCalledWith(1);
  });

  it("a restart while held drops the pending result transition", async () => {
    const engine = vi.fn();
    window.estGoTo = engine;
    destroy = initLead();
    const respond = deferredFetch();
    click("[start-ready-button]");
    estimateReady();
    window.estGoTo("result");
    click("[start-restart]");
    respond(res(200));
    await flush();
    expect(engine).not.toHaveBeenCalled();
    expect(state()).toBe(null); // the restarted enquiry has no state yet
    expect(form.requestSubmit).toHaveBeenCalledTimes(1); // the record is still kept
  });
});
