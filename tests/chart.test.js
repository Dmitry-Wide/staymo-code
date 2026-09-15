import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generateMonths,
  clean,
  graphMax,
  peakIndex,
  perNight,
  clampShift,
  initEarningsChart,
} from "../src/chart.js";

// Stand-in ResizeObserver: records each observer so a test can fire its callback by hand.
class FakeResizeObserver {
  static made = [];
  constructor(cb) { this.cb = cb; FakeResizeObserver.made.push(this); }
  observe(el) { this.el = el; }
  disconnect() {}
}

beforeEach(() => {
  document.body.innerHTML = "";
  FakeResizeObserver.made = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateMonths", () => {
  it("starts on February by default, so July peaks mid-chart and January closes", () => {
    const out = generateMonths(1000, 5000);
    expect(out[0].short).toBe("Feb");
    expect(out[5].short).toBe("Jul");
    expect(out[11].short).toBe("Jan");
  });
  it("returns 12 months starting at the given month", () => {
    const out = generateMonths(1000, 5000, 0); // start January
    expect(out).toHaveLength(12);
    expect(out[0].short).toBe("Jan");
    expect(out[6].short).toBe("Jul");
  });
  it("pins July to max and January to min", () => {
    const out = generateMonths(1000, 5000, 0);
    expect(out.find((d) => d.short === "Jul").value).toBe(5000);
    expect(out.find((d) => d.short === "Jan").value).toBe(1000);
  });
  it("computes other months as floor(max*rate/98)", () => {
    const out = generateMonths(1000, 5000, 0);
    const feb = out.find((d) => d.short === "Feb"); // RATE[1]=78
    expect(feb.value).toBe(Math.floor((5000 * 78) / 98));
  });
});

describe("helpers", () => {
  it("clean strips £ , and whitespace", () => {
    expect(clean("£4,200 ")).toBe(4200);
  });
  it("graphMax rounds up to next 1000 above max*1.02", () => {
    expect(graphMax(5000)).toBe(6000);
  });
  it("peakIndex finds the highest month instead of assuming a slot", () => {
    expect(peakIndex(generateMonths(5880, 9555))).toBe(5); // Feb start: July is 6th
    expect(peakIndex(generateMonths(5880, 9555, 0))).toBe(6); // Jan start: July is 7th
  });
  it("peakIndex keeps the first of equal highs", () => {
    expect(peakIndex([{ value: 3 }, { value: 7 }, { value: 7 }])).toBe(1);
  });
  it("perNight spreads a month over its booked nights (30 × occupancy)", () => {
    expect(perNight(9555, 98)).toBe(325); // 9555 / 29.4
    expect(perNight(5880, 72)).toBe(272); // 5880 / 21.6
    expect(perNight(4200, 0)).toBe(0);
  });
  it("clampShift pulls a box back inside its bounds and leaves a fitting one alone", () => {
    expect(clampShift(10, 60, 0, 100)).toBe(0);
    expect(clampShift(-20, 30, 0, 100)).toBe(20);
    expect(clampShift(70, 120, 0, 100)).toBe(-20);
    expect(clampShift(-10, 130, 0, 100)).toBe(10); // wider than the bounds: pinned to the start
  });
});

function fixture({ tooltip = true } = {}) {
  const root = document.createElement("div");
  root.id = "chart-container";
  let cols = "";
  for (let i = 0; i < 12; i++) {
    cols += `<div data-chart="col"><div data-chart="bar"></div><span data-chart="xlabel"></span></div>`;
  }
  const tip = tooltip
    ? `<div data-chart="tooltip"><div data-chart="tooltip-title"></div>` +
      `<div data-chart="tooltip-sub"></div><div data-chart="tooltip-arrow"></div></div>`
    : "";
  root.innerHTML = `<span data-chart="ytick"></span><span data-chart="ytick"></span>` + cols + tip;
  document.body.appendChild(root);
  return root;
}

const all = (root, name) => [...root.querySelectorAll(`[data-chart="${name}"]`)];
const one = (root, name) => root.querySelector(`[data-chart="${name}"]`);
const activeIndex = (root) => all(root, "bar").findIndex((b) => b.classList.contains("is-active"));
const over = (el, pointerType = "mouse") =>
  el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType }));
const leave = (el, pointerType = "mouse") =>
  el.dispatchEvent(new PointerEvent("pointerleave", { pointerType }));
const tap = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const rect = (left, right) => () => ({ left, right, width: right - left, top: 0, bottom: 0, height: 0 });
const resized = () => FakeResizeObserver.made.forEach((o) => o.cb([]));

describe("initEarningsChart", () => {
  it("sets bar heights, col data attrs and xlabels", () => {
    const root = fixture();
    const ok = initEarningsChart(root, { min: 1000, max: 5000, startMonth: 0 });
    expect(ok).toBe(true);
    const cols = root.querySelectorAll('[data-chart="col"]');
    expect(cols[6].getAttribute("data-month")).toBe("July");
    expect(cols[6].getAttribute("data-value")).toBe("5000");
    const bar6 = cols[6].querySelector('[data-chart="bar"]');
    expect(parseFloat(bar6.style.height)).toBeCloseTo((5000 / 6000) * 100, 1);
  });
  it("hides and returns false when max is missing", () => {
    const root = fixture();
    expect(initEarningsChart(root, { min: 0, max: 0 })).toBe(false);
    expect(root.style.display).toBe("none");
  });
  it("clears display instead of forcing block, so the Designer's display applies", () => {
    const root = fixture();
    initEarningsChart(root, { min: 0, max: 0 });
    initEarningsChart(root, { min: 1000, max: 5000 });
    expect(root.style.display).toBe("");
  });
  it("opens on the peak month: exactly one active bar, with the tooltip inside it", () => {
    const root = fixture();
    initEarningsChart(root, { min: 5880, max: 9555 });
    const bars = all(root, "bar");
    expect(activeIndex(root)).toBe(5);
    expect(bars.filter((b) => b.classList.contains("is-active"))).toHaveLength(1);
    expect(one(root, "tooltip").parentElement).toBe(bars[5]);
  });
  it("writes the tooltip as 'Month · £value' / 'rate% occupancy · £X/night'", () => {
    const root = fixture();
    initEarningsChart(root, { min: 5880, max: 9555 });
    expect(one(root, "tooltip-title").textContent).toBe("July · £9,555");
    expect(one(root, "tooltip-sub").textContent).toBe("98% occupancy · £325/night");
  });
  it("keeps the 12 col/bar/xlabel hooks once the tooltip has moved into a bar", () => {
    const root = fixture();
    initEarningsChart(root, { min: 5880, max: 9555 });
    expect([all(root, "col").length, all(root, "bar").length, all(root, "xlabel").length]).toEqual([12, 12, 12]);
  });
  it("mouse hover moves the highlight and the tooltip; leaving the chart returns to the peak", () => {
    const root = fixture();
    initEarningsChart(root, { min: 5880, max: 9555 });
    const oct = all(root, "bar")[8];
    over(oct);
    expect(activeIndex(root)).toBe(8);
    expect(one(root, "tooltip").parentElement).toBe(oct);
    expect(one(root, "tooltip-title").textContent).toBe("October · £8,580");
    expect(one(root, "tooltip-sub").textContent).toBe("88% occupancy · £325/night");
    leave(root);
    expect(activeIndex(root)).toBe(5);
    expect(one(root, "tooltip-title").textContent).toBe("July · £9,555");
  });
  it("hovering the empty part of a column above its bar picks that column", () => {
    const root = fixture();
    initEarningsChart(root, { min: 5880, max: 9555 });
    over(all(root, "col")[3]);
    expect(activeIndex(root)).toBe(3);
  });
  it("hovering the axes keeps the current highlight instead of dropping it", () => {
    const root = fixture();
    initEarningsChart(root, { min: 5880, max: 9555 });
    over(all(root, "bar")[8]);
    over(one(root, "ytick"));
    expect(activeIndex(root)).toBe(8);
  });
  it("touch, in the real event order: the finger's leave comes before the click and changes nothing", () => {
    const root = fixture();
    initEarningsChart(root, { min: 5880, max: 9555 });
    const [apr, oct] = [all(root, "bar")[2], all(root, "bar")[8]];
    tap(apr);
    expect(activeIndex(root)).toBe(2);
    over(oct, "touch"); // pointerover:touch, pointerdown, pointerup, pointerleave:touch, …, click
    expect(activeIndex(root)).toBe(2);
    leave(root, "touch");
    expect(activeIndex(root)).toBe(2);
    tap(oct);
    expect(activeIndex(root)).toBe(8);
  });
  it("a second init binds no new listeners or observers and reopens on the new peak", () => {
    const root = fixture();
    const onRoot = vi.spyOn(root, "addEventListener");
    initEarningsChart(root, { min: 5880, max: 9555 });
    const first = [onRoot.mock.calls.length, FakeResizeObserver.made.length];
    over(all(root, "bar")[8]);
    initEarningsChart(root, { min: 8000, max: 12400 });
    expect([onRoot.mock.calls.length, FakeResizeObserver.made.length]).toEqual(first);
    expect(FakeResizeObserver.made[0].el).toBe(root);
    expect(activeIndex(root)).toBe(5);
    expect(one(root, "tooltip-title").textContent).toBe("July · £12,400");
  });
  it("still highlights bars when the markup has no tooltip", () => {
    const root = fixture({ tooltip: false });
    expect(initEarningsChart(root, { min: 5880, max: 9555 })).toBe(true);
    expect(activeIndex(root)).toBe(5);
    over(all(root, "bar")[3]);
    expect(activeIndex(root)).toBe(3);
  });
  it("pins a tooltip that would spill past the chart edge; the arrow shifts back onto the bar", () => {
    const root = fixture();
    root.getBoundingClientRect = rect(0, 300);
    const tip = one(root, "tooltip");
    tip.getBoundingClientRect = rect(-40, 110);
    initEarningsChart(root, { min: 5880, max: 9555 });
    expect(tip.style.translate).toBe("40px");
    expect(one(root, "tooltip-arrow").style.translate).toBe("-40px");
  });
  it("re-pins when the chart's box changes and clears the shift once the tooltip fits", () => {
    const root = fixture();
    root.getBoundingClientRect = rect(0, 300);
    const tip = one(root, "tooltip");
    tip.getBoundingClientRect = rect(100, 250);
    initEarningsChart(root, { min: 5880, max: 9555 });
    expect(tip.style.translate).toBe("");
    tip.getBoundingClientRect = rect(220, 370);
    resized();
    expect(tip.style.translate).toBe("-70px");
    tip.getBoundingClientRect = rect(100, 250);
    resized();
    expect(tip.style.translate).toBe("");
  });
  it("a hidden chart keeps its shift, and showing it pins again", () => {
    const root = fixture();
    root.getBoundingClientRect = rect(0, 300);
    const tip = one(root, "tooltip");
    tip.getBoundingClientRect = rect(220, 370);
    initEarningsChart(root, { min: 5880, max: 9555 });
    expect(tip.style.translate).toBe("-70px");
    root.getBoundingClientRect = rect(0, 0); // display:none — nothing to measure
    resized();
    expect(tip.style.translate).toBe("-70px");
    root.getBoundingClientRect = rect(0, 250); // shown again, narrower
    resized();
    expect(tip.style.translate).toBe("-120px");
  });
  it("window.initChart draws #chart-container and ignores the retired long-term argument", () => {
    const root = fixture();
    expect(window.initChart(5880, 9555, "£3,000")).toBe(true);
    expect(activeIndex(root)).toBe(5);
  });
});
