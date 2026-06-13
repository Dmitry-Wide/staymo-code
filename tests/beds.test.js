import { describe, it, expect, beforeEach } from "vitest";
import { selectBed, initBeds } from "../src/beds.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

function bedsFixture(preselect = null) {
  document.body.innerHTML = `
    <div data-rooms>
      <div class="row">
        <div data-room="1" class="${preselect === 1 ? "is-bed-selected" : ""}">1</div>
        <div data-room="2" class="${preselect === 2 ? "is-bed-selected" : ""}">2</div>
        <div data-room="3">3</div>
        <div data-room="4">4 +</div>
      </div>
      <input type="hidden" data-rooms-input>
    </div>`;
  return document.querySelector("[data-rooms]");
}

describe("selectBed", () => {
  it("marks the chosen tile, clears siblings, writes the hidden input", () => {
    const c = bedsFixture();
    const three = c.querySelector('[data-room="3"]');
    const val = selectBed(c, three);
    expect(val).toBe("3");
    expect(three.classList.contains("is-bed-selected")).toBe(true);
    expect(c.querySelector('[data-room="1"]').classList.contains("is-bed-selected")).toBe(false);
    expect(c.querySelector("[data-rooms-input]").value).toBe("3");
  });

  it("fires input/change so the engine sees the value", () => {
    const c = bedsFixture();
    let changed = false;
    c.querySelector("[data-rooms-input]").addEventListener("change", () => (changed = true));
    selectBed(c, c.querySelector('[data-room="2"]'));
    expect(changed).toBe(true);
  });
});

describe("initBeds", () => {
  it("selecting a tile by click writes the input", () => {
    const c = bedsFixture();
    initBeds();
    c.querySelector('[data-room="4"]').click();
    expect(c.querySelector("[data-rooms-input]").value).toBe("4");
    expect(c.querySelector('[data-room="4"]').classList.contains("is-bed-selected")).toBe(true);
  });

  it("reflects a markup-preselected tile into the hidden input on init", () => {
    const c = bedsFixture(2);
    initBeds();
    expect(c.querySelector("[data-rooms-input]").value).toBe("2");
  });
});
