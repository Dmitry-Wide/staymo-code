import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initTabs } from "../src/tabs.js";

function markup({ interval = 7000, n = 4, extra = "", listStyle = "" } = {}) {
  const tabs = Array.from(
    { length: n },
    (_, i) => `<button data-tabs-tab>Model ${i + 1}<span data-tabs-desc>About ${i + 1}</span><span data-tabs-progress></span></button>`,
  ).join("");
  const panels = Array.from({ length: n }, (_, i) => `<div data-tabs-panel>Chart ${i + 1}</div>`).join("");
  return `
    <section data-tabs ${interval == null ? "" : `data-tabs-interval="${interval}"`}>
      <div data-tabs-list ${listStyle}>${tabs}</div>
      <div class="panels">${panels}</div>${extra}
    </section>`;
}

// IntersectionObserver stand-in: show(root, ratio) fires the callback.
let observers;
class IO {
  constructor(cb, opts) {
    this.cb = cb;
    this.opts = opts;
    observers.push(this);
  }
  observe(el) {
    this.el = el;
  }
  disconnect() {}
}
const show = (root, ratio = 1) =>
  observers.filter((o) => o.el === root).forEach((o) => o.cb([{ target: root, intersectionRatio: ratio }]));

// matchMedia stand-in for prefers-reduced-motion.
let mq;
function setReduce(on) {
  mq.matches = on;
  mq.listeners.forEach((l) => l({ matches: on }));
}

const roots = () => Array.from(document.querySelectorAll("[data-tabs]"));
const root = () => roots()[0];
const tabs = (r = root()) => Array.from(r.querySelectorAll("[data-tabs-tab]"));
const panels = (r = root()) => Array.from(r.querySelectorAll("[data-tabs-panel]"));
const active = (r = root()) => tabs(r).findIndex((t) => t.getAttribute("aria-selected") === "true");
const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

beforeEach(() => {
  document.body.innerHTML = "";
  observers = [];
  mq = { matches: false, listeners: [], addEventListener: (_, l) => mq.listeners.push(l) };
  vi.stubGlobal("IntersectionObserver", IO);
  vi.stubGlobal("matchMedia", () => mq);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("initTabs: ARIA and state", () => {
  it("wires tablist, tabs and panels with ids and roving tabindex", () => {
    document.body.innerHTML = markup();
    initTabs();
    const r = root();
    expect(r.hasAttribute("data-tabs-ready")).toBe(true);
    expect(r.querySelector("[data-tabs-list]").getAttribute("role")).toBe("tablist");
    tabs().forEach((t, i) => {
      const p = panels()[i];
      expect(t.getAttribute("role")).toBe("tab");
      expect(p.getAttribute("role")).toBe("tabpanel");
      expect(t.id).toBeTruthy();
      expect(p.id).toBeTruthy();
      expect(t.getAttribute("aria-controls")).toBe(p.id);
      expect(p.getAttribute("aria-labelledby")).toBe(t.id);
      expect(p.getAttribute("tabindex")).toBe("0");
      expect(t.getAttribute("aria-selected")).toBe(String(i === 0));
      expect(t.getAttribute("tabindex")).toBe(i === 0 ? "0" : "-1");
      expect(t.classList.contains("is-active")).toBe(i === 0);
      expect(p.classList.contains("is-active")).toBe(i === 0);
      expect(p.hasAttribute("inert")).toBe(i !== 0);
      expect(t.querySelector("[data-tabs-progress]").getAttribute("aria-hidden")).toBe("true");
    });
    expect(r.style.getPropertyValue("--tabs-interval")).toBe("7000ms");
  });

  it("keeps existing ids and starts on a pre-marked tab", () => {
    document.body.innerHTML = markup();
    tabs()[0].id = "mine";
    panels()[0].id = "mine-panel";
    tabs()[2].setAttribute("aria-selected", "true");
    initTabs();
    expect(tabs()[0].id).toBe("mine");
    expect(tabs()[0].getAttribute("aria-controls")).toBe("mine-panel");
    expect(active()).toBe(2);
  });

  it("gives every root unique ids and leaves an initialised root alone", () => {
    document.body.innerHTML = markup() + markup();
    initTabs();
    initTabs();
    const ids = roots().flatMap((r) => [...tabs(r), ...panels(r)].map((e) => e.id));
    expect(new Set(ids).size).toBe(16);
    tabs(roots()[1])[3].click();
    expect(active(roots()[1])).toBe(3);
    expect(active(roots()[0])).toBe(0);
  });

  it("ignores tabs and panels of a nested root", () => {
    document.body.innerHTML = markup({ n: 2, extra: markup({ n: 3 }) });
    initTabs();
    const [outer, inner] = roots();
    expect(outer.querySelectorAll('[aria-controls]').length).toBe(5);
    tabs(inner)[2].click();
    expect(active(inner)).toBe(2);
    expect(tabs(outer)[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs(outer)[1].getAttribute("aria-selected")).toBe("false");
  });

  it("does nothing without a list or tabs", () => {
    document.body.innerHTML = `<div data-tabs><div data-tabs-panel>x</div></div>`;
    initTabs();
    expect(root().hasAttribute("data-tabs-ready")).toBe(false);
  });

  it("click activates the tab", () => {
    document.body.innerHTML = markup();
    initTabs();
    tabs()[2].click();
    expect(active()).toBe(2);
    expect(panels()[2].classList.contains("is-active")).toBe(true);
    expect(panels()[0].classList.contains("is-active")).toBe(false);
    expect(panels()[0].hasAttribute("inert")).toBe(true);
  });
});

describe("initTabs: keyboard", () => {
  it("Left/Right wrap, Home/End jump, focus follows", () => {
    document.body.innerHTML = markup();
    initTabs();
    key(tabs()[0], "ArrowLeft");
    expect(active()).toBe(3);
    expect(document.activeElement).toBe(tabs()[3]);
    key(tabs()[3], "ArrowRight");
    expect(active()).toBe(0);
    key(tabs()[0], "End");
    expect(active()).toBe(3);
    key(tabs()[3], "Home");
    expect(active()).toBe(0);
  });

  it("Up/Down only when the list is vertical", () => {
    document.body.innerHTML = markup();
    initTabs();
    expect(key(tabs()[0], "ArrowDown")).toBe(true); // not prevented: page scrolls
    expect(active()).toBe(0);

    document.body.innerHTML = markup({ listStyle: 'aria-orientation="vertical"' });
    initTabs();
    expect(key(tabs()[0], "ArrowDown")).toBe(false);
    expect(active()).toBe(1);
    key(tabs()[1], "ArrowUp");
    expect(active()).toBe(0);

    document.body.innerHTML = markup({ listStyle: 'style="display:flex;flex-direction:column"' });
    initTabs();
    key(tabs()[0], "ArrowDown");
    expect(active()).toBe(1);
  });

  it("leaves other keys and modified arrows alone", () => {
    document.body.innerHTML = markup();
    initTabs();
    expect(key(tabs()[0], "a")).toBe(true);
    tabs()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true }));
    expect(active()).toBe(0);
  });
});

describe("initTabs: autoplay", () => {
  it("waits until the root is at least half on screen, then advances every interval and wraps", () => {
    document.body.innerHTML = markup();
    initTabs();
    const r = root();
    expect(r.hasAttribute("data-tabs-autoplay")).toBe(true);
    expect(r.hasAttribute("data-tabs-paused")).toBe(true);
    vi.advanceTimersByTime(20000);
    expect(active()).toBe(0);

    show(r, 0.4);
    vi.advanceTimersByTime(20000);
    expect(active()).toBe(0);

    show(r, 0.5);
    expect(r.hasAttribute("data-tabs-paused")).toBe(false);
    vi.advanceTimersByTime(6999);
    expect(active()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(active()).toBe(1);
    vi.advanceTimersByTime(7000 * 3);
    expect(active()).toBe(0);
  });

  it("pauses off screen and resumes with the remaining time", () => {
    document.body.innerHTML = markup();
    initTabs();
    show(root());
    vi.advanceTimersByTime(5000);
    show(root(), 0);
    expect(root().hasAttribute("data-tabs-paused")).toBe(true);
    vi.advanceTimersByTime(60000);
    expect(active()).toBe(0);
    show(root());
    vi.advanceTimersByTime(1999);
    expect(active()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(active()).toBe(1);
  });

  it("pauses on hover and focus inside, resumes on leave", () => {
    document.body.innerHTML = markup() + `<button id="out">out</button>`;
    initTabs();
    const r = root();
    show(r);
    vi.advanceTimersByTime(3000);

    r.dispatchEvent(new Event("pointerenter"));
    expect(r.hasAttribute("data-tabs-paused")).toBe(true);
    vi.advanceTimersByTime(30000);
    expect(active()).toBe(0);
    r.dispatchEvent(new Event("pointerleave"));
    expect(r.hasAttribute("data-tabs-paused")).toBe(false);

    panels()[0].dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    vi.advanceTimersByTime(30000);
    expect(active()).toBe(0);
    // Focus moving within the root keeps the pause.
    panels()[0].dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: tabs()[0] }));
    expect(r.hasAttribute("data-tabs-paused")).toBe(true);
    tabs()[0].dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.getElementById("out") }));
    expect(r.hasAttribute("data-tabs-paused")).toBe(false);
    vi.advanceTimersByTime(4000);
    expect(active()).toBe(1);
  });

  it("stops for good after a click", () => {
    document.body.innerHTML = markup();
    initTabs();
    show(root());
    tabs()[2].click();
    expect(root().hasAttribute("data-tabs-autoplay")).toBe(false);
    expect(root().hasAttribute("data-tabs-paused")).toBe(false);
    show(root(), 0);
    show(root());
    vi.advanceTimersByTime(60000);
    expect(active()).toBe(2);
  });

  it("stops for good after a key activation", () => {
    document.body.innerHTML = markup();
    initTabs();
    show(root());
    key(tabs()[0], "ArrowRight");
    tabs()[1].dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    vi.advanceTimersByTime(60000);
    expect(active()).toBe(1);
    expect(root().hasAttribute("data-tabs-autoplay")).toBe(false);
  });

  it("pauses while the page is hidden", () => {
    document.body.innerHTML = markup();
    initTabs();
    show(root());
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(60000);
    expect(active()).toBe(0);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(7000);
    expect(active()).toBe(1);
  });

  it("no autoplay under prefers-reduced-motion, following changes live", () => {
    mq.matches = true;
    document.body.innerHTML = markup();
    initTabs();
    const r = root();
    show(r);
    expect(r.hasAttribute("data-tabs-autoplay")).toBe(false);
    vi.advanceTimersByTime(60000);
    expect(active()).toBe(0);

    setReduce(false);
    expect(r.hasAttribute("data-tabs-autoplay")).toBe(true);
    vi.advanceTimersByTime(7000);
    expect(active()).toBe(1);

    vi.advanceTimersByTime(3000);
    setReduce(true);
    expect(r.hasAttribute("data-tabs-autoplay")).toBe(false);
    vi.advanceTimersByTime(60000);
    expect(active()).toBe(1);
    // Turned back on: a fresh full cycle, like the restarted bar.
    setReduce(false);
    vi.advanceTimersByTime(6999);
    expect(active()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(active()).toBe(2);
  });

  it("no autoplay without an interval or with a single tab", () => {
    document.body.innerHTML = markup({ interval: null }) + markup({ interval: 0 }) + markup({ n: 1 });
    initTabs();
    roots().forEach((r) => {
      show(r);
      expect(r.hasAttribute("data-tabs-autoplay")).toBe(false);
      expect(r.hasAttribute("data-tabs-paused")).toBe(false);
    });
    expect(observers.length).toBe(0);
    vi.advanceTimersByTime(60000);
    roots().forEach((r) => expect(active(r)).toBe(0));
  });

  it("runs without IntersectionObserver and matchMedia", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal("matchMedia", undefined);
    document.body.innerHTML = markup();
    initTabs();
    expect(root().hasAttribute("data-tabs-paused")).toBe(false);
    vi.advanceTimersByTime(7000);
    expect(active()).toBe(1);
  });

  it("roots run independently", () => {
    document.body.innerHTML = markup() + markup({ interval: 3000 });
    initTabs();
    const [a, b] = roots();
    show(a);
    show(b);
    vi.advanceTimersByTime(7000);
    expect(active(a)).toBe(1);
    expect(active(b)).toBe(2);
    b.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(7000);
    expect(active(a)).toBe(2);
    expect(active(b)).toBe(2);
  });
});

describe("initTabs: overflowing list", () => {
  // A 100px-wide list of 80px pills: tab i spans [80i, 80i+80] in scroll space.
  function layout(r = root(), { width = 100, pill = 80 } = {}) {
    const list = r.querySelector("[data-tabs-list]");
    Object.defineProperty(list, "clientWidth", { configurable: true, get: () => width });
    Object.defineProperty(list, "scrollWidth", { configurable: true, get: () => pill * tabs(r).length });
    list.scrollLeft = 0;
    list.getBoundingClientRect = () => ({ left: 10, width, top: 0, height: 40 });
    tabs(r).forEach((t, i) => {
      t.getBoundingClientRect = () => ({ left: 10 + i * pill - list.scrollLeft, width: pill, top: 0, height: 40 });
    });
    list.scrollTo = vi.fn(({ left }) => (list.scrollLeft = left));
    return list;
  }

  it("autoplay scrolls the list so the active tab is fully visible, smoothly", () => {
    document.body.innerHTML = markup();
    const list = layout();
    initTabs();
    expect(list.scrollTo).not.toHaveBeenCalled(); // first tab already in view
    show(root());
    vi.advanceTimersByTime(7000);
    expect(list.scrollTo).toHaveBeenLastCalledWith({ left: 60, behavior: "smooth" }); // right edge 160 - 100
    vi.advanceTimersByTime(7000);
    expect(list.scrollTo).toHaveBeenLastCalledWith({ left: 140, behavior: "smooth" });
    vi.advanceTimersByTime(14000); // wraps to the first tab: scroll back to its left edge
    expect(active()).toBe(0);
    expect(list.scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "smooth" });
  });

  it("keys scroll the list, not the page", () => {
    document.body.innerHTML = markup();
    const list = layout();
    initTabs();
    const focus = vi.spyOn(tabs()[3], "focus");
    key(tabs()[0], "End");
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(list.scrollTo).toHaveBeenLastCalledWith({ left: 220, behavior: "smooth" });
  });

  it("jumps instantly under reduced motion", () => {
    mq.matches = true;
    document.body.innerHTML = markup();
    const list = layout();
    initTabs();
    key(tabs()[0], "ArrowRight");
    expect(list.scrollTo).toHaveBeenLastCalledWith({ left: 60, behavior: "auto" });
  });

  it("reveals a pre-marked tab at start; leaves a visible tab or a fitting list alone", () => {
    document.body.innerHTML = markup();
    tabs()[2].classList.add("is-active");
    let list = layout();
    initTabs();
    expect(list.scrollTo).toHaveBeenLastCalledWith({ left: 140, behavior: "smooth" });
    list.scrollTo.mockClear();
    tabs()[2].click(); // already fully visible
    expect(list.scrollTo).not.toHaveBeenCalled();

    document.body.innerHTML = markup();
    list = layout(root(), { width: 400 });
    initTabs();
    key(tabs()[0], "End");
    expect(list.scrollTo).not.toHaveBeenCalled();
  });
});
