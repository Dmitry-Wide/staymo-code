/* Bedrooms from the URL before first paint — NOT loaded from jsDelivr: the
   Webflow page pastes the code below as an inline <script> right after the
   [data-rooms] tiles. Module scripts (prelead.js) run only after the whole page
   is parsed, which is after first paint, so the markup's default tile showed
   first and ?beds=N switched it a beat later. This only moves the
   is-bed-selected mark, with prelead.js's clamp (last matching tile wins);
   prelead.js still writes [data-rooms-input] and the goal. */
(function () {
  try {
    var beds = new URLSearchParams(location.search).get("beds");
    var container = document.querySelector("[data-rooms]");
    if (!beds || !container) return;
    var asked = Number(beds.trim());
    if (!isFinite(asked)) return;
    var tiles = [].slice.call(container.querySelectorAll("[data-room]"));
    var values = tiles.map(function (t) { return Number(t.getAttribute("data-room")); });
    var wanted = Math.min(Math.max(asked, Math.min.apply(null, values)), Math.max.apply(null, values));
    var tile = tiles.filter(function (t) { return Number(t.getAttribute("data-room")) === wanted; }).pop();
    if (tile) tiles.forEach(function (t) { t.classList.toggle("is-bed-selected", t === tile); });
  } catch (e) {}
})();
