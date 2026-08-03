import { describe, it, expect, beforeEach } from "vitest";
import { initBedsStepper, syncStepper } from "../src/beds-stepper.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

function stepperFixture({ min = "0", max = "10", value = "1" } = {}) {
  document.body.innerHTML = `
    <div data-counter-target="beds">
      <div data-action="decrement" class="is-inactive"></div>
      <input type="number" name="beds" data-input-id="beds-count" min="${min}" max="${max}" value="${value}">
      <div data-beds-studio>Studio</div>
      <div data-action="increment"></div>
    </div>`;
  return document.querySelector("[data-counter-target='beds']");
}

const input = (c) => c.querySelector("[data-input-id='beds-count']");
const studio = (c) => c.querySelector("[data-beds-studio]");
const minus = (c) => c.querySelector("[data-action='decrement']");
const plus = (c) => c.querySelector("[data-action='increment']");

describe("initBedsStepper", () => {
  it("increments and decrements the value", () => {
    const c = stepperFixture();
    initBedsStepper();
    plus(c).click();
    expect(input(c).value).toBe("2");
    minus(c).click();
    expect(input(c).value).toBe("1");
  });

  it("stops at min and max and marks the spent button inactive", () => {
    const c = stepperFixture({ min: "0", max: "2", value: "1" });
    initBedsStepper();
    minus(c).click();
    expect(input(c).value).toBe("0");
    minus(c).click();
    expect(input(c).value).toBe("0");
    expect(minus(c).classList.contains("is-inactive")).toBe(true);
    plus(c).click();
    plus(c).click();
    expect(input(c).value).toBe("2");
    expect(plus(c).classList.contains("is-inactive")).toBe(true);
  });

  it("reads min='0' as zero, not as the legacy fallback of 1", () => {
    const c = stepperFixture({ min: "0", value: "1" });
    initBedsStepper();
    minus(c).click();
    expect(input(c).value).toBe("0");
    expect(minus(c).classList.contains("is-inactive")).toBe(true);
  });

  it("swaps the number for the Studio label at zero", () => {
    const c = stepperFixture({ min: "0", value: "1" });
    initBedsStepper();
    expect(studio(c).classList.contains("is-studio")).toBe(false);
    minus(c).click();
    expect(input(c).value).toBe("0");
    expect(studio(c).classList.contains("is-studio")).toBe(true);
    expect(input(c).classList.contains("is-studio")).toBe(true);
    plus(c).click();
    expect(studio(c).classList.contains("is-studio")).toBe(false);
    expect(input(c).classList.contains("is-studio")).toBe(false);
  });

  it("shows the Studio label on load when the markup starts at zero", () => {
    const c = stepperFixture({ min: "0", value: "0" });
    initBedsStepper();
    expect(studio(c).classList.contains("is-studio")).toBe(true);
  });

  it("clamps a typed out-of-range value back into the min/max window", () => {
    const c = stepperFixture({ min: "0", max: "4", value: "1" });
    initBedsStepper();
    input(c).value = "99";
    input(c).dispatchEvent(new Event("input", { bubbles: true }));
    expect(input(c).value).toBe("4");
  });

  it("leaves a stepper without buttons alone", () => {
    document.body.innerHTML = `<div data-counter-target="beds"><input data-input-id="beds-count" value="3"></div>`;
    expect(() => initBedsStepper()).not.toThrow();
  });
});

describe("syncStepper", () => {
  it("keeps a legacy stepper without a Studio label working", () => {
    document.body.innerHTML = `
      <div data-counter-target="beds">
        <div data-action="decrement"></div>
        <input data-input-id="beds-count" min="1" max="10" value="1">
        <div data-action="increment"></div>
      </div>`;
    const c = document.querySelector("[data-counter-target='beds']");
    initBedsStepper();
    minus(c).click();
    expect(input(c).value).toBe("1");
    expect(minus(c).classList.contains("is-inactive")).toBe(true);
  });
});
