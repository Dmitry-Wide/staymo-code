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

// The fee model behind the breakdown table (owner's call 2026-09-15): the booking platform takes
// its cut of the rent, Staymo's fee is charged on what is left, and VAT rides on that fee, so
// net = rental × (1 − platform) × (1 − staymo × (1 + vat)).
const FEES = { platform: 0.15, staymo: 0.14, vat: 0.2 };

// The three deductions for one month, in whole pounds and summing to the rounded total deduction.
// Rounding each on its own would let the net drift £1.50 from the model, so the residual between
// their sum and that total goes to whichever deduction lost the most to rounding — which keeps
// every net within 50p of the model while each deduction stays within £1 of its own exact figure.
function deductions(rental, rates) {
  const afterPlatform = rental * (1 - rates.platform);
  const exact = [rental * rates.platform, afterPlatform * rates.staymo,
                 afterPlatform * rates.staymo * rates.vat];
  const cut = exact.map((n) => Math.round(n));
  let drift = Math.round(exact[0] + exact[1] + exact[2]) - (cut[0] + cut[1] + cut[2]);
  // A figure or a rate that is not a number leaves drift NaN, and `drift !== 0` is true of NaN for
  // ever: the loop below would freeze the tab, synchronously, past any timeout. Hand the rounding
  // back unadjusted instead and let the bad number show itself.
  if (!Number.isFinite(drift)) return cut;
  while (drift !== 0) {
    const step = Math.sign(drift);
    let give = 0;
    for (let j = 1; j < cut.length; j++) {
      if (step * (exact[j] - cut[j]) > step * (exact[give] - cut[give])) give = j;
    }
    cut[give] += step;
    drift -= step;
  }
  return cut;
}

// Months -> the table's five rows. The net is what is left after subtracting the deductions and
// Annual is the sum of a row, so a column and a row can never disagree with each other.
export function breakdown(months, rates = FEES) {
  const out = months.map((m) => {
    // Whole pounds, in the one place both the rental and the net are built from: generateMonths
    // floors ten of the twelve months but hands July and January the estimate as it came, and that
    // estimate is the valuation API's, not ours. A figure that is no number at all draws £0.
    const rental = Number.isFinite(m.value) ? Math.round(m.value) : 0;
    const [platform, staymo, vat] = deductions(rental, rates);
    return { short: m.short, full: m.full, rental, platform, staymo, vat,
             net: rental - platform - staymo - vat };
  });
  const annual = { rental: 0, platform: 0, staymo: 0, vat: 0, net: 0 };
  out.forEach((m) => { for (const row in annual) annual[row] += m[row]; });
  return { months: out, annual };
}

// Every selector and attribute name below is spelled out in full: the contract generator reads the
// literals out of this file, so a built-up name would leave the table out of the attribute contract
// and put a placeholder in its place.
const ROWS = {
  rental: '[data-breakdown="rental"]',
  platform: '[data-breakdown="platform"]',
  staymo: '[data-breakdown="staymo"]',
  vat: '[data-breakdown="vat"]',
  net: '[data-breakdown="net"]',
};

// Rates ride on the table root so they can be changed in the Designer without a release. Anything
// that is not a fraction — blank, "14%", a percentage typed whole — falls back to the site's rate.
function feeRates(root) {
  const pick = (raw, fallback) => {
    const n = parseFloat(raw);
    return n >= 0 && n < 1 ? n : fallback;
  };
  return {
    platform: pick(root.getAttribute("data-rate-platform"), FEES.platform),
    staymo: pick(root.getAttribute("data-rate-staymo"), FEES.staymo),
    vat: pick(root.getAttribute("data-rate-vat"), FEES.vat),
  };
}

// 0.15 -> "15%", 0.125 -> "12.5%". A row's label has to quote the rate its own figures were built
// from, and 0.14 × 100 is 14.000000000000002, so the dust is trimmed instead of printed.
const percent = (rate) => +(rate * 100).toFixed(2) + "%";

// The table is drawn from the same generateMonths call as the bars, so its figures are the bars'
// figures by construction rather than by a second model kept in step by hand.
export function initBreakdown(root, { min, max, startMonth } = {}) {
  if (!root) return false;
  const mx = clean(max);
  // clean() lets "Infinity" through as Infinity, and the funnel hands us the API's field untouched.
  // A table of "£Infinity" is worse than no table, so an unusable estimate counts as none.
  if (!mx || !Number.isFinite(mx)) {
    root.style.display = "none";
    return false;
  }
  root.style.display = "";
  const data = generateMonths(clean(min), mx, startMonth);
  const rates = feeRates(root);
  const table = breakdown(data, rates);
  const labels = root.querySelectorAll('[data-breakdown="xlabel"]');
  data.forEach((m, i) => { if (labels[i]) labels[i].textContent = m.short; });
  for (const row in ROWS) {
    const line = root.querySelector(ROWS[row]);
    if (!line) continue;
    // The three fee rows quote their rate; rental and net have none and keep the Designer's text.
    const pct = line.querySelector('[data-breakdown="pct"]');
    if (pct && row in rates) pct.textContent = percent(rates[row]);
    const cells = line.querySelectorAll('[data-breakdown="cell"]');
    table.months.forEach((m, i) => { if (cells[i]) cells[i].textContent = "£" + fmt(m[row]); });
    const annual = line.querySelector('[data-breakdown="annual"]');
    if (annual) annual.textContent = "£" + fmt(table.annual[row]);
  }
  return true;
}

// The four figures over the chart (owner's call 2026-09-17), taken from the months the bars draw, so
// no tile can disagree with a bar, the tooltip or the table. Occupancy is the mean of the months' rates
// (every month counts 30 nights, as in perNight), and a night is the year's rent over the nights booked.
export function stats(months, rates) {
  const table = breakdown(months, rates);
  const nights = months.reduce((sum, m) => sum + (30 * m.rate) / 100, 0);
  return {
    net: table.annual.net,
    occupancy: Math.round(months.reduce((sum, m) => sum + m.rate, 0) / months.length),
    nightly: nights > 0 ? Math.round(table.annual.rental / nights) : 0,
    peak: months[peakIndex(months)].short,
  };
}

// Spelled out in full for the contract generator, like ROWS.
const STATS = {
  net: '[data-stat="net"]',
  occupancy: '[data-stat="occupancy"]',
  nightly: '[data-stat="nightly"]',
  peak: '[data-stat="peak"]',
};

// Rates are handed in by whoever owns them — today the table root — so the net tile and the table's
// Annual net are one figure.
export function initStats(root, { min, max, startMonth, rates } = {}) {
  if (!root) return false;
  const mx = clean(max);
  if (!mx || !Number.isFinite(mx)) {
    root.style.display = "none";
    return false;
  }
  root.style.display = "";
  const s = stats(generateMonths(clean(min), mx, startMonth), rates);
  const text = {
    net: "£" + fmt(s.net),
    occupancy: s.occupancy + "%",
    nightly: "£" + fmt(s.nightly) + "/night",
    peak: s.peak,
  };
  for (const name in STATS) {
    const el = root.querySelector(STATS[name]);
    if (el) el.textContent = text[name];
  }
  return true;
}

// root -> true. Like the chart, listeners are bound once per root; a re-init only restates.
const tabbed = new WeakMap();

// Panels are shown by class, so how a panel appears stays in Webflow. The closed one has to be
// display:none there: anything else leaves it in the reading order with the open one.
function showTab(root, name) {
  const panels = [...root.querySelectorAll("[data-tabpanel]")];
  const panelFor = (key) => panels.find((p) => p.getAttribute("data-tabpanel") === key);
  // A segment whose panel nobody has built yet leaves the card as it is — and says so, so that init
  // can fall back instead of reporting a switcher it never actually wired.
  if (!panelFor(name)) return false;
  root.querySelectorAll("[data-tab]").forEach((tab) => {
    const open = tab.getAttribute("data-tab") === name;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", open ? "true" : "false");
    // One stop for the whole control: the arrow keys move between the segments inside it.
    tab.setAttribute("tabindex", open ? "0" : "-1");
    tab.classList.toggle("is-active", open);
    // Tie each segment to its own panel. Ids are minted only where the Designer left none.
    const own = panelFor(tab.getAttribute("data-tab"));
    if (!own) return;
    if (!tab.id) tab.id = "sh-tab-" + tab.getAttribute("data-tab");
    if (!own.id) own.id = "sh-panel-" + own.getAttribute("data-tabpanel");
    tab.setAttribute("aria-controls", own.id);
    own.setAttribute("aria-labelledby", tab.id);
  });
  panels.forEach((p) => {
    const open = p.getAttribute("data-tabpanel") === name;
    p.setAttribute("role", "tabpanel");
    // Neither panel holds anything focusable of its own, so the open one takes a stop of its own.
    p.setAttribute("tabindex", open ? "0" : "-1");
    // inert rather than a note asking the Designer to remember display:none — the closed panel then
    // leaves the tab order and the screen reader whatever CSS it ends up with.
    p.toggleAttribute("inert", !open);
    p.classList.toggle("is-active", open);
  });
  return true;
}

// The card's segmented control. Which tab opens is the markup's call — on a re-init that is also
// the visitor's last choice, so a fresh estimate does not throw them back to the chart.
export function initTabs(root) {
  if (!root) return false;
  const list = root.querySelector("[data-tablist]");
  const tabs = [...root.querySelectorAll("[data-tab]")];
  if (!list || !tabs.length) return false;
  // The markup's own choice opens — on a re-init that is the visitor's last one — and if its panel
  // is missing, the first segment that has one. A switcher with no panels is left unmarked rather
  // than announced as a tablist whose segments are not tabs.
  const order = [tabs.find((t) => t.classList.contains("is-active")), ...tabs].filter(Boolean);
  if (!order.some((t) => showTab(root, t.getAttribute("data-tab")))) return false;
  list.setAttribute("role", "tablist");
  if (!tabbed.has(root)) {
    tabbed.set(root, true);
    root.addEventListener("click", (e) => {
      const tab = e.target.closest && e.target.closest("[data-tab]");
      if (!tab) return;
      e.preventDefault(); // a segment built as a link would otherwise jump the page
      showTab(root, tab.getAttribute("data-tab"));
    });
    root.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      const tab = step && e.target.closest && e.target.closest("[data-tab]");
      if (!tab) return;
      e.preventDefault();
      const all = [...root.querySelectorAll("[data-tab]")];
      const next = all[(all.indexOf(tab) + step + all.length) % all.length];
      showTab(root, next.getAttribute("data-tab"));
      next.focus();
    });
  }
  return true;
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
// baseline is gone from the chart, so the third argument is ignored. The result screen's other
// pieces are drawn from the same call — the funnel makes no other — and the same min/max reach the
// table and the tiles, so their figures cannot drift from the bars. The return value stays the
// chart's: a page without a table, tiles or a switcher is the estimator as it stood before.
if (typeof window !== "undefined") {
  window.initChart = function (min, max) {
    const drawn = initEarningsChart(document.querySelector("#chart-container"), { min, max });
    const table = document.querySelector('[data-breakdown="table"]');
    initBreakdown(table, { min, max });
    initStats(document.querySelector("[data-stats]"), { min, max, rates: table ? feeRates(table) : undefined });
    initTabs(document.querySelector("[data-tabs]"));
    return drawn;
  };
}
