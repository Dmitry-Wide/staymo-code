import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { initFaq, setOpen } from "../src/faq.js";

// Mirrors the markup of the Webflow component "FAQ 02 | Accordion Item".
function item({ open = false, q = "Question?" } = {}) {
  return `
    <div class="g-faq02__item__wrap" data-faq-item>
      ${open ? '<div class="g-faq02__item__flag" data-faq-open></div>' : ""}
      <div class="g-faq02__item__toggle" data-faq-toggle>
        <h3 class="g-faq02__item__title">${q}</h3>
        <div class="g-faq02__item__ico is-close" data-faq-ico>-</div>
        <div class="g-faq02__item__ico is-open" data-faq-ico>+</div>
      </div>
      <div class="g-faq02__item__nav" data-faq-panel>
        <div class="g-faq02__item__inner"><div class="g-faq02__item__text"><p>Answer <a href="/x">link</a></p></div></div>
      </div>
    </div>`;
}

const items = () => Array.from(document.querySelectorAll("[data-faq-item]"));
const toggle = (i) => items()[i].querySelector("[data-faq-toggle]");
const panel = (i) => items()[i].querySelector("[data-faq-panel]");
const icos = (i) => Array.from(items()[i].querySelectorAll("[data-faq-ico]"));
const isOpen = (i) =>
  toggle(i).getAttribute("aria-expanded") === "true" &&
  panel(i).classList.contains("is-expanded") &&
  icos(i).every((c) => c.classList.contains("is-expanded")) &&
  !panel(i).hasAttribute("inert");
const isClosed = (i) =>
  toggle(i).getAttribute("aria-expanded") === "false" &&
  !panel(i).classList.contains("is-expanded") &&
  icos(i).every((c) => !c.classList.contains("is-expanded")) &&
  panel(i).hasAttribute("inert");

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.useRealTimers();
});

describe("initFaq", () => {
  it("starts closed unless the item carries the open-by-default marker", () => {
    document.body.innerHTML = item({ open: true }) + item() + item();
    initFaq();
    expect(isOpen(0)).toBe(true);
    expect(isClosed(1)).toBe(true);
    expect(isClosed(2)).toBe(true);
    expect(panel(0).style.height).toBe("");
  });

  it("makes the toggle a keyboard button that controls its panel", () => {
    document.body.innerHTML = item() + item();
    initFaq();
    const t = toggle(0);
    expect(t.getAttribute("role")).toBe("button");
    expect(t.getAttribute("tabindex")).toBe("0");
    expect(t.getAttribute("aria-controls")).toBe(panel(0).id);
    expect(panel(0).id).not.toBe(panel(1).id);
  });

  it("keeps an existing panel id", () => {
    document.body.innerHTML = item();
    panel(0).id = "own-id";
    initFaq();
    expect(toggle(0).getAttribute("aria-controls")).toBe("own-id");
  });

  it("keeps one item open per list and closes nothing on a click elsewhere", () => {
    document.body.innerHTML = item({ open: true }) + item() + item();
    initFaq();
    document.body.click();
    expect(isOpen(0)).toBe(true); // a click elsewhere closes nothing
    toggle(1).click();
    expect(isOpen(1)).toBe(true);
    expect(isClosed(0)).toBe(true); // opening another closes the open one
    expect(isClosed(2)).toBe(true);
    toggle(1).click();
    expect(isClosed(1)).toBe(true); // its own toggle closes it
    expect(isClosed(0)).toBe(true);
  });

  it("leaves items of another list alone", () => {
    document.body.innerHTML = `<div>${item({ open: true })}</div><div>${item()}</div>`;
    initFaq();
    toggle(1).click();
    expect(isOpen(1)).toBe(true);
    expect(isOpen(0)).toBe(true);
  });

  it("keeps one item open per [data-faq-list], each item in its own wrapper", () => {
    const cell = (html) => `<div class="cw-faq-full">${html}</div>`;
    document.body.innerHTML = `<div data-faq-list><div>${cell(item({ open: true }))}</div><div>${cell(item())}${cell(item())}</div></div>`;
    initFaq();
    toggle(1).click();
    expect(isOpen(1)).toBe(true);
    expect(isClosed(0)).toBe(true);
    toggle(2).click();
    expect(isOpen(2)).toBe(true);
    expect(isClosed(1)).toBe(true);
  });

  it("leaves another [data-faq-list] alone, nested or not", () => {
    const cell = (html) => `<div>${html}</div>`;
    document.body.innerHTML =
      `<div data-faq-list>${cell(item({ open: true }))}<div data-faq-list>${cell(item({ open: true }))}${cell(item())}</div>${cell(item())}</div>` +
      `<div data-faq-list>${cell(item({ open: true }))}</div>`;
    initFaq();
    toggle(2).click(); // inner list: closes item 1 only
    expect(isOpen(2)).toBe(true);
    expect(isClosed(1)).toBe(true);
    expect(isOpen(0)).toBe(true);
    expect(isOpen(4)).toBe(true);
    toggle(3).click(); // outer list: closes item 0, not the nested item 2
    expect(isOpen(3)).toBe(true);
    expect(isClosed(0)).toBe(true);
    expect(isOpen(2)).toBe(true);
    expect(isOpen(4)).toBe(true);
  });

  it("toggles on Enter and Space, not on other keys", () => {
    document.body.innerHTML = item();
    initFaq();
    const key = (k) => toggle(0).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    key("a");
    expect(isClosed(0)).toBe(true);
    key("Enter");
    expect(isOpen(0)).toBe(true);
    key(" ");
    expect(isClosed(0)).toBe(true);
  });

  it("binds once when called again", () => {
    document.body.innerHTML = item();
    initFaq();
    initFaq();
    toggle(0).click();
    expect(isOpen(0)).toBe(true);
  });

  it("ignores an item without a toggle or a panel", () => {
    document.body.innerHTML = '<div data-faq-item><div data-faq-toggle></div></div>' + item();
    expect(() => initFaq()).not.toThrow();
    expect(isClosed(1)).toBe(true);
  });

  it("only reads the marker as a direct child of the item", () => {
    document.body.innerHTML = item();
    items()[0].querySelector(".g-faq02__item__text").insertAdjacentHTML("beforeend", "<span data-faq-open></span>");
    initFaq();
    expect(isClosed(0)).toBe(true);
  });
});

describe("setOpen animation", () => {
  it("runs through a px height and clears it when the transition ends", () => {
    vi.useFakeTimers();
    document.body.innerHTML = item();
    initFaq();
    const p = panel(0);
    p.style.transitionDuration = "0.2s"; // happy-dom does not expand the shorthand
    // Auto height of the open panel is 94; inline px heights read back as set.
    p.getBoundingClientRect = () => ({ height: p.style.height ? parseFloat(p.style.height) : p.classList.contains("is-expanded") ? 94 : 0 });
    setOpen(items()[0], true);
    expect(p.style.height).toBe("94px");
    expect(p.style.overflow).toBe("hidden"); // clipped only while it moves
    vi.advanceTimersByTime(200);
    expect(p.style.height).toBe("");
    expect(p.style.overflow).toBe(""); // open: the combo shows overflowing glyphs
    setOpen(items()[0], false);
    expect(p.style.height).toBe("0px");
    expect(p.style.overflow).toBe("hidden");
    vi.advanceTimersByTime(200);
    expect(p.style.height).toBe("");
    expect(p.style.overflow).toBe("");
  });

  it("sets the end state at once when the panel has no transition", () => {
    document.body.innerHTML = item();
    initFaq();
    setOpen(items()[0], true);
    expect(panel(0).style.height).toBe("");
    expect(isOpen(0)).toBe(true);
  });

  it("starts a reversal from the height on screen", () => {
    vi.useFakeTimers();
    document.body.innerHTML = item();
    initFaq();
    const p = panel(0);
    p.style.transitionDuration = "0.2s"; // happy-dom does not expand the shorthand
    p.getBoundingClientRect = () => ({ height: p.style.height ? 40 : 94 }); // mid-way at 40
    setOpen(items()[0], true);
    setOpen(items()[0], false);
    expect(p.style.height).toBe("0px");
    expect(isClosed(0)).toBe(true);
  });

  it("does not let an earlier timer clear a newer transition", () => {
    vi.useFakeTimers();
    document.body.innerHTML = item();
    initFaq();
    const p = panel(0);
    p.style.transitionDuration = "0.2s"; // happy-dom does not expand the shorthand
    setOpen(items()[0], true);
    vi.advanceTimersByTime(100);
    setOpen(items()[0], false);
    vi.advanceTimersByTime(150);
    expect(p.style.height).toBe("0px");
    vi.advanceTimersByTime(50);
    expect(p.style.height).toBe("");
  });
});
