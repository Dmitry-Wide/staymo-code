import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Window } from "happy-dom";
import { initNavProgress } from "../src/nav-progress.js";

let hw, doc, win;

// A fresh window per test keeps listeners from piling up; timers are the
// global ones so vi.useFakeTimers() controls them. location is a fixed URL:
// happy-dom follows the link before window listeners see the click, which a
// browser does after them.
beforeEach(() => {
  hw = new Window({ url: "https://staymo.com/blog?page=2" });
  doc = hw.document;
  win = {
    location: new URL("https://staymo.com/blog?page=2"),
    addEventListener: hw.addEventListener.bind(hw),
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: (...a) => clearTimeout(...a)
  };
  initNavProgress(win, doc);
});

afterEach(() => {
  vi.useRealTimers();
  hw.close();
});

function click(html, init = {}, prevent = false) {
  doc.body.innerHTML = html;
  const target = doc.querySelector("[data-hit]") || doc.querySelector("a");
  if (prevent) target.addEventListener("click", (e) => e.preventDefault());
  target.dispatchEvent(new hw.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));
}

const loading = () => doc.documentElement.getAttribute("data-nav") === "loading";

describe("initNavProgress", () => {
  it("starts on a plain same-origin link and adds the bar to the end of body", () => {
    click('<a href="/pricing"><span data-hit>Pricing</span></a><p></p>');
    expect(loading()).toBe(true);
    const bar = doc.body.lastElementChild;
    expect(bar.hasAttribute("data-nav-bar")).toBe(true);
    expect(bar.getAttribute("aria-hidden")).toBe("true");
  });

  it("starts on the same path with another query and on target=_self", () => {
    click('<a href="/blog?page=3" target="_self">Next</a>');
    expect(loading()).toBe(true);
  });

  it.each([
    ["a prevented click", '<a href="/pricing">x</a>', {}, true],
    ["a modifier key", '<a href="/pricing">x</a>', { metaKey: true }],
    ["ctrl", '<a href="/pricing">x</a>', { ctrlKey: true }],
    ["shift", '<a href="/pricing">x</a>', { shiftKey: true }],
    ["alt", '<a href="/pricing">x</a>', { altKey: true }],
    ["the middle button", '<a href="/pricing">x</a>', { button: 1 }],
    ["target=_blank", '<a href="/pricing" target="_blank">x</a>'],
    ["a download link", '<a href="/file.pdf" download>x</a>'],
    ["another origin", '<a href="https://example.com/pricing">x</a>'],
    ["http on an https page", '<a href="http://staymo.com/pricing">x</a>'],
    ["mailto:", '<a href="mailto:hi@staymo.com">x</a>'],
    ["tel:", '<a href="tel:+440000">x</a>'],
    ["a hash on the same page", '<a href="/blog?page=2#faq">x</a>'],
    ["a bare hash", '<a href="#top">x</a>'],
    ["data-nav-progress=off on an ancestor", '<nav data-nav-progress="off"><a href="/pricing">x</a></nav>'],
    ["an unparseable href", '<a href="http://[bad">x</a>'],
    ["a click outside links", '<a href="/pricing">x</a><p data-hit>text</p>']
  ])("skips %s", (_, html, init = {}, prevent = false) => {
    click(html, init, prevent);
    expect(doc.documentElement.hasAttribute("data-nav")).toBe(false);
    expect(doc.querySelector("[data-nav-bar]")).toBe(null);
  });

  it("resets on a bfcache restore only", () => {
    click('<a href="/pricing">x</a>');
    hw.dispatchEvent(Object.assign(new hw.Event("pageshow"), { persisted: false }));
    expect(loading()).toBe(true);
    const ev = new hw.Event("pageshow");
    Object.defineProperty(ev, "persisted", { value: true });
    hw.dispatchEvent(ev);
    expect(doc.documentElement.hasAttribute("data-nav")).toBe(false);
  });

  it("resets 10 s after the last start", () => {
    vi.useFakeTimers();
    click('<a href="/pricing">x</a>');
    vi.advanceTimersByTime(6000);
    click('<a href="/about">x</a>');
    vi.advanceTimersByTime(6000);
    expect(loading()).toBe(true);
    vi.advanceTimersByTime(4000);
    expect(doc.documentElement.hasAttribute("data-nav")).toBe(false);
  });

  it("reuses a bar already in the markup", () => {
    click('<div data-nav-bar></div><a href="/pricing">x</a>');
    expect(loading()).toBe(true);
    expect(doc.querySelectorAll("[data-nav-bar]").length).toBe(1);
  });

  it("keeps a single bar after two clicks", () => {
    doc.body.innerHTML = '<a href="/pricing">x</a>';
    const a = doc.querySelector("a");
    a.dispatchEvent(new hw.MouseEvent("click", { bubbles: true, cancelable: true }));
    a.dispatchEvent(new hw.MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(doc.querySelectorAll("[data-nav-bar]").length).toBe(1);
  });
});
