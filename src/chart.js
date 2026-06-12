/* Native earnings bar chart — no chart library.
   JS binds to data-chart="…" hooks only; classes stay styling-only.
   Deterministic 12-bar illustration from min/max + a fixed seasonal weight. */

const RATE  = [72, 78, 83, 91, 93, 95, 98, 95, 88, 88, 84, 96]; // Jan..Dec seasonal weight
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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

export function generateMonths(min, max, nowMonth = new Date().getMonth()) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const m = (nowMonth + i) % 12;
    const value =
      SHORT[m] === "Jul" ? max
      : SHORT[m] === "Jan" ? min
      : Math.floor((max * RATE[m]) / 98);
    out.push({ short: SHORT[m], full: FULL[m], rate: RATE[m], value });
  }
  return out;
}

export function initEarningsChart(root, { min, max, nowMonth } = {}) {
  if (!root) return false;
  const mn = clean(min), mx = clean(max);
  if (!mx) {
    root.style.display = "none";
    return false;
  }
  root.style.display = "block";
  const g = graphMax(mx);
  const data = generateMonths(mn, mx, nowMonth);
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
  // "Long-term rental" baseline — proxy = min month until backend provides a real figure.
  const base = root.querySelector('[data-chart="baseline"]');
  if (base) base.style.bottom = (mn / g) * 100 + "%";
  return true;
}

// Backward-compat shim: existing valuation code calls window.initChart(min, max).
if (typeof window !== "undefined") {
  window.initChart = function (min, max) {
    return initEarningsChart(document.querySelector("#chart-container"), { min, max });
  };
}
