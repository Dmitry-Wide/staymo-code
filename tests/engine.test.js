import { describe, it, expect, beforeEach, vi } from "vitest";
import { isFilled, validateStartInputs, initStepper } from "../src/engine.js";

beforeEach(() => {
  document.body.innerHTML = "";
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

function gsapStub() {
  const tl = {
    to: (el, o) => {
      if (o && o.onComplete) o.onComplete();
      return tl;
    },
    fromTo: (el, from, to) => {
      if (el && to && "display" in to) el.style.display = to.display;
      return tl;
    },
  };
  return {
    timeline: () => tl,
    set: (el, o) => {
      if (el && o && "display" in o) el.style.display = o.display;
    },
    getProperty: (el) => (el ? el.style.display || "none" : "none"),
  };
}

function stepperFixture() {
  document.body.innerHTML = `
    <span start-progress-step></span><span start-progress-step></span>
    <div start-step-0>
      <input start-start-button type="button">
      <input data-input-id="address-search"><input data-rooms-input>
    </div>
    <div start-step-1><label><input type="radio" name="s1"></label><button start-step-back></button></div>
    <div start-step-2></div>
    <div start-step-3></div>
    <div start-ready></div><div start-not-ready></div>`;
}

describe("initStepper", () => {
  it("blocks advance when start inputs empty", () => {
    vi.stubGlobal("gsap", gsapStub());
    stepperFixture();
    initStepper();
    const s1 = document.querySelector("[start-step-1]");
    document.querySelector("[start-start-button]").click();
    expect(s1.style.display === "none" || s1.style.display === "").toBe(true);
    expect(document.querySelector('[data-input-id="address-search"]').getAttribute("data-invalid")).toBe("true");
  });

  it("advances to step1 when inputs filled", () => {
    vi.stubGlobal("gsap", gsapStub());
    stepperFixture();
    document.querySelector('[data-input-id="address-search"]').value = "addr";
    document.querySelector("[data-rooms-input]").value = "2";
    initStepper();
    document.querySelector("[start-start-button]").click();
    expect(document.querySelector("[start-step-1]").style.display).toBe("flex");
  });

  it("auto-advances step1 → step2 on radio change", async () => {
    vi.stubGlobal("gsap", gsapStub());
    stepperFixture();
    document.querySelector('[data-input-id="address-search"]').value = "addr";
    document.querySelector("[data-rooms-input]").value = "2";
    initStepper();
    document.querySelector("[start-start-button]").click();
    const radio = document.querySelector('[start-step-1] input[type="radio"]');
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() =>
      expect(document.querySelector("[start-step-2]").style.display).toBe("flex")
    );
  });
});
