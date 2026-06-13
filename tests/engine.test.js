import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isFilled, validateStartInputs, initStepper } from "../src/engine.js";

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

// Full funnel fixture — no gsap, so transitions are instant display swaps.
function funnelFixture() {
  document.body.innerHTML = `
    <span start-progress-step></span><span start-progress-step></span>
    <div start-step-0>
      <input start-start-button type="button">
      <input data-input-id="address-search"><input data-rooms-input>
    </div>
    <div start-step-1><label><input type="radio" name="s1"></label><button start-step-back></button></div>
    <div start-step-2><label><input type="radio" name="s2"></label><button start-step-back></button></div>
    <div start-step-3>
      <input type="text"><input type="email">
      <button start-ready-button></button><button start-step-back></button>
    </div>
    <div start-loading><span start-loading-step></span><span start-loading-step></span></div>
    <div start-result></div>
    <div start-noresults></div>`;
}

const shown = (sel) => document.querySelector(sel).style.display;

describe("initStepper — funnel flow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts with only step0 visible", () => {
    funnelFixture();
    initStepper();
    expect(shown("[start-step-0]")).toBe("flex");
    expect(shown("[start-step-1]")).toBe("none");
    expect(shown("[start-result]")).toBe("none");
  });

  it("blocks step0 -> step1 when inputs empty", () => {
    funnelFixture();
    initStepper();
    document.querySelector("[start-start-button]").click();
    expect(shown("[start-step-1]")).toBe("none");
    expect(
      document.querySelector('[data-input-id="address-search"]').getAttribute("data-invalid")
    ).toBe("true");
  });

  it("advances step0 -> step1 when inputs filled", () => {
    funnelFixture();
    document.querySelector('[data-input-id="address-search"]').value = "addr";
    document.querySelector("[data-rooms-input]").value = "2";
    initStepper();
    document.querySelector("[start-start-button]").click();
    expect(shown("[start-step-1]")).toBe("flex");
    expect(shown("[start-step-0]")).toBe("none");
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
    expect(shown("[start-step-2]")).toBe("flex");
    const r2 = document.querySelector('[start-step-2] input[type="radio"]');
    r2.checked = true;
    r2.dispatchEvent(new Event("change", { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(shown("[start-step-3]")).toBe("flex");
  });

  it("step3 submit shows loading (not auto-result)", () => {
    funnelFixture();
    initStepper();
    window.estGoTo(3); // jump to step3
    document.querySelector("[start-ready-button]").click();
    expect(shown("[start-loading]")).toBe("flex");
    expect(shown("[start-step-3]")).toBe("none");
    expect(shown("[start-result]")).toBe("none");
  });

  it("exposes estGoTo for the valuation module to show result/noresults", () => {
    funnelFixture();
    initStepper();
    expect(typeof window.estGoTo).toBe("function");
    window.estGoTo("result");
    expect(shown("[start-result]")).toBe("flex");
    window.estGoTo("noresults");
    expect(shown("[start-result]")).toBe("none");
    expect(shown("[start-noresults]")).toBe("flex");
  });

  it("back button returns step1 -> step0", () => {
    funnelFixture();
    initStepper();
    window.estGoTo(1);
    document.querySelector("[start-step-1] [start-step-back]").click();
    expect(shown("[start-step-0]")).toBe("flex");
    expect(shown("[start-step-1]")).toBe("none");
  });
});
