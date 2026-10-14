import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Window } from "happy-dom";
import { initShutter, startShutter, frames } from "../src/shutter.js";

const DESKTOP = "(min-width: 768px) and (prefers-reduced-motion: no-preference)";
const PHONE = "(max-width: 767px) and (prefers-reduced-motion: no-preference)";

let hw, doc;

// A gsap stub that records timelines and their fromTo calls; matchMedia runs
// only the callbacks whose query is in `active` (the "current" media).
function stubGsap(active) {
  const timelines = [];
  const queries = [];
  const gsap = {
    registerPlugin: vi.fn(),
    timeline: vi.fn((vars) => {
      const tl = { vars, tweens: [] };
      tl.fromTo = vi.fn((target, from, to, at) => {
        tl.tweens.push({ target, from, to, at });
        return tl;
      });
      timelines.push(tl);
      return tl;
    }),
    matchMedia: vi.fn(() => ({
      add: (q, fn) => {
        queries.push(q);
        if (active.includes(q)) fn();
      }
    }))
  };
  const ScrollTrigger = { refresh: vi.fn() };
  return { gsap, ScrollTrigger, timelines, queries };
}

function makeWin(stub) {
  return {
    gsap: stub?.gsap,
    ScrollTrigger: stub?.ScrollTrigger,
    getComputedStyle: (el) => hw.getComputedStyle(el),
    addEventListener: vi.fn(),
    setTimeout: (...a) => setTimeout(...a)
  };
}

const ROW = `
  <div data-shutter>
    <div data-shutter-frame style="border-top-left-radius: 12px"><img src="a.webp"><img src="x.webp"></div>
    <p class="f">not a frame</p>
    <div data-shutter-frame style="border-top-left-radius: 11.98px"><img src="b.webp"></div>
  </div>`;

beforeEach(() => {
  hw = new Window({ url: "https://staymo.com/dubai/business-bay" });
  doc = hw.document;
  doc.body.innerHTML = ROW;
});

afterEach(() => {
  vi.useRealTimers();
  hw.close();
});

describe("frames", () => {
  it("binds frames by attribute and takes each frame's first img", () => {
    const f = frames(doc.querySelector("[data-shutter]"));
    expect(f).toHaveLength(2);
    expect(f[0].img.getAttribute("src")).toBe("a.webp");
    expect(f[1].img.getAttribute("src")).toBe("b.webp");
  });
});

describe("initShutter", () => {
  it("desktop: one timeline per row, once at top 80%, frames 0.12 s apart", () => {
    const s = stubGsap([DESKTOP]);
    initShutter(makeWin(s), doc);
    expect(s.gsap.registerPlugin).toHaveBeenCalledWith(s.ScrollTrigger);
    expect(s.queries).toEqual([DESKTOP, PHONE]);
    expect(s.timelines).toHaveLength(1);
    const [tl] = s.timelines;
    expect(tl.vars.scrollTrigger).toEqual({ trigger: doc.querySelector("[data-shutter]"), start: "top 80%", once: true });

    const [clip0, img0, clip1, img1] = tl.tweens;
    const [f0, f1] = doc.querySelectorAll("[data-shutter-frame]");
    expect(clip0.target).toBe(f0);
    expect(clip0.from.clipPath).toBe("inset(100% 0% 0% 0% round 12px)");
    expect(clip0.to).toMatchObject({ clipPath: "inset(0% 0% 0% 0% round 12px)", duration: 1.1, ease: "expo.out", immediateRender: true });
    expect(clip0.at).toBe(0);
    expect(img0.target).toBe(f0.querySelector("img"));
    expect(img0.from).toEqual({ scale: 1.12 });
    expect(img0.to).toMatchObject({ scale: 1, ease: "expo.out" });
    expect(img0.to.duration).toBeCloseTo(1.375);
    expect(clip1.target).toBe(f1);
    expect(clip1.from.clipPath).toBe("inset(100% 0% 0% 0% round 11.98px)");
    expect(clip1.at).toBeCloseTo(0.12);
    expect(img1.at).toBeCloseTo(0.12);
  });

  it("never clears the clip-path or sets will-change at the end", () => {
    const s = stubGsap([DESKTOP]);
    initShutter(makeWin(s), doc);
    s.timelines[0].tweens.forEach(({ to }) => {
      expect(to.clearProps).toBeUndefined();
      expect(to.willChange).toBeUndefined();
    });
  });

  it("phone: a timeline per frame, once at top 85%, 0.9 s and 1.06, no offset", () => {
    const s = stubGsap([PHONE]);
    initShutter(makeWin(s), doc);
    const fs = doc.querySelectorAll("[data-shutter-frame]");
    expect(s.timelines).toHaveLength(2);
    s.timelines.forEach((tl, i) => {
      expect(tl.vars.scrollTrigger).toEqual({ trigger: fs[i], start: "top 85%", once: true });
      const [clip, img] = tl.tweens;
      expect(clip.to.duration).toBe(0.9);
      expect(clip.at).toBe(0);
      expect(img.from).toEqual({ scale: 1.06 });
      expect(img.to.duration).toBeCloseTo(1.125);
      expect(img.at).toBe(0);
    });
  });

  it("reduced motion: no timelines, no tweens", () => {
    const s = stubGsap([]);
    initShutter(makeWin(s), doc);
    expect(s.gsap.timeline).not.toHaveBeenCalled();
  });

  it("a frame without an img still gets its clip", () => {
    doc.body.innerHTML = '<div data-shutter><div data-shutter-frame></div></div>';
    const s = stubGsap([DESKTOP]);
    initShutter(makeWin(s), doc);
    expect(s.timelines[0].tweens).toHaveLength(1);
  });

  it("refreshes ScrollTrigger once after window load when not loaded yet", () => {
    const s = stubGsap([DESKTOP]);
    const win = makeWin(s);
    Object.defineProperty(doc, "readyState", { value: "interactive", configurable: true });
    initShutter(win, doc);
    expect(win.addEventListener).toHaveBeenCalledWith("load", expect.any(Function), { once: true });
    win.addEventListener.mock.calls[0][1]();
    expect(s.ScrollTrigger.refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing without gsap or without rows", () => {
    expect(() => initShutter(makeWin(null), doc)).not.toThrow();
    expect(initShutter(makeWin(null), doc)).toBeNull();
    doc.body.innerHTML = "<div></div>";
    const s = stubGsap([DESKTOP]);
    expect(initShutter(makeWin(s), doc)).toBeNull();
    expect(s.gsap.matchMedia).not.toHaveBeenCalled();
  });
});

describe("startShutter", () => {
  it("waits for a late gsap", () => {
    vi.useFakeTimers();
    const s = stubGsap([DESKTOP]);
    const win = makeWin(null);
    startShutter(win, doc);
    vi.advanceTimersByTime(1000);
    win.gsap = s.gsap;
    win.ScrollTrigger = s.ScrollTrigger;
    vi.advanceTimersByTime(100);
    expect(s.timelines).toHaveLength(1);
  });

  it("gives up after ~5 s and leaves the photos as they are", () => {
    vi.useFakeTimers();
    const s = stubGsap([DESKTOP]);
    const win = makeWin(null);
    expect(() => startShutter(win, doc)).not.toThrow();
    vi.advanceTimersByTime(6000);
    win.gsap = s.gsap;
    win.ScrollTrigger = s.ScrollTrigger;
    vi.advanceTimersByTime(1000);
    expect(s.gsap.matchMedia).not.toHaveBeenCalled();
    doc.querySelectorAll("[data-shutter-frame], img").forEach((el) => expect(el.style.clipPath || el.style.transform).toBeFalsy());
  });
});
