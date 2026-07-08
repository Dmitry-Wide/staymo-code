import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isFilled,
  isResolvedAddress,
  validateStartInputs,
  isValidEmail,
  validateContact,
  validateStep3,
  progressWidth,
  hasStartPrefill,
  initStepper,
} from "../src/engine.js";

describe("isValidEmail", () => {
  it("accepts well-formed, rejects malformed", () => {
    expect(isValidEmail("a@b.io")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("validateContact (aka validateStep3)", () => {
  it("is the same function under both names", () => {
    expect(validateStep3).toBe(validateContact);
  });
  it("false until name+email+phone+consent valid", () => {
    document.body.innerHTML = `<div id="s">
      <input data-input="full-name"><input data-input="email">
      <input data-input="phone"><input type="checkbox" data-input="consent"></div>`;
    const s = document.getElementById("s");
    expect(validateContact(s)).toBe(false);
    s.querySelector('[data-input="full-name"]').value = "Jane";
    s.querySelector('[data-input="email"]').value = "jane@x.io";
    s.querySelector('[data-input="phone"]').value = "07700900123";
    s.querySelector('[data-input="consent"]').checked = true;
    expect(validateContact(s)).toBe(true);
  });
});

beforeEach(() => {
  document.body.innerHTML = "";
  delete window.estGoTo;
  window.history.pushState({}, "", "/"); // reset URL prefill params between tests
  document.documentElement.classList.remove("est-prefill", "est-ready");
});

describe("hasStartPrefill", () => {
  it("true only when address + postal-code + beds are all present", () => {
    expect(hasStartPrefill("?address=a&postal-code=SW1A1AA&beds=2")).toBe(true);
    expect(hasStartPrefill("?address=a&beds=2")).toBe(false);
    expect(hasStartPrefill("?postal-code=SW1A1AA&beds=2")).toBe(false);
    expect(hasStartPrefill("")).toBe(false);
  });
});

describe("isFilled", () => {
  it("true when value present, false when empty/null", () => {
    const i = document.createElement("input");
    i.value = "x";
    expect(isFilled(i)).toBe(true);
    i.value = "  ";
    expect(isFilled(i)).toBe(false);
    expect(isFilled(null)).toBe(false);
  });
});

describe("isResolvedAddress", () => {
  it("true only for a dropdown pick or a resolved postcode; false for bare text", () => {
    const a = document.createElement("input");
    expect(isResolvedAddress(a, null)).toBe(false); // empty
    a.value = "123123";
    expect(isResolvedAddress(a, null)).toBe(false); // typed junk, no postcode
    const p = document.createElement("input");
    p.value = "SW1V 1AE";
    expect(isResolvedAddress(a, p)).toBe(true); // resolved postcode
    p.value = "";
    a.dataset.placeSelected = "1";
    expect(isResolvedAddress(a, p)).toBe(true); // dropdown pick, no postcode needed
  });
});

describe("validateStartInputs", () => {
  it("marks invalid and returns false until address is resolved + beds filled", () => {
    const a = document.createElement("input");
    const r = document.createElement("input");
    const p = document.createElement("input");
    expect(validateStartInputs(a, r, p)).toBe(false);
    expect(a.getAttribute("data-invalid")).toBe("true");
    // bare address text is not enough — needs a resolved postcode or a dropdown pick
    a.value = "addr";
    r.value = "2";
    expect(validateStartInputs(a, r, p)).toBe(false);
    expect(a.getAttribute("data-invalid")).toBe("true");
    p.value = "SW1V 1AE";
    expect(validateStartInputs(a, r, p)).toBe(true);
    expect(a.getAttribute("data-invalid")).toBe(null);
  });
});

describe("progressWidth", () => {
  it("maps 0-based step to width within count", () => {
    expect(progressWidth(0, 4)).toBe("25%");
    expect(progressWidth(1, 4)).toBe("50%");
    expect(progressWidth(3, 4)).toBe("100%");
    expect(progressWidth(2, 6)).toBe("50%");
  });
});

// Data-driven fixture: address step (start-start-button) + (nSteps-2) radio steps +
// contact step (start-ready-button). All steps carry a bare `start-step`.
function funnelFixture(nSteps = 4) {
  const photos = Array.from(
    { length: nSteps },
    (_, i) => `<span start-photo data-step="${i}"></span>`
  ).join("");
  const mid = Array.from(
    { length: nSteps - 2 },
    () =>
      `<div start-step><label><input type="radio" name="r"></label><button start-next></button><button start-step-back></button><div start-step-error></div></div>`
  ).join("");
  document.body.innerHTML = `
    <div start-frame>
      ${photos}
      <div start-step>
        <input start-start-button type="button">
        <input data-input-id="address-search"><input data-input-id="postal-code-result"><input data-rooms-input>
      </div>
      ${mid}
      <div start-step>
        <input data-input="full-name"><input data-input="email"><input data-input="phone">
        <input type="checkbox" data-input="consent">
        <button start-ready-button></button><button start-step-back></button><div start-step-error></div>
      </div>
      <span start-progress-fill></span><span start-step-counter></span>
    </div>
    <div start-loading><span start-loading-step></span><span start-loading-step></span></div>
    <div start-result><button start-restart></button></div>
    <div start-noresults></div>`;
}

const steps = () => document.querySelectorAll("[start-frame] [start-step]");
const stepEl = (i) => steps()[i];
const stepActive = (i) => stepEl(i).classList.contains("is-active");
const active = (sel) => document.querySelector(sel).classList.contains("is-active");
const width = () => document.querySelector("[start-progress-fill]").style.width;

function fillAddress() {
  document.querySelector('[data-input-id="address-search"]').value = "addr";
  // a resolved postcode marks the address as real (soft gate)
  document.querySelector('[data-input-id="postal-code-result"]').value = "SW1V 1AE";
  document.querySelector("[data-rooms-input]").value = "2";
}
function fillContact() {
  document.querySelector('[data-input="full-name"]').value = "Jane Doe";
  document.querySelector('[data-input="email"]').value = "jane@x.io";
  document.querySelector('[data-input="phone"]').value = "07700900123";
  document.querySelector('[data-input="consent"]').checked = true;
}

describe("initStepper — funnel flow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts on step0: frame + step0 + photo0 active, progress 25%", () => {
    funnelFixture();
    initStepper();
    expect(active("[start-frame]")).toBe(true);
    expect(stepActive(0)).toBe(true);
    expect(active('[start-photo][data-step="0"]')).toBe(true);
    expect(stepActive(1)).toBe(false);
    expect(width()).toBe("25%");
  });

  it("blocks step0 -> step1 when inputs empty", () => {
    funnelFixture();
    initStepper();
    document.querySelector("[start-start-button]").click();
    expect(stepActive(1)).toBe(false);
    expect(
      document.querySelector('[data-input-id="address-search"]').getAttribute("data-invalid")
    ).toBe("true");
  });

  it("blocks step0 -> step1 when address is typed but not resolved (e.g. '123123')", () => {
    funnelFixture();
    document.querySelector('[data-input-id="address-search"]').value = "123123";
    document.querySelector("[data-rooms-input]").value = "2";
    // no postcode filled, no dropdown pick -> not a real address
    initStepper();
    document.querySelector("[start-start-button]").click();
    expect(stepActive(1)).toBe(false);
    expect(
      document.querySelector('[data-input-id="address-search"]').getAttribute("data-invalid")
    ).toBe("true");
  });

  it("advances step0 -> step1 when filled: step1 + photo1 active, progress 50%, counter", () => {
    funnelFixture();
    fillAddress();
    initStepper();
    document.querySelector("[start-start-button]").click();
    expect(stepActive(1)).toBe(true);
    expect(stepActive(0)).toBe(false);
    expect(active('[start-photo][data-step="1"]')).toBe(true);
    expect(width()).toBe("50%");
    expect(document.querySelector("[start-step-counter]").textContent).toBe("2 of 4 steps");
  });

  it("starts past the address step when arriving with a full URL prefill (no flash)", () => {
    funnelFixture();
    window.history.pushState({}, "", "/?address=10+Downing+St&postal-code=SW1A+2AA&beds=2");
    initStepper();
    expect(stepActive(0)).toBe(false);
    expect(stepActive(1)).toBe(true);
    expect(width()).toBe("50%");
    expect(document.documentElement.classList.contains("est-ready")).toBe(true);
  });

  it("starts on step0 when the URL prefill is incomplete", () => {
    funnelFixture();
    window.history.pushState({}, "", "/?address=10+Downing+St"); // no postal-code/beds
    initStepper();
    expect(stepActive(0)).toBe(true);
    expect(stepActive(1)).toBe(false);
  });

  it("auto-advances step1 -> step2 -> step3 on radio change", () => {
    funnelFixture();
    fillAddress();
    initStepper();
    document.querySelector("[start-start-button]").click();
    const r1 = stepEl(1).querySelector('input[type="radio"]');
    r1.checked = true;
    r1.dispatchEvent(new Event("change", { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(stepActive(2)).toBe(true);
    const r2 = stepEl(2).querySelector('input[type="radio"]');
    r2.checked = true;
    r2.dispatchEvent(new Event("change", { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(stepActive(3)).toBe(true);
    expect(width()).toBe("100%");
  });

  it("derives count from DOM: 6 steps => step1 shows '2 of 6 steps'", () => {
    funnelFixture(6);
    fillAddress();
    initStepper();
    document.querySelector("[start-start-button]").click();
    expect(stepActive(1)).toBe(true);
    expect(document.querySelector("[start-step-counter]").textContent).toBe("2 of 6 steps");
    // last step is the contact step regardless of count
    for (let i = 1; i < 5; i++) {
      const r = stepEl(i).querySelector('input[type="radio"]');
      r.checked = true;
      r.dispatchEvent(new Event("change", { bubbles: true }));
      vi.advanceTimersByTime(200);
    }
    expect(stepActive(5)).toBe(true);
    expect(width()).toBe("100%");
    fillContact();
    document.querySelector("[start-ready-button]").click();
    expect(active("[start-loading]")).toBe(true);
  });

  it("contact submit (valid) shows loading and deactivates the frame", () => {
    funnelFixture();
    initStepper();
    window.estGoTo(3);
    fillContact();
    document.querySelector("[start-ready-button]").click();
    expect(active("[start-loading]")).toBe(true);
    expect(active("[start-frame]")).toBe(false);
  });

  it("Next without a selection shows error and does not advance", () => {
    funnelFixture();
    initStepper();
    window.estGoTo(1);
    stepEl(1).querySelector("[start-next]").click();
    expect(stepActive(2)).toBe(false);
    expect(stepEl(1).querySelector("[start-step-error]").classList.contains("is-active")).toBe(true);
  });

  it("contact submit (invalid) blocks loading and marks fields", () => {
    funnelFixture();
    initStepper();
    window.estGoTo(3);
    document.querySelector("[start-ready-button]").click();
    expect(active("[start-loading]")).toBe(false);
    expect(stepActive(3)).toBe(true);
    expect(document.querySelector('[data-input="email"]').getAttribute("data-invalid")).toBe("true");
    expect(document.querySelector('[data-input="consent"]').getAttribute("data-invalid")).toBe("true");
  });

  it("estGoTo drives result / noresults for the valuation module", () => {
    funnelFixture();
    initStepper();
    expect(typeof window.estGoTo).toBe("function");
    window.estGoTo("result");
    expect(active("[start-result]")).toBe(true);
    expect(active("[start-frame]")).toBe(false);
    window.estGoTo("noresults");
    expect(active("[start-result]")).toBe(false);
    expect(active("[start-noresults]")).toBe(true);
  });

  it("loading checklist reveals items one by one", () => {
    funnelFixture();
    initStepper();
    window.estGoTo("loading");
    const items = document.querySelectorAll("[start-loading-step]");
    vi.advanceTimersByTime(0);
    expect(items[0].classList.contains("is-active")).toBe(true);
    expect(items[1].classList.contains("is-active")).toBe(false);
    vi.advanceTimersByTime(700);
    expect(items[1].classList.contains("is-active")).toBe(true);
  });

  it("Next button advances even when the radio is already checked (post-Back)", () => {
    funnelFixture();
    initStepper();
    window.estGoTo(1);
    const r1 = stepEl(1).querySelector('input[type="radio"]');
    r1.checked = true;
    r1.dispatchEvent(new Event("change", { bubbles: true }));
    vi.advanceTimersByTime(200); // auto-advanced to step2
    stepEl(2).querySelector("[start-step-back]").click(); // back to step1
    expect(stepActive(1)).toBe(true);
    // radio still checked -> re-click fires no change; Next must still advance
    stepEl(1).querySelector("[start-next]").click();
    expect(stepActive(2)).toBe(true);
  });

  it("Start again from result returns to step0", () => {
    funnelFixture();
    initStepper();
    window.estGoTo("result");
    document.querySelector("[start-restart]").click();
    expect(stepActive(0)).toBe(true);
    expect(active("[start-frame]")).toBe(true);
    expect(active("[start-result]")).toBe(false);
  });

  it("back button returns step1 -> step0", () => {
    funnelFixture();
    initStepper();
    window.estGoTo(1);
    stepEl(1).querySelector("[start-step-back]").click();
    expect(stepActive(0)).toBe(true);
    expect(stepActive(1)).toBe(false);
  });
});
