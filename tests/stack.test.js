import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Window } from "happy-dom";
import { initStack, parts, currentIndex, setCurrent, staticTops, easeInOutQuad, activeLine, fitNav } from "../src/stack.js";

const MOTION = "(prefers-reduced-motion: no-preference)";
const DESKTOP = "(min-width: 768px) and (prefers-reduced-motion: no-preference)";
const PHONE = "(max-width: 767px) and (prefers-reduced-motion: no-preference)";
const REDUCE = "(prefers-reduced-motion: reduce)";

let hw, doc;

// A gsap stub that records tweens; matchMedia runs only the callbacks whose
// query is in `active`, and keeps their cleanups.
function stubGsap(active) {
  const tweens = [];
  const queries = [];
  const cleanups = [];
  const gsap = {
    registerPlugin: vi.fn(),
    fromTo: vi.fn((target, from, to) => tweens.push({ kind: "fromTo", target, from, to })),
    from: vi.fn((target, vars) => tweens.push({ kind: "from", target, vars })),
    matchMedia: vi.fn(() => ({
      add: (q, fn) => {
        queries.push(q);
        if (active.includes(q)) cleanups.push(fn());
      }
    }))
  };
  return { gsap, ScrollTrigger: { refresh: vi.fn() }, tweens, queries, cleanups };
}

// Cards report `top` from a per-card function of the current scroll and of
// their inline position (static = plain-flow offset).
function makeWin(stub, { reduce = false } = {}) {
  const listeners = {};
  const win = {
    gsap: stub?.gsap,
    ScrollTrigger: stub?.ScrollTrigger,
    scrollY: 0,
    innerHeight: 900,
    getComputedStyle: (el) => (el.hasAttribute("data-stack-card") ? { top: "80px" } : hw.getComputedStyle(el)),
    matchMedia: (q) => ({ matches: q === REDUCE ? reduce : false }),
    requestAnimationFrame: (fn) => fn(),
    addEventListener: vi.fn((t, fn) => ((listeners[t] ||= []).push(fn))),
    setTimeout: (...a) => setTimeout(...a),
    fire: (t) => (listeners[t] || []).forEach((fn) => fn())
  };
  return win;
}

const SECTION = `
  <section data-stack data-reveal-skip>
    <h2>Who stays for a month or more?</h2>
    <nav data-stack-nav>
      <a href="#guest-a" class="is-current"><div data-stack-dot class="is-current"></div><div>A</div></a>
      <a href="#guest-b"><div data-stack-dot></div><div>B</div></a>
      <a href="#guest-c"><div data-stack-dot></div><div>C</div></a>
    </nav>
    <div>
      <div id="guest-a" data-stack-card><div class="m"><img data-stack-photo src="a.avif"></div></div>
      <div id="guest-b" data-stack-card><div class="m"><img data-stack-photo src="b.avif"></div></div>
      <div id="guest-c" data-stack-card><div class="m"><img data-stack-photo src="c.avif"></div></div>
    </div>
  </section>`;

// Static offsets 1000, 1500, 2000; stuck cards sit at 80 once scrolled past.
const STATIC = [1000, 1500, 2000];
function placeCards(win) {
  doc.querySelectorAll("[data-stack-card]").forEach((c, i) => {
    c.getBoundingClientRect = () => {
      const flow = STATIC[i] - win.scrollY;
      return { top: c.style.position === "static" ? flow : Math.max(80, flow) };
    };
  });
}

beforeEach(() => {
  hw = new Window({ url: "https://staymo.webflow.io/dubai/monthly-rentals" });
  doc = hw.document;
  doc.body.innerHTML = SECTION;
  doc.querySelector("h2").getBoundingClientRect = () => ({ top: 2000, bottom: 2050 }); // below the fold
  doc.querySelectorAll("[data-stack-photo]").forEach((i) => (i.getBoundingClientRect = () => ({ top: 2000, bottom: 2300 })));
});

afterEach(() => {
  vi.useRealTimers();
  hw.close();
});

describe("parts", () => {
  it("pairs each list link with its card by href and finds its dots", () => {
    const p = parts(doc.querySelector("[data-stack]"));
    expect(p.cards).toHaveLength(3);
    expect(p.items.map((it) => it.card.id)).toEqual(["guest-a", "guest-b", "guest-c"]);
    expect(p.items[0].dots).toHaveLength(1);
    expect(p.title.tagName).toBe("H2");
  });

  it("drops a link without a matching card", () => {
    doc.querySelector("[data-stack-nav]").insertAdjacentHTML("beforeend", '<a href="#nope">x</a>');
    expect(parts(doc.querySelector("[data-stack]")).items).toHaveLength(3);
  });
});

describe("currentIndex / setCurrent", () => {
  it("is the last card at or above the line, 0 before any", () => {
    const win = makeWin();
    placeCards(win);
    const cards = Array.from(doc.querySelectorAll("[data-stack-card]"));
    expect(currentIndex(cards, 120)).toBe(0);
    win.scrollY = 1400; // b at 100: within 80 + 40
    expect(currentIndex(cards, 120)).toBe(1);
    win.scrollY = 1870; // c at 130: not yet
    expect(currentIndex(cards, 120)).toBe(1);
    win.scrollY = 1880;
    expect(currentIndex(cards, 120)).toBe(2);
  });

  it("moves is-current and aria-current to one link and its dot", () => {
    const p = parts(doc.querySelector("[data-stack]"));
    setCurrent(p.items, p.cards[2]);
    expect(p.items.map((it) => it.a.classList.contains("is-current"))).toEqual([false, false, true]);
    expect(p.items.map((it) => it.dots[0].classList.contains("is-current"))).toEqual([false, false, true]);
    expect(p.items[2].a.getAttribute("aria-current")).toBe("true");
    expect(p.items[0].a.hasAttribute("aria-current")).toBe(false);
  });
});

describe("activeLine / fitNav", () => {
  it("is the list's top + 8 when the list is shown, never above sticky top + 40", () => {
    const win = makeWin();
    const p = parts(doc.querySelector("[data-stack]"));
    expect(activeLine(p.nav, p.cards, win)).toBe(120); // hidden list (phone)
    p.nav.getBoundingClientRect = () => ({ top: 225, height: 140 });
    expect(activeLine(p.nav, p.cards, win)).toBe(233);
    p.nav.getBoundingClientRect = () => ({ top: 90, height: 140 });
    expect(activeLine(p.nav, p.cards, win)).toBe(120);
  });

  it("≥768: the list is as tall as the last card without its top padding; phone: cleared", () => {
    const win = makeWin();
    const p = parts(doc.querySelector("[data-stack]"));
    const last = p.cards[2];
    Object.defineProperty(last, "offsetHeight", { value: 338 });
    win.getComputedStyle = () => ({ top: "80px", paddingTop: "20px" });
    win.matchMedia = (q) => ({ matches: q === "(min-width: 768px)" });
    fitNav(p.nav, p.cards, win);
    expect(p.nav.style.minHeight).toBe("318px");
    win.matchMedia = () => ({ matches: false });
    fitNav(p.nav, p.cards, win);
    expect(p.nav.style.minHeight).toBe("");
  });

  it("scroll: the card level with the list's top is current", () => {
    const win = makeWin(stubGsap([MOTION]));
    placeCards(win);
    doc.querySelector("[data-stack-nav]").getBoundingClientRect = () => ({ top: 325, height: 140 });
    initStack(win, doc);
    win.scrollY = 1680; // c at 320: beside the list, b stuck at 80
    win.fire("scroll");
    expect(doc.querySelectorAll("[data-stack-nav] a")[2].classList.contains("is-current")).toBe(true);
  });
});

describe("staticTops", () => {
  it("reads plain-flow offsets and restores the inline position", () => {
    const win = makeWin();
    win.scrollY = 1900;
    placeCards(win);
    const cards = Array.from(doc.querySelectorAll("[data-stack-card]"));
    cards[1].style.position = "relative";
    expect(staticTops(cards, win)).toEqual(STATIC);
    expect(cards.map((c) => c.style.position)).toEqual(["", "relative", ""]);
  });
});

describe("initStack", () => {
  it("scroll updates the list", () => {
    const s = stubGsap([MOTION, DESKTOP]);
    const win = makeWin(s);
    placeCards(win);
    initStack(win, doc);
    const links = doc.querySelectorAll("[data-stack-nav] a");
    expect(links[0].getAttribute("aria-current")).toBe("true");
    win.scrollY = 1450;
    win.fire("scroll");
    expect(links[1].classList.contains("is-current")).toBe(true);
    expect(links[0].classList.contains("is-current")).toBe(false);
  });

  it("motion: photo 1.1 → 1 on every card but the last, scrub true over 420 px from the static offset", () => {
    const s = stubGsap([MOTION, DESKTOP]);
    const win = makeWin(s);
    win.scrollY = 1900;
    placeCards(win);
    initStack(win, doc);
    expect(s.queries).toEqual([DESKTOP, DESKTOP, PHONE, REDUCE]);
    const photos = s.tweens.filter((t) => t.kind === "fromTo");
    expect(photos.map((t) => t.target.getAttribute("src"))).toEqual(["a.avif", "b.avif"]);
    const { to, from } = photos[1];
    expect(from).toEqual({ scale: 1.1 });
    expect(to.scale).toBe(1);
    expect(to.ease).toBe("power1.out");
    expect(to.scrollTrigger.scrub).toBe(true);
    expect(to.scrollTrigger.end).toBe("+=420");
    expect(to.scrollTrigger.start()).toBe(1500 - 80);
    expect(photos[0].target.parentElement.style.isolation).toBe("isolate");
  });

  it("title: house reveal, y 16 desktop, y 8 phone, once", () => {
    const d = stubGsap([MOTION, DESKTOP]);
    initStack(makeWin(d), doc);
    const t = d.tweens.find((x) => x.kind === "from");
    expect(t.target.tagName).toBe("H2");
    expect(t.vars).toMatchObject({ opacity: 0, y: 16, duration: 0.6, ease: "power2.out" });
    expect(t.vars.scrollTrigger).toMatchObject({ start: "top 85%", once: true });
    const p = stubGsap([MOTION, PHONE]);
    initStack(makeWin(p), doc);
    expect(p.tweens.find((x) => x.kind === "from").vars.y).toBe(8);
  });

  it("title already on screen at init (even below 85%): no reveal, nothing hidden", () => {
    const s = stubGsap([MOTION, DESKTOP]);
    doc.querySelector("h2").getBoundingClientRect = () => ({ top: 850, bottom: 900 });
    initStack(makeWin(s), doc);
    expect(s.tweens.find((x) => x.kind === "from")).toBeUndefined();
  });

  it("photo already on screen at init: no settle for it, nothing snaps", () => {
    const s = stubGsap([MOTION, DESKTOP]);
    doc.querySelectorAll("[data-stack-photo]")[0].getBoundingClientRect = () => ({ top: 400, bottom: 700 });
    initStack(makeWin(s), doc);
    const photos = s.tweens.filter((x) => x.kind === "fromTo");
    expect(photos.map((x) => x.target.getAttribute("src"))).toEqual(["b.avif"]);
  });

  it("phone: no photo scale, only the title reveal", () => {
    const s = stubGsap([MOTION, PHONE]);
    initStack(makeWin(s), doc);
    expect(s.tweens.filter((x) => x.kind === "fromTo")).toHaveLength(0);
    expect(s.tweens.filter((x) => x.kind === "from")).toHaveLength(1);
  });

  it("reduced motion: no tweens, cards in plain flow until the flip back", () => {
    const s = stubGsap([REDUCE]);
    initStack(makeWin(s, { reduce: true }), doc);
    expect(s.tweens).toHaveLength(0);
    const cards = Array.from(doc.querySelectorAll("[data-stack-card]"));
    expect(cards.every((c) => c.style.position === "static")).toBe(true);
    s.cleanups.forEach((fn) => fn && fn());
    expect(cards.every((c) => c.style.position === "")).toBe(true);
  });

  it("click never reaches Webflow's delegated anchor scroll", () => {
    const win = makeWin(stubGsap([MOTION]));
    placeCards(win);
    win.staymoLenis = { scrollTo: vi.fn() };
    initStack(win, doc);
    const onDoc = vi.fn();
    doc.addEventListener("click", onDoc);
    doc.querySelectorAll("[data-stack-nav] a")[1].click();
    expect(onDoc).not.toHaveBeenCalled();
  });

  it("click: Lenis to the static offset minus the sticky top, 0.8 s easeInOutQuad", () => {
    const win = makeWin(stubGsap([MOTION]));
    win.scrollY = 300;
    placeCards(win);
    win.staymoLenis = { scrollTo: vi.fn() };
    initStack(win, doc);
    const ev = new hw.MouseEvent("click", { bubbles: true, cancelable: true });
    doc.querySelectorAll("[data-stack-nav] a")[2].dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const [y, opts] = win.staymoLenis.scrollTo.mock.calls[0];
    expect(y).toBe(2000 - 80);
    expect(opts).toMatchObject({ duration: 0.8, easing: easeInOutQuad });
    opts.onComplete();
    expect(doc.activeElement.id).toBe("guest-c");
    expect(doc.activeElement.getAttribute("tabindex")).toBe("-1");
  });

  it("click under reduced motion jumps", () => {
    const win = makeWin(stubGsap([REDUCE]), { reduce: true });
    placeCards(win);
    win.staymoLenis = { scrollTo: vi.fn() };
    initStack(win, doc);
    doc.querySelectorAll("[data-stack-nav] a")[1].click();
    expect(win.staymoLenis.scrollTo.mock.calls[0][0]).toBe(1500 - 80);
    expect(win.staymoLenis.scrollTo.mock.calls[0][1]).toMatchObject({ immediate: true });
  });

  it("click without Lenis or with a modifier keeps the native anchor", () => {
    const win = makeWin(stubGsap([MOTION]));
    placeCards(win);
    initStack(win, doc);
    const ev = new hw.MouseEvent("click", { bubbles: true, cancelable: true });
    doc.querySelectorAll("[data-stack-nav] a")[1].dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    win.staymoLenis = { scrollTo: vi.fn() };
    const mod = new hw.MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true });
    doc.querySelectorAll("[data-stack-nav] a")[1].dispatchEvent(mod);
    expect(mod.defaultPrevented).toBe(false);
    expect(win.staymoLenis.scrollTo).not.toHaveBeenCalled();
  });

  it("without GSAP the list and the click still work", () => {
    const win = makeWin(null);
    placeCards(win);
    expect(initStack(win, doc)).toBeNull();
    win.scrollY = 1900;
    win.fire("scroll");
    expect(doc.querySelectorAll("[data-stack-nav] a")[2].classList.contains("is-current")).toBe(true);
  });

  it("no section: nothing", () => {
    doc.body.innerHTML = "<p>x</p>";
    expect(initStack(makeWin(stubGsap([MOTION])), doc)).toBeNull();
  });
});

describe("easeInOutQuad", () => {
  it("is 0, ½, 1 at the ends and the middle", () => {
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(0.5)).toBe(0.5);
    expect(easeInOutQuad(1)).toBe(1);
  });
});
