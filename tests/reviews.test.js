import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ACTIVE_CLASS,
  getSlides,
  buildDots,
  setActive,
  initReviews,
  initAllReviews,
} from "../src/reviews.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

// Markup mirrors the Webflow structure: a root with N slides and a dots
// container holding a single placeholder dot (carrying a base class).
function fixture({ slides = 3, autoplay, loop, dotClass = "reviews__dot" } = {}) {
  const slideEls = Array.from({ length: slides }, (_, i) => `<div data-reviews-slide>review ${i}</div>`).join("");
  const attrs = [
    autoplay != null ? `data-reviews-autoplay="${autoplay}"` : "",
    loop != null ? `data-reviews-loop="${loop}"` : "",
  ].join(" ");
  document.body.innerHTML = `
    <section data-reviews ${attrs}>
      <div data-reviews-track>${slideEls}</div>
      <div data-reviews-dots><div data-reviews-dot class="${dotClass}"></div></div>
    </section>`;
  return document.querySelector("[data-reviews]");
}

describe("getSlides", () => {
  it("collects every slide under the root", () => {
    const root = fixture({ slides: 4 });
    expect(getSlides(root).length).toBe(4);
  });
});

describe("buildDots", () => {
  it("generates exactly one dot per slide, cloning the placeholder's class", () => {
    const root = fixture({ slides: 3, dotClass: "reviews__dot" });
    const dots = buildDots(root, 3);
    expect(dots.length).toBe(3);
    expect(root.querySelectorAll("[data-reviews-dot]").length).toBe(3);
    dots.forEach((d, i) => {
      expect(d.classList.contains("reviews__dot")).toBe(true); // designer class preserved
      expect(d.getAttribute("data-reviews-index")).toBe(String(i));
    });
  });

  it("removes the placeholder dots before generating", () => {
    const root = fixture({ slides: 2 });
    // two placeholders present
    root.querySelector("[data-reviews-dots]").innerHTML =
      '<div data-reviews-dot></div><div data-reviews-dot></div>';
    buildDots(root, 2);
    expect(root.querySelectorAll("[data-reviews-dot]").length).toBe(2);
  });

  it("creates a bare dot when no placeholder exists", () => {
    const root = fixture({ slides: 2 });
    root.querySelector("[data-reviews-dots]").innerHTML = "";
    const dots = buildDots(root, 2);
    expect(dots.length).toBe(2);
    expect(dots[0].hasAttribute("data-reviews-dot")).toBe(true);
  });
});

describe("setActive", () => {
  it("flags only the active slide and dot with is-active", () => {
    const root = fixture({ slides: 3 });
    const slides = getSlides(root);
    const dots = buildDots(root, 3);
    setActive(slides, dots, 1);
    expect(slides[1].classList.contains(ACTIVE_CLASS)).toBe(true);
    expect(slides[0].classList.contains(ACTIVE_CLASS)).toBe(false);
    expect(dots[1].classList.contains(ACTIVE_CLASS)).toBe(true);
    expect(dots[1].getAttribute("aria-current")).toBe("true");
    expect(dots[0].hasAttribute("aria-current")).toBe(false);
  });
});

describe("initReviews", () => {
  it("activates the first slide on init", () => {
    const root = fixture({ slides: 3 });
    const c = initReviews(root);
    expect(c.index).toBe(0);
    expect(c.count).toBe(3);
    expect(getSlides(root)[0].classList.contains(ACTIVE_CLASS)).toBe(true);
  });

  it("returns null when there are no slides", () => {
    document.body.innerHTML = '<section data-reviews></section>';
    expect(initReviews(document.querySelector("[data-reviews]"))).toBe(null);
  });

  it("clicking a dot switches to that slide", () => {
    const root = fixture({ slides: 3 });
    initReviews(root);
    const dots = root.querySelectorAll("[data-reviews-dot]");
    dots[2].click();
    expect(getSlides(root)[2].classList.contains(ACTIVE_CLASS)).toBe(true);
    expect(dots[2].classList.contains(ACTIVE_CLASS)).toBe(true);
  });

  it("next wraps with loop, clamps without", () => {
    const loopRoot = fixture({ slides: 2, loop: "true" });
    const a = initReviews(loopRoot);
    a.next(); a.next(); // 0 -> 1 -> 0
    expect(a.index).toBe(0);

    document.body.innerHTML = "";
    const clampRoot = fixture({ slides: 2, loop: "false" });
    const b = initReviews(clampRoot);
    b.next(); b.next(); // 0 -> 1 -> 1 (clamped)
    expect(b.index).toBe(1);
  });

  it("is idempotent — second init returns the same controller", () => {
    const root = fixture({ slides: 2 });
    const c1 = initReviews(root);
    const c2 = initReviews(root);
    expect(c2).toBe(c1);
  });
});

describe("autoplay", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("advances on the configured interval", () => {
    const root = fixture({ slides: 3, autoplay: 5000 });
    const c = initReviews(root);
    expect(c.index).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(c.index).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(c.index).toBe(2);
  });

  it("does not start with a single slide", () => {
    const root = fixture({ slides: 1, autoplay: 5000 });
    const c = initReviews(root);
    vi.advanceTimersByTime(20000);
    expect(c.index).toBe(0);
  });

  it("stop halts advancement, start resumes", () => {
    const root = fixture({ slides: 3, autoplay: 5000 });
    const c = initReviews(root);
    c.stop();
    vi.advanceTimersByTime(15000);
    expect(c.index).toBe(0);
    c.start();
    vi.advanceTimersByTime(5000);
    expect(c.index).toBe(1);
  });
});

describe("initAllReviews", () => {
  it("initialises every carousel on the page", () => {
    document.body.innerHTML = `
      <section data-reviews><div data-reviews-slide></div><div data-reviews-slide></div></section>
      <section data-reviews><div data-reviews-slide></div></section>`;
    expect(initAllReviews(document).length).toBe(2);
  });
});
