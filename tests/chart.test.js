import { describe, it, expect, beforeEach } from "vitest";
import {
  generateMonths,
  clean,
  graphMax,
  initEarningsChart,
} from "../src/chart.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("generateMonths", () => {
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
});

function fixture({ withTooltip = false } = {}) {
  const root = document.createElement("div");
  root.id = "chart-container";
  let cols = "";
  for (let i = 0; i < 12; i++) {
    cols += `<div data-chart="col"><div data-chart="bar"></div><span data-chart="xlabel"></span></div>`;
  }
  root.innerHTML =
    cols +
    `<span data-chart="ytick"></span><span data-chart="ytick"></span>` +
    `<div data-chart="baseline"></div>`;
  document.body.appendChild(root);
  if (withTooltip) {
    const tip = document.createElement("div");
    tip.setAttribute("data-chart-tooltip", "bar-chart");
    tip.innerHTML =
      `<span class="result__chart__tooltip__month-income"></span>` +
      `<span class="result__chart__tooltip__occupancy-daily"></span>`;
    document.body.appendChild(tip);
  }
  return root;
}

describe("initEarningsChart", () => {
  it("sets bar heights, col data attrs and xlabels", () => {
    const root = fixture();
    const ok = initEarningsChart(root, { min: 1000, max: 5000, nowMonth: 0 });
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
  it("populates and shows the tooltip on bar hover", () => {
    const root = fixture({ withTooltip: true });
    initEarningsChart(root, { min: 1000, max: 5000, nowMonth: 0 });
    const tip = document.querySelector('[data-chart-tooltip="bar-chart"]');
    const julCol = root.querySelectorAll('[data-chart="col"]')[6];
    julCol.dispatchEvent(new Event("mouseenter"));
    expect(tip.style.display).toBe("block");
    expect(tip.querySelector(".result__chart__tooltip__month-income").textContent)
      .toBe("July income £5,000");
    julCol.dispatchEvent(new Event("mouseleave"));
    expect(tip.style.display).toBe("none");
  });
});
