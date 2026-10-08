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

  it("Enter / Space on a tile selects it and prevents the default", () => {
    const c = bedsFixture();
    initBeds();
    let changes = 0;
    c.querySelector("[data-rooms-input]").addEventListener("change", () => changes++);
    for (const [key, room] of [["Enter", "3"], [" ", "4"]]) {
      const tile = c.querySelector(`[data-room="${room}"]`);
      const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      tile.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(c.querySelector("[data-rooms-input]").value).toBe(room);
      expect(tile.classList.contains("is-bed-selected")).toBe(true);
    }
    expect(changes).toBe(2); // one selection per key, no double handling
  });

  it("ignores other keys and keys outside a tile", () => {
    const c = bedsFixture(1);
    initBeds();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    c.querySelector('[data-room="3"]').dispatchEvent(tab);
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    c.querySelector(".row").dispatchEvent(enter);
    expect(tab.defaultPrevented).toBe(false);
    expect(enter.defaultPrevented).toBe(false);
    expect(c.querySelector("[data-rooms-input]").value).toBe("1");
  });

  it("leaves Enter / Space on native button tiles to the browser's click", () => {
    document.body.innerHTML = `
      <div data-rooms><button type="button" data-room="2">2</button><input type="hidden" data-rooms-input></div>`;
    initBeds();
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    document.querySelector('[data-room="2"]').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.querySelector("[data-rooms-input]").value).toBe("");
  });

  it("reflects a markup-preselected tile into the hidden input on init", () => {
    const c = bedsFixture(2);
    initBeds();
    expect(c.querySelector("[data-rooms-input]").value).toBe("2");
  });
});
