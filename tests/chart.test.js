import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generateMonths,
  clean,
  graphMax,
  peakIndex,
  perNight,
  clampShift,
  breakdown,
  initBreakdown,
  stats,
  initStats,
  initTabs,
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

// The owner's model: net = rental × 0.85 × (1 − 0.14 × 1.2). The table rounds to whole pounds and
// still has to add up, so every test below checks the two things that can silently break — a column
// that no longer reconciles, and a rounded figure drifting away from the model.
const RATES = { platform: 0.15, staymo: 0.14, vat: 0.2 };
const exactNet = (rental, r = RATES) =>
  rental * (1 - r.platform) * (1 - r.staymo * (1 + r.vat));
const rows = ["rental", "platform", "staymo", "vat", "net"];

describe("breakdown", () => {
  it("reconciles every month: rental minus the three deductions is the net", () => {
    const out = breakdown(generateMonths(5880, 9555), RATES);
    expect(out.months).toHaveLength(12);
    out.months.forEach((m) => {
      expect(m.rental - m.platform - m.staymo - m.vat).toBe(m.net);
    });
  });
  it("keeps each month's net within £1 of the model", () => {
    const out = breakdown(generateMonths(5880, 9555), RATES);
    out.months.forEach((m) => {
      expect(Math.abs(m.net - exactNet(m.rental))).toBeLessThanOrEqual(1);
    });
  });
  it("stays within £1 of the model across the range of estimates we serve", () => {
    for (let max = 1000; max <= 40000; max += 137) {
      breakdown(generateMonths(Math.round(max * 0.6), max), RATES).months.forEach((m) => {
        expect(Math.abs(m.net - exactNet(m.rental))).toBeLessThanOrEqual(1);
      });
    }
  });
  it("sums each row into its annual figure", () => {
    const out = breakdown(generateMonths(5880, 9555), RATES);
    rows.forEach((row) => {
      const sum = out.months.reduce((a, m) => a + m[row], 0);
      expect(out.annual[row]).toBe(sum);
    });
  });
  it("reconciles the annual column too, so the table adds up in both directions", () => {
    const a = breakdown(generateMonths(5880, 9555), RATES).annual;
    expect(a.rental - a.platform - a.staymo - a.vat).toBe(a.net);
  });
  it("returns whole pounds in every cell", () => {
    const out = breakdown(generateMonths(5880, 9555), RATES);
    [...out.months, out.annual].forEach((m) => {
      rows.forEach((row) => expect(Number.isInteger(m[row])).toBe(true));
    });
  });
  it("holds the annual net to the model too, within the half-pound a month the rounding can cost", () => {
    const out = breakdown(generateMonths(5880, 9555), RATES);
    expect(Math.abs(out.annual.net - exactNet(out.annual.rental))).toBeLessThanOrEqual(6);
  });
  it("returns instead of spinning on a figure or a rate that is not finite", () => {
    const months = generateMonths(5880, 9555);
    expect(breakdown([{ short: "X", full: "X", value: NaN }], RATES).months).toHaveLength(1);
    expect(breakdown([{ short: "X", full: "X", value: Infinity }], RATES).months).toHaveLength(1);
    expect(breakdown(months, { platform: NaN, staymo: 0.14, vat: 0.2 }).months).toHaveLength(12);
    expect(breakdown(months, { platform: 0.15, staymo: 0.14, vat: Infinity }).months).toHaveLength(12);
  });
  it("keeps to whole pounds even when the estimate arrives with pence", () => {
    const row = breakdown([{ short: "X", full: "X", value: 4200.5 }], RATES).months[0];
    rows.forEach((r) => expect(Number.isInteger(row[r])).toBe(true));
    expect(row.rental - row.platform - row.staymo - row.vat).toBe(row.net);
  });
  it("reproduces the owner's model on the mockup's own figure: £89,835 of rent leaves £63,531", () => {
    const out = breakdown([{ short: "Y", full: "Year", value: 89835 }], RATES);
    expect(out.annual).toEqual({
      rental: 89835,
      platform: 13475,
      staymo: 10691,
      vat: 2138,
      net: 63531,
    });
  });
  it("carries the month names through, so the table can label its own columns", () => {
    const out = breakdown(generateMonths(5880, 9555), RATES);
    expect(out.months[0].short).toBe("Feb");
    expect(out.months[5].full).toBe("July");
    expect(out.months[11].short).toBe("Jan");
  });
  it("falls back to the site's rates when called without any", () => {
    const months = generateMonths(5880, 9555);
    expect(breakdown(months)).toEqual(breakdown(months, RATES));
  });
  it("still reconciles on rates the Designer might type instead", () => {
    const out = breakdown(generateMonths(5880, 9555), { platform: 0.1, staymo: 0.12, vat: 0.2 });
    out.months.forEach((m) => {
      expect(m.rental - m.platform - m.staymo - m.vat).toBe(m.net);
      expect(Math.abs(m.net - exactNet(m.rental, { platform: 0.1, staymo: 0.12, vat: 0.2 })))
        .toBeLessThanOrEqual(1);
    });
  });
});

// The table the Designer builds in slice 3b: five rows of 12 months plus an Annual cell, with the
// fee rates as data-* on the root so they can be changed without a release.
function tableFixture({ rates = {}, rows: built = rows } = {}) {
  const root = document.createElement("div");
  root.setAttribute("data-breakdown", "table");
  const attrs = { platform: "0.15", staymo: "0.14", vat: "0.2", ...rates };
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== null) root.setAttribute("data-rate-" + name, value);
  }
  const cells = Array.from({ length: 12 }, () => `<span data-breakdown="cell"></span>`).join("");
  root.innerHTML =
    Array.from({ length: 12 }, () => `<span data-breakdown="xlabel"></span>`).join("") +
    built.map((row) => `<div data-breakdown="${row}"><span data-breakdown="pct">—</span>${cells}` +
      `<span data-breakdown="annual"></span></div>`).join("");
  document.body.appendChild(root);
  return root;
}

const cellsOf = (root, row) =>
  [...root.querySelector(`[data-breakdown="${row}"]`).querySelectorAll('[data-breakdown="cell"]')]
    .map((c) => c.textContent);
const annualOf = (root, row) =>
  root.querySelector(`[data-breakdown="${row}"]`).querySelector('[data-breakdown="annual"]').textContent;
const money = (text) => Number(text.replace(/[£,]/g, ""));
const pctOf = (root, row) =>
  root.querySelector(`[data-breakdown="${row}"]`).querySelector('[data-breakdown="pct"]').textContent;

describe("initBreakdown", () => {
  it("fills every row across the same 12 months the bars use, Feb to Jan", () => {
    const root = tableFixture();
    expect(initBreakdown(root, { min: 5880, max: 9555 })).toBe(true);
    const labels = [...root.querySelectorAll('[data-breakdown="xlabel"]')].map((l) => l.textContent);
    expect(labels).toEqual(generateMonths(5880, 9555).map((m) => m.short));
    expect(cellsOf(root, "rental")).toHaveLength(12);
  });
  it("writes pounds the way the mockup does: July's £9,555 of rent leaves £6,757", () => {
    const root = tableFixture();
    initBreakdown(root, { min: 5880, max: 9555 });
    expect(cellsOf(root, "rental")[5]).toBe("£9,555");
    expect(cellsOf(root, "net")[5]).toBe("£6,757");
    expect(cellsOf(root, "rental")[11]).toBe("£5,880");
  });
  it("renders a table that adds up: every column reconciles as displayed", () => {
    const root = tableFixture();
    initBreakdown(root, { min: 5880, max: 9555 });
    const byRow = Object.fromEntries(rows.map((row) => [row, cellsOf(root, row).map(money)]));
    for (let i = 0; i < 12; i++) {
      expect(byRow.rental[i] - byRow.platform[i] - byRow.staymo[i] - byRow.vat[i])
        .toBe(byRow.net[i]);
    }
  });
  it("renders an Annual that is the sum of its own row", () => {
    const root = tableFixture();
    initBreakdown(root, { min: 5880, max: 9555 });
    rows.forEach((row) => {
      expect(money(annualOf(root, row))).toBe(cellsOf(root, row).map(money).reduce((a, b) => a + b, 0));
    });
  });
  it("takes the rates off the table root, so they are editable in the Designer", () => {
    const root = tableFixture({ rates: { staymo: "0.12" } });
    initBreakdown(root, { min: 5880, max: 9555 });
    const expected = breakdown(generateMonths(5880, 9555), { platform: 0.15, staymo: 0.12, vat: 0.2 });
    expect(cellsOf(root, "staymo").map(money)).toEqual(expected.months.map((m) => m.staymo));
  });
  it("falls back to the site's rates when an attribute is missing or not a rate", () => {
    const root = tableFixture({ rates: { platform: null, staymo: "14%", vat: "-1" } });
    initBreakdown(root, { min: 5880, max: 9555 });
    const expected = breakdown(generateMonths(5880, 9555));
    rows.forEach((row) => {
      expect(cellsOf(root, row).map(money)).toEqual(expected.months.map((m) => m[row]));
    });
  });
  it("writes each fee's rate into its own label, so a rate changed in the Designer cannot leave the label lying", () => {
    const root = tableFixture();
    initBreakdown(root, { min: 5880, max: 9555 });
    expect([pctOf(root, "platform"), pctOf(root, "staymo"), pctOf(root, "vat")])
      .toEqual(["15%", "14%", "20%"]);
  });
  it("follows the rate the Designer typed", () => {
    const root = tableFixture({ rates: { staymo: "0.12" } });
    initBreakdown(root, { min: 5880, max: 9555 });
    expect(pctOf(root, "staymo")).toBe("12%");
  });
  it("spells a fractional rate without the floating-point dust", () => {
    const root = tableFixture({ rates: { staymo: "0.125" } });
    initBreakdown(root, { min: 5880, max: 9555 });
    expect(pctOf(root, "staymo")).toBe("12.5%");
  });
  it("labels the fallback rate, not the unusable attribute, so label and figures agree", () => {
    const root = tableFixture({ rates: { staymo: "12" } });
    initBreakdown(root, { min: 5880, max: 9555 });
    expect(pctOf(root, "staymo")).toBe("14%");
  });
  it("leaves the rows that carry no rate — rental and net — as the Designer wrote them", () => {
    const root = tableFixture();
    initBreakdown(root, { min: 5880, max: 9555 });
    expect([pctOf(root, "rental"), pctOf(root, "net")]).toEqual(["—", "—"]);
  });
  it("hides the table and reports false when there is no estimate to break down", () => {
    const root = tableFixture();
    expect(initBreakdown(root, { min: 0, max: 0 })).toBe(false);
    expect(root.style.display).toBe("none");
  });
  it("treats an estimate that is not a finite number as no estimate at all", () => {
    const root = tableFixture();
    expect(initBreakdown(root, { min: 0, max: "Infinity" })).toBe(false);
    expect(root.style.display).toBe("none");
    expect(cellsOf(root, "rental")[5]).toBe("");
  });
  it("clears display instead of forcing block, so the Designer's display applies", () => {
    const root = tableFixture();
    initBreakdown(root, { min: 0, max: 0 });
    initBreakdown(root, { min: 5880, max: 9555 });
    expect(root.style.display).toBe("");
  });
  it("overwrites on a second init rather than leaving the first estimate behind", () => {
    const root = tableFixture();
    initBreakdown(root, { min: 5880, max: 9555 });
    initBreakdown(root, { min: 8000, max: 12400 });
    expect(cellsOf(root, "rental")[5]).toBe("£12,400");
    expect(cellsOf(root, "rental")).toHaveLength(12);
  });
  it("skips a row the Designer has not built yet instead of throwing", () => {
    const root = tableFixture({ rows: ["rental", "net"] });
    expect(initBreakdown(root, { min: 5880, max: 9555 })).toBe(true);
    expect(cellsOf(root, "net")[5]).toBe("£6,757");
  });
  it("reports false when the page has no breakdown table at all", () => {
    expect(initBreakdown(null, { min: 5880, max: 9555 })).toBe(false);
  });
});

// The four tiles above the chart (mockup 6287:99573). Owner's call 2026-09-17: every figure comes from
// the same 12 months as the bars, so the tiles, the tooltip and the table can never disagree.
describe("stats", () => {
  it("totals the net exactly as the table's Annual net does", () => {
    const months = generateMonths(5880, 9555);
    expect(stats(months).net).toBe(breakdown(months).annual.net);
    expect(stats(months).net).toBe(72349);
  });
  it("follows the rates it is given, as the table does", () => {
    const months = generateMonths(5880, 9555);
    const rates = { platform: 0.15, staymo: 0.12, vat: 0.2 };
    expect(stats(months, rates).net).toBe(breakdown(months, rates).annual.net);
    expect(stats(months, rates).net).toBe(74436);
  });
  it("averages occupancy over the 12 months, rounded to a whole percent", () => {
    expect(stats(generateMonths(5880, 9555)).occupancy).toBe(88); // 1061 / 12 = 88.42
  });
  it("prices a night as the year's rent over the nights booked, not as a mean of monthly prices", () => {
    expect(stats(generateMonths(5880, 9555)).nightly).toBe(321); // 102,305 / 318.3
    expect(stats(generateMonths(8000, 12400)).nightly).toBe(418); // 133,134 / 318.3
    // Where the rules part: the mean of the monthly perNight figures gives 402, flooring gives 405.
    expect(stats(generateMonths(4000, 12400)).nightly).toBe(406); // 129,134 / 318.3 = 405.70
  });
  it("names the month of the highest bar", () => {
    expect(stats(generateMonths(5880, 9555)).peak).toBe("Jul");
  });
  it("reads peak and occupancy off the months it is handed, not off the seasonal table", () => {
    const m = (short, rate, value) => ({ short, full: short, rate, value });
    const s = stats([m("Mar", 99, 1000), m("Aug", 50, 3000), m("Sep", 72, 2000)]);
    expect(s.peak).toBe("Aug");
    expect(s.occupancy).toBe(74); // 221 / 3 = 73.67
  });
});

// The tile row as the Designer builds it: a root carrying data-stats and a value node per figure.
function statsFixture({ hooks = ["net", "occupancy", "nightly", "peak"] } = {}) {
  const root = document.createElement("div");
  root.setAttribute("data-stats", "estimate");
  root.innerHTML = hooks.map((h) => `<div><div>label</div><div data-stat="${h}">—</div></div>`).join("");
  document.body.appendChild(root);
  return root;
}

const statOf = (root, name) => root.querySelector(`[data-stat="${name}"]`).textContent;

describe("initStats", () => {
  it("writes the four tiles the way the mockup spells them", () => {
    const root = statsFixture();
    expect(initStats(root, { min: 5880, max: 9555 })).toBe(true);
    expect(["net", "occupancy", "nightly", "peak"].map((h) => statOf(root, h)))
      .toEqual(["£72,349", "88%", "£321/night", "Jul"]);
  });
  it("uses the rates handed in, so the net tile matches a table whose rate was changed", () => {
    const root = statsFixture();
    initStats(root, { min: 5880, max: 9555, rates: { platform: 0.15, staymo: 0.12, vat: 0.2 } });
    expect(statOf(root, "net")).toBe("£74,436");
  });
  it("hides the row and reports false when there is no estimate", () => {
    const root = statsFixture();
    expect(initStats(root, { min: 0, max: 0 })).toBe(false);
    expect(root.style.display).toBe("none");
    expect(statOf(root, "net")).toBe("—");
  });
  it("treats an estimate that is not a finite number as no estimate at all", () => {
    const root = statsFixture();
    expect(initStats(root, { min: 0, max: "Infinity" })).toBe(false);
    expect(root.style.display).toBe("none");
    expect(statOf(root, "nightly")).toBe("—");
  });
  it("clears display instead of forcing block, so the Designer's display applies", () => {
    const root = statsFixture();
    initStats(root, { min: 0, max: 0 });
    initStats(root, { min: 5880, max: 9555 });
    expect(root.style.display).toBe("");
  });
  it("overwrites on a second init rather than leaving the first estimate behind", () => {
    const root = statsFixture();
    initStats(root, { min: 5880, max: 9555 });
    initStats(root, { min: 8000, max: 12400 });
    expect(statOf(root, "net")).toBe("£94,154");
    expect(statOf(root, "nightly")).toBe("£418/night");
  });
  it("groups thousands in the nightly figure, as in the net tile", () => {
    const root = statsFixture();
    initStats(root, { min: 30000, max: 45000 });
    expect(statOf(root, "nightly")).toBe("£1,521/night");
  });
  it("skips a tile the Designer has not built instead of throwing", () => {
    const root = statsFixture({ hooks: ["net", "peak"] });
    expect(initStats(root, { min: 5880, max: 9555 })).toBe(true);
    expect(statOf(root, "peak")).toBe("Jul");
  });
  it("reports false when the page has no tile row at all", () => {
    expect(initStats(null, { min: 5880, max: 9555 })).toBe(false);
  });
});

// The card header's segmented control from the mockup: two segments over two panels, each panel
// carrying its own heading. Which one opens is the markup's call, so the Designer keeps the default.
function tabsFixture({ active = "chart", panels = ["chart", "breakdown"] } = {}) {
  const root = document.createElement("div");
  root.setAttribute("data-tabs", "estimate");
  const on = (name) => (name === active ? ' class="is-active"' : "");
  root.innerHTML =
    `<div data-tablist>` +
      `<a href="#" data-tab="chart"${on("chart")}>Income overview</a>` +
      `<a href="#" data-tab="breakdown"${on("breakdown")}>Detailed breakdown</a>` +
    `</div>` +
    panels.map((p) => `<div data-tabpanel="${p}"${on(p)}>${p} panel</div>`).join("");
  document.body.appendChild(root);
  return root;
}

const tabsOf = (root) => [...root.querySelectorAll("[data-tab]")];
const panelOf = (root, name) => root.querySelector(`[data-tabpanel="${name}"]`);
const selected = (root) =>
  tabsOf(root).filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.getAttribute("data-tab"));
const shown = (root) =>
  [...root.querySelectorAll("[data-tabpanel]")].filter((p) => p.classList.contains("is-active"))
    .map((p) => p.getAttribute("data-tabpanel"));
const clickOn = (el) => {
  const e = new MouseEvent("click", { bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
};
const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

describe("initTabs", () => {
  it("states the markup's open tab for assistive tech instead of overriding it", () => {
    const root = tabsFixture({ active: "breakdown" });
    expect(initTabs(root)).toBe(true);
    expect(root.querySelector("[data-tablist]").getAttribute("role")).toBe("tablist");
    expect(tabsOf(root).map((t) => t.getAttribute("role"))).toEqual(["tab", "tab"]);
    expect(panelOf(root, "chart").getAttribute("role")).toBe("tabpanel");
    expect(selected(root)).toEqual(["breakdown"]);
    expect(shown(root)).toEqual(["breakdown"]);
  });
  it("opens on the first tab when the markup marks none", () => {
    const root = tabsFixture({ active: "none" });
    initTabs(root);
    expect(selected(root)).toEqual(["chart"]);
    expect(shown(root)).toEqual(["chart"]);
  });
  it("swaps panel and segment together on a click, leaving exactly one of each open", () => {
    const root = tabsFixture();
    initTabs(root);
    clickOn(tabsOf(root)[1]);
    expect(selected(root)).toEqual(["breakdown"]);
    expect(shown(root)).toEqual(["breakdown"]);
    expect(tabsOf(root)[1].classList.contains("is-active")).toBe(true);
    expect(tabsOf(root)[0].classList.contains("is-active")).toBe(false);
  });
  it("swallows the click so a segment built as a link cannot jump the page", () => {
    const root = tabsFixture();
    initTabs(root);
    expect(clickOn(tabsOf(root)[1]).defaultPrevented).toBe(true);
  });
  it("keeps only the open tab in the tab order, as a segmented control should", () => {
    const root = tabsFixture();
    initTabs(root);
    expect(tabsOf(root).map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1"]);
    clickOn(tabsOf(root)[1]);
    expect(tabsOf(root).map((t) => t.getAttribute("tabindex"))).toEqual(["-1", "0"]);
  });
  it("moves the selection with the arrow keys and wraps around the ends", () => {
    const root = tabsFixture();
    initTabs(root);
    const [chart, bd] = tabsOf(root);
    chart.focus();
    key(chart, "ArrowRight");
    expect(selected(root)).toEqual(["breakdown"]);
    expect(document.activeElement).toBe(bd);
    key(bd, "ArrowRight");
    expect(selected(root)).toEqual(["chart"]);
    expect(document.activeElement).toBe(chart);
    key(chart, "ArrowLeft");
    expect(selected(root)).toEqual(["breakdown"]);
  });
  it("leaves other keys to the browser", () => {
    const root = tabsFixture();
    initTabs(root);
    expect(key(tabsOf(root)[0], "Tab")).toBe(true);
    expect(selected(root)).toEqual(["chart"]);
  });
  it("binds no second set of listeners on re-init and keeps the tab the visitor chose", () => {
    const root = tabsFixture();
    const onRoot = vi.spyOn(root, "addEventListener");
    initTabs(root);
    const bound = onRoot.mock.calls.length;
    clickOn(tabsOf(root)[1]);
    initTabs(root);
    expect(onRoot.mock.calls.length).toBe(bound);
    expect(selected(root)).toEqual(["breakdown"]);
    expect(shown(root)).toEqual(["breakdown"]);
  });
  it("opens the first segment that has a panel when the markup's chosen one is missing", () => {
    const root = tabsFixture({ active: "breakdown", panels: ["chart"] });
    expect(initTabs(root)).toBe(true);
    expect(selected(root)).toEqual(["chart"]);
    expect(shown(root)).toEqual(["chart"]);
  });
  it("refuses a switcher with no panels at all rather than leaving a tablist of unmarked segments", () => {
    const root = tabsFixture({ panels: [] });
    expect(initTabs(root)).toBe(false);
    expect(root.querySelector("[data-tablist]").getAttribute("role")).toBe(null);
    expect(tabsOf(root).map((t) => t.getAttribute("role"))).toEqual([null, null]);
  });
  it("points each segment at the panel it opens, and names that panel by its segment", () => {
    const root = tabsFixture();
    initTabs(root);
    const chart = tabsOf(root)[0];
    const panel = panelOf(root, "chart");
    expect(panel.id).toBeTruthy();
    expect(chart.id).toBeTruthy();
    expect(chart.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(chart.id);
  });
  it("keeps the ids the Designer set instead of minting over them", () => {
    const root = tabsFixture();
    panelOf(root, "chart").id = "given-panel";
    tabsOf(root)[0].id = "given-tab";
    initTabs(root);
    expect(tabsOf(root)[0].getAttribute("aria-controls")).toBe("given-panel");
    expect(panelOf(root, "chart").getAttribute("aria-labelledby")).toBe("given-tab");
  });
  it("puts the closed panel out of reach of assistive tech, whatever CSS the Designer gave it", () => {
    const root = tabsFixture();
    initTabs(root);
    expect(panelOf(root, "breakdown").hasAttribute("inert")).toBe(true);
    expect(panelOf(root, "chart").hasAttribute("inert")).toBe(false);
    clickOn(tabsOf(root)[1]);
    expect(panelOf(root, "chart").hasAttribute("inert")).toBe(true);
    expect(panelOf(root, "breakdown").hasAttribute("inert")).toBe(false);
  });
  it("lets the keyboard step into the open panel and keeps the closed one out of the tab order", () => {
    const root = tabsFixture();
    initTabs(root);
    expect(panelOf(root, "chart").getAttribute("tabindex")).toBe("0");
    expect(panelOf(root, "breakdown").getAttribute("tabindex")).toBe("-1");
  });
  it("ignores a segment whose panel the Designer has not built yet", () => {
    const root = tabsFixture({ panels: ["chart"] });
    initTabs(root);
    clickOn(tabsOf(root)[1]);
    expect(shown(root)).toEqual(["chart"]);
  });
  it("reports false when the page has no switcher", () => {
    expect(initTabs(null)).toBe(false);
    expect(initTabs(document.createElement("div"))).toBe(false);
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
  it("window.initChart also fills the table and states the switcher, in the one call the funnel makes", () => {
    fixture();
    const table = tableFixture();
    const tabs = tabsFixture();
    expect(window.initChart(5880, 9555)).toBe(true);
    expect(cellsOf(table, "rental")[5]).toBe("£9,555");
    expect(selected(tabs)).toEqual(["chart"]);
  });
  it("gives the table the very figures the bars carry, month for month", () => {
    const root = fixture();
    const table = tableFixture();
    window.initChart(5880, 9555);
    const bars = all(root, "col").map((c) => Number(c.getAttribute("data-value")));
    expect(cellsOf(table, "rental").map(money)).toEqual(bars);
  });
  it("window.initChart fills the tile row too, in the same call", () => {
    fixture();
    const row = statsFixture();
    window.initChart(5880, 9555);
    expect(statOf(row, "net")).toBe("£72,349");
    expect(statOf(row, "peak")).toBe("Jul");
  });
  it("gives the net tile the table's own rates, so it always equals the table's Annual net", () => {
    fixture();
    const table = tableFixture({ rates: { staymo: "0.12" } });
    const row = statsFixture();
    window.initChart(5880, 9555);
    expect(statOf(row, "net")).toBe(annualOf(table, "net"));
    expect(statOf(row, "net")).toBe("£74,436");
  });
  it("draws the table and the tiles from the API's own strings, one figure between them", () => {
    fixture();
    const table = tableFixture();
    const row = statsFixture();
    window.initChart("£5,880", "9,555");
    expect(annualOf(table, "net")).toBe("£72,349");
    expect(statOf(row, "net")).toBe("£72,349");
    expect(statOf(row, "nightly")).toBe("£321/night");
  });
  it("names the same peak month the chart opens on", () => {
    const root = fixture();
    const row = statsFixture();
    window.initChart(8000, 12400);
    expect(statOf(row, "peak")).toBe(all(root, "col")[activeIndex(root)].getAttribute("data-month").slice(0, 3));
  });
  it("labels the table's columns with the same months as the axis", () => {
    const root = fixture();
    const table = tableFixture();
    window.initChart(5880, 9555);
    expect([...table.querySelectorAll('[data-breakdown="xlabel"]')].map((l) => l.textContent))
      .toEqual(all(root, "xlabel").map((l) => l.textContent));
  });
});
