/* Native earnings bar chart — no chart library.
   JS binds to data-chart="…" hooks only; classes stay styling-only. The one class it writes is
   the is-active state on the highlighted bar — how that state looks is set in Webflow.
   Deterministic 12-bar illustration from min/max + a fixed seasonal weight. */

const RATE  = [72, 78, 83, 91, 93, 95, 98, 95, 88, 88, 84, 96]; // Jan..Dec seasonal weight
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// The 12 bars are a fixed seasonal illustration, not a forecast from today, so the axis starts
// on a fixed month rather than the current one: February puts the July peak mid-chart and the
// January trough last, which is the shape the axis was drawn for. Owner's call 2026-09-04.
const START_MONTH = 1; // February
const FULL  = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function clean(n) {
  return Number(String(n).replace(/[,£\s]/g, "")) || 0;
}

export function graphMax(mx) {
  return Math.ceil((mx * 1.02) / 1000) * 1000;
}

export function fmt(n) {
  return Number(n).toLocaleString("en-GB");
}

export function generateMonths(min, max, startMonth = START_MONTH) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const m = (startMonth + i) % 12;
    const value =
      SHORT[m] === "Jul" ? max
      : SHORT[m] === "Jan" ? min
      : Math.floor((max * RATE[m]) / 98);
    out.push({ short: SHORT[m], full: FULL[m], rate: RATE[m], value });
  }
  return out;
}

// The chart opens on its highest month — found, not assumed to sit in a fixed slot, so another
// axis start or seasonal table still lands on the peak. Ties keep the first.
export function peakIndex(data) {
  let peak = 0;
  for (let i = 1; i < data.length; i++) if (data[i].value > data[peak].value) peak = i;
  return peak;
}

// Nightly figure behind a month: its income over the nights it is booked (30 × occupancy).
export function perNight(value, rate) {
  return rate > 0 ? Math.round(value / ((30 * rate) / 100)) : 0;
}

// Shift that brings [left, right] back inside [min, max]; 0 when it already fits. A box wider
// than the bounds is pinned to the start edge.
export function clampShift(left, right, min, max) {
  if (left < min || right - left > max - min) return min - left;
  if (right > max) return max - right;
  return 0;
}

// root -> { peak }. Listeners are bound once per root; a re-init only moves the peak.
const charts = new WeakMap();

// Keep the tooltip inside the chart. CSS centres it on its bar; near an edge it is pulled back
// in and the arrow moves the other way, so it still points at the bar. A hidden chart measures
// 0 wide: it keeps its last shift, and the ResizeObserver pins again once it is shown.
function pin(root) {
  const tip = root.querySelector('[data-chart="tooltip"]');
  if (!tip) return;
  const box = root.getBoundingClientRect();
  if (!box.width) return;
  const arrow = tip.querySelector('[data-chart="tooltip-arrow"]');
  tip.style.translate = "";
  if (arrow) arrow.style.translate = "";
  const t = tip.getBoundingClientRect();
  const dx = clampShift(t.left, t.right, box.left, box.right);
  if (!dx) return;
  tip.style.translate = dx + "px";
  if (arrow) arrow.style.translate = -dx + "px";
}

// Highlight bar i and move the tooltip into it. CSS parks the tooltip on the bar's top edge
// (bottom: 100%), so it rides every height change — the intro grow included — with no maths here.
function activate(root, i) {
  const col = root.querySelectorAll('[data-chart="col"]')[i];
  const bars = root.querySelectorAll('[data-chart="bar"]');
  const bar = bars[i];
  if (!col || !bar) return;
  bars.forEach((b, j) => b.classList.toggle("is-active", j === i));
  const tip = root.querySelector('[data-chart="tooltip"]');
  if (!tip) return;
  const v = +col.getAttribute("data-value");
  const r = +col.getAttribute("data-rate");
  const title = tip.querySelector('[data-chart="tooltip-title"]');
  const sub = tip.querySelector('[data-chart="tooltip-sub"]');
  if (title) title.textContent = col.getAttribute("data-month") + " · £" + fmt(v);
  if (sub) sub.textContent = r + "% occupancy · £" + fmt(perNight(v, r)) + "/night";
  if (tip.parentNode !== bar) bar.appendChild(tip);
  pin(root);
}

// Mouse hover and a tap both move the highlight; the mouse leaving the chart puts it back on the
// peak. Touch ignores hover (pointerover also fires when a scroll starts on the chart) and waits
// for the tap. A lifted finger fires pointerleave before the click lands, so touch leaves are
// ignored too — otherwise every tap would flash back to the peak first.
function bind(root, chart) {
  const pick = (e) => {
    const col = e.target.closest && e.target.closest('[data-chart="col"]');
    const i = col ? [...root.querySelectorAll('[data-chart="col"]')].indexOf(col) : -1;
    if (i >= 0) activate(root, i);
  };
  root.addEventListener("pointerover", (e) => { if (e.pointerType !== "touch") pick(e); });
  root.addEventListener("click", pick);
  root.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") activate(root, chart.peak); });
  // Pin again whenever the chart's box changes: a resize, or being shown after it was hidden.
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => pin(root)).observe(root);
}

export function initEarningsChart(root, { min, max, startMonth } = {}) {
  if (!root) return false;
  const mn = clean(min), mx = clean(max);
  if (!mx) {
    root.style.display = "none";
    return false;
  }
  // Clear rather than force "block": the display set in the Designer applies.
  root.style.display = "";
  const g = graphMax(mx);
  const data = generateMonths(mn, mx, startMonth);
  const bars   = root.querySelectorAll('[data-chart="bar"]');
  const cols   = root.querySelectorAll('[data-chart="col"]');
  const xlabel = root.querySelectorAll('[data-chart="xlabel"]');
  for (let i = 0; i < 12; i++) {
    const d = data[i];
    if (bars[i])   bars[i].style.height = Math.max(2, (d.value / g) * 100) + "%";
    if (xlabel[i]) xlabel[i].textContent = d.short;
    if (cols[i]) {
      cols[i].setAttribute("data-month", d.full);
      cols[i].setAttribute("data-value", d.value);
      cols[i].setAttribute("data-rate", d.rate);
    }
  }
  const yt = root.querySelectorAll('[data-chart="ytick"]');
  const n = yt.length;
  for (let j = 0; j < n; j++) {
    const val = Math.round((g * (n - j)) / n);
    yt[j].textContent = "£ " + (val >= 1000 ? val / 1000 + "k" : val);
  }

  let chart = charts.get(root);
  if (!chart) {
    chart = {};
    charts.set(root, chart);
    bind(root, chart);
  }
  chart.peak = peakIndex(data);
  activate(root, chart.peak);
  return true;
}

// Backward-compat shim: valuation code calls window.initChart(min, max, longTerm). The long-term
// baseline is gone from the chart, so the third argument is ignored.
if (typeof window !== "undefined") {
  window.initChart = function (min, max) {
    return initEarningsChart(document.querySelector("#chart-container"), { min, max });
  };
}
