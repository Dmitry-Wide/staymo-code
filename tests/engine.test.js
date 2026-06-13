import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isFilled,
  validateStartInputs,
  progressWidth,
  initStepper,
} from "../src/engine.js";

beforeEach(() => {
  document.body.innerHTML = "";
  delete window.estGoTo;
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

describe("validateStartInputs", () => {
  it("marks invalid and returns false when either empty", () => {
    const a = document.createElement("input");
    const r = document.createElement("input");
    expect(validateStartInputs(a, r)).toBe(false);
    expect(a.getAttribute("data-invalid")).toBe("true");
    a.value = "addr";
    r.value = "2";
    expect(validateStartInputs(a, r)).toBe(true);
    expect(a.getAttribute("data-invalid")).toBe(null);
  });
});

describe("progressWidth", () => {
  it("maps 0-based step to quarter width", () => {
    expect(progressWidth(0)).toBe("25%");
    expect(progressWidth(1)).toBe("50%");
    expect(progressWidth(3)).toBe("100%");
  });
});

function funnelFixture() {
  document.body.innerHTML = `
    <div start-frame>
      <span start-photo data-step="0"></span><span start-photo data-step="1"></span>
      <span start-photo data-step="2"></span><span start-photo data-step="3"></span>
      <div start-step-0>
        <input start-start-button type="button">
        <input data-input-id="address-search"><input data-rooms-input>
      </div>
      <div start-step-1><label><input type="radio" name="s1"></label><button start-next></button><button start-step-back></button></div>
      <div start-step-2><label><input type="radio" name="s2"></label><button start-next></button><button start-step-back></button></div>
      <div start-step-3>
        <input type="text"><button start-ready-button></button><button start-step-back></button>
      </div>
      <span start-progress-fill></span><span start-step-counter></span>
    </div>
    <div start-loading><span start-loading-step></span><span start-loading-step></span></div>
    <div start-result><button start-restart></button></div>
    <div start-noresults></div>`;
}

const active = (sel) => document.querySelector(sel).classList.contains("is-active");
const width = () => document.querySelector("[start-progress-fill]").style.width;

describe("initStepper — funnel flow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts on step0: frame + step0 + photo0 active, progress 25%", () => {
    funnelFixture();
    initStepper();
    expect(active("[start-frame]")).toBe(true);
    expect(active("[start-step-0]")).toBe(true);
    expect(active('[start-photo][data-step="0"]')).toBe(true);
    expect(active("[start-step-1]")).toBe(false);
    expect(width()).toBe("25%");
  });

  it("blocks step0 -> step1 when inputs empty", () => {
    funnelFixture();
    initStepper();
    document.querySelector("[start-start-button]").click();
    expect(active("[start-step-1]")).toBe(false);
    expect(
      document.querySelector('[data-input-id="address-search"]').getAttribute("data-invalid")
    ).toBe("true");
  });

  it("advances step0 -> step1 when filled: step1 + photo1 active, progress 50%", () => {
    funnelFixture();
    document.querySelector('[data-input-id="address-search"]').value = "addr";
    document.querySelector("[data-rooms-input]").value = "2";
    initStepper();
    document.querySelector("[start-start-button]").click();
    expect(active("[start-step-1]")).toBe(true);
    expect(active("[start-step-0]")).toBe(false);
    expect(active('[start-photo][data-step="1"]')).toBe(true);
    expect(width()).toBe("50%");
    expect(document.querySelector("[start-step-counter]").textContent).toBe("2 of 4 steps");
  });

  it("auto-advances step1 -> step2 -> step3 on radio change", () => {
    funnelFixture();
    document.querySelector('[data-input-id="address-search"]').value = "addr";
    document.querySelector("[data-rooms-input]").value = "2";
    initStepper();
    document.querySelector("[start-start-button]").click();
    const r1 = document.querySelector('[start-step-1] input[type="radio"]');
    r1.checked = true;
    r1.dispatchEvent(new Event("change", { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(active("[start-step-2]")).toBe(true);
    const r2 = document.querySelector('[start-step-2] input[type="radio"]');
    r2.checked = true;
    r2.dispatchEvent(new Event("change", { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(active("[start-step-3]")).toBe(true);
    expect(width()).toBe("100%");
  });

  it("step3 submit shows loading and deactivates the frame", () => {
    funnelFixture();
    initStepper();
    window.estGoTo(3);
    document.querySelector("[start-ready-button]").click();
    expect(active("[start-loading]")).toBe(true);
    expect(active("[start-frame]")).toBe(false);
    expect(active("[start-result]")).toBe(false);
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
    const r1 = document.querySelector('[start-step-1] input[type="radio"]');
    r1.checked = true;
    r1.dispatchEvent(new Event("change", { bubbles: true }));
    vi.advanceTimersByTime(200); // auto-advanced to step2
    document.querySelector("[start-step-2] [start-step-back]").click(); // back to step1
    expect(active("[start-step-1]")).toBe(true);
    // radio still checked -> re-click fires no change; Next must still advance
    document.querySelector("[start-step-1] [start-next]").click();
    expect(active("[start-step-2]")).toBe(true);
  });

  it("Start again from result returns to step0", () => {
    funnelFixture();
    initStepper();
    window.estGoTo("result");
    document.querySelector("[start-restart]").click();
    expect(active("[start-step-0]")).toBe(true);
    expect(active("[start-frame]")).toBe(true);
    expect(active("[start-result]")).toBe(false);
  });

  it("back button returns step1 -> step0", () => {
    funnelFixture();
    initStepper();
    window.estGoTo(1);
    document.querySelector("[start-step-1] [start-step-back]").click();
    expect(active("[start-step-0]")).toBe(true);
    expect(active("[start-step-1]")).toBe(false);
  });
});
