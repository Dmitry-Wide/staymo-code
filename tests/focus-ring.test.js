import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Window } from "happy-dom";
import { initFocusRing } from "../src/focus-ring.js";

let hw, doc;

// happy-dom has no layout or computed backgrounds, so boxes come from
// data-box="left top right bottom" and backgrounds from data-bg (colour) /
// data-bgi (image). An element without data-box fills the 0 0 100 100 page.
// A fresh window per test keeps listeners from piling up.
beforeEach(() => {
  hw = new Window();
  doc = hw.document;
  hw.HTMLElement.prototype.getBoundingClientRect = function () {
    const [left, top, right, bottom] = (this.getAttribute("data-box") || "0 0 100 100").split(" ").map(Number);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };
  hw.getComputedStyle = (el) => ({
    backgroundColor: el.getAttribute("data-bg") || "rgba(0, 0, 0, 0)",
    backgroundImage: el.getAttribute("data-bgi") || "none"
  });
  initFocusRing(doc);
});

afterEach(() => hw.close());

const keyboard = () => doc.dispatchEvent(new hw.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
const mouse = () => doc.dispatchEvent(new hw.MouseEvent("mousedown", { bubbles: true }));
const focusIn = (el) => el.dispatchEvent(new hw.FocusEvent("focusin", { bubbles: true }));
const focusOut = (el) => el.dispatchEvent(new hw.FocusEvent("focusout", { bubbles: true }));

const ring = (el) => el.style.getPropertyValue("--focus-ring");

function section(attrs, inner = '<a href="#" data-hit data-box="10 10 50 30">Link</a>') {
  doc.body.innerHTML = `<section ${attrs}>${inner}</section>`;
  return doc.querySelector("[data-hit]");
}

describe("initFocusRing", () => {
  it("leaves the brand ring on a light background", () => {
    const a = section('data-bg="rgb(255, 255, 255)"');
    keyboard();
    focusIn(a);
    expect(ring(a)).toBe("");
    expect(a.hasAttribute("data-focus-photo")).toBe(false);
  });

  it("turns the ring white on brand-ish #5d53aa and on green #006d4e", () => {
    for (const bg of ["rgb(93, 83, 170)", "rgb(0, 109, 78)"]) {
      const a = section(`data-bg="${bg}"`);
      keyboard();
      focusIn(a);
      expect(ring(a)).toBe("#fff");
      expect(a.hasAttribute("data-focus-photo")).toBe(false);
    }
  });

  it("puts the ring on the .c-button__wrap around the link", () => {
    const a = section(
      'data-bg="rgb(0, 109, 78)"',
      '<div class="c-button__wrap" data-box="10 10 60 30"><a href="#" data-hit data-box="10 10 60 30"></a></div>'
    );
    keyboard();
    focusIn(a);
    expect(ring(doc.querySelector(".c-button__wrap"))).toBe("#fff");
    expect(ring(a)).toBe("");
  });

  it("marks a photo background after keyboard focus, not after a click", () => {
    let a = section('data-bgi="url(&quot;hero.jpg&quot;)"');
    keyboard();
    focusIn(a);
    expect(ring(a)).toBe("#fff");
    expect(a.hasAttribute("data-focus-photo")).toBe(true);

    a = section('data-bgi="url(&quot;hero.jpg&quot;)"');
    mouse();
    focusIn(a);
    expect(ring(a)).toBe("#fff");
    expect(a.hasAttribute("data-focus-photo")).toBe(false);
  });

  it("never marks a form field as photo", () => {
    const input = section('data-bgi="url(&quot;hero.jpg&quot;)"', '<input data-hit data-box="10 10 50 30">');
    keyboard();
    focusIn(input);
    expect(ring(input)).toBe("#fff");
    expect(input.hasAttribute("data-focus-photo")).toBe(false);
  });

  it("judges a gradient by its stops", () => {
    const a = section('data-bgi="linear-gradient(rgb(0, 109, 78), rgb(93, 83, 170))"');
    keyboard();
    focusIn(a);
    expect(ring(a)).toBe("#fff");
    expect(a.hasAttribute("data-focus-photo")).toBe(false);
  });

  it("skips an ancestor whose box does not cover the host", () => {
    const a = section(
      'data-bg="rgb(255, 255, 255)"',
      '<div data-bg="rgb(0, 109, 78)" data-box="0 0 20 20"><a href="#" data-hit data-box="10 10 50 30">Link</a></div>'
    );
    keyboard();
    focusIn(a);
    expect(ring(a)).toBe("");
  });

  it("skips a translucent ancestor and reads the one behind it", () => {
    const a = section(
      'data-bg="rgb(0, 109, 78)"',
      '<div data-bg="rgba(255, 255, 255, 0.2)"><a href="#" data-hit data-box="10 10 50 30">Link</a></div>'
    );
    keyboard();
    focusIn(a);
    expect(ring(a)).toBe("#fff");
  });

  it("rings the beds counter wrapper only after keyboard", () => {
    const html =
      '<div data-counter-target data-box="10 10 80 40"><button>-</button><input data-hit data-box="30 10 60 40"><button>+</button></div>';
    let input = section('data-bg="rgb(0, 109, 78)"', html);
    let wrap = doc.querySelector("[data-counter-target]");
    keyboard();
    focusIn(input);
    expect(wrap.hasAttribute("data-focus-kb")).toBe(true);
    expect(ring(wrap)).toBe("#fff");

    input = section('data-bg="rgb(0, 109, 78)"', html);
    wrap = doc.querySelector("[data-counter-target]");
    mouse();
    focusIn(input);
    expect(wrap.hasAttribute("data-focus-kb")).toBe(false);
    expect(ring(wrap)).toBe("");
    expect(ring(input)).toBe("");
  });

  it("clears everything on focusout", () => {
    const a = section('data-bgi="url(&quot;hero.jpg&quot;)"');
    keyboard();
    focusIn(a);
    focusOut(a);
    expect(ring(a)).toBe("");
    expect(a.hasAttribute("data-focus-photo")).toBe(false);

    const input = section(
      'data-bg="rgb(0, 109, 78)"',
      '<div data-counter-target><input data-hit></div>'
    );
    const wrap = doc.querySelector("[data-counter-target]");
    keyboard();
    focusIn(input);
    focusOut(input);
    expect(wrap.hasAttribute("data-focus-kb")).toBe(false);
    expect(ring(wrap)).toBe("");
  });

  it("clears the previous host when focus moves on", () => {
    doc.body.innerHTML =
      '<section data-bg="rgb(0, 109, 78)"><a href="#" id="a" data-box="10 10 50 30">A</a><a href="#" id="b" data-box="10 40 50 60">B</a></section>';
    const [a, b] = doc.querySelectorAll("a");
    keyboard();
    focusIn(a);
    focusIn(b);
    expect(ring(a)).toBe("");
    expect(ring(b)).toBe("#fff");
  });

  it("leaves the CSS default when reading the background throws", () => {
    hw.getComputedStyle = () => {
      throw new Error("boom");
    };
    const a = section('data-bgi="url(&quot;hero.jpg&quot;)"');
    keyboard();
    expect(() => focusIn(a)).not.toThrow();
    expect(ring(a)).toBe("");
    expect(a.hasAttribute("data-focus-photo")).toBe(false);
  });
});
