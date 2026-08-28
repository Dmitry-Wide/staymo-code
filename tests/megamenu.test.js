import { describe, it, expect, beforeEach, vi } from "vitest";
import { PARENT, initMegaMenu } from "../src/megamenu.js";

// Markup mirrors the live Webflow structure: a bar of triggers, a panels surface
// holding one .mm-panel per key, and a Talk panel with the two-state card.
function fixture() {
  document.body.innerHTML = `
    <div class="mm">
      <div class="mm__bar-nav">
        <a href="#" class="mm__burger"><span class="mm__burger-line"></span></a>
        <div class="mm__trigger-wrap" data-open="property-owners"><a href="#" class="mm__trigger">Owners</a></div>
        <div class="mm__trigger-wrap" data-open="solutions"><a href="#" class="mm__trigger">Solutions</a></div>
      </div>
      <div class="mm__panels">
        <div class="mm-panel" data-panel="property-owners">
          <div class="mm-panel__head">Owners</div>
          <div class="mm-panel__inner">
            <div class="mm-panel__content"><a data-tab="how-it-works">How it works</a></div>
          </div>
        </div>
        <div class="mm-panel" data-panel="solutions">
          <div class="mm-panel__head">Solutions</div>
          <div class="mm-panel__inner"><div class="mm-panel__content">
            <a class="mm-link" href="/#ready-to-get-started">How it works</a>
            <a class="mm-link" href="/pricing">Pricing</a>
            <a class="mm-link" href="#">Revenue reports</a>
          </div></div>
        </div>
        <div class="mm-panel" data-panel="how-it-works">
          <div class="mm-panel__inner">
            <div class="mm-panel__content">
              <div class="mm-back" data-tab="property-owners">Back</div>
              <div class="mm-hstep">1</div><div class="mm-hstep">2</div>
            </div>
          </div>
        </div>
        <div class="mm-panel" data-panel="talk-to-team">
          <div class="mm-panel__inner"><div class="mm-panel__content">
            <button data-expand>Show steps</button>
            <div class="mm-assess"></div>
            <div class="mm-talk__reveal"></div>
          </div></div>
        </div>
      </div>
    </div>`;
  return document.querySelector(".mm");
}

// The controller reads the breakpoint through an injected MediaQueryList so both
// sides of 767px are testable without a real viewport.
function media(matches) {
  return { matches, addEventListener() {}, removeEventListener() {} };
}

const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const q = (sel) => document.querySelector(sel);
const panel = (key) => q(`.mm-panel[data-panel="${key}"]`);

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.style.overflow = "";
});

describe("desktop", () => {
  it("opens a panel from its top-level trigger and marks that trigger active", () => {
    const mm = fixture();
    initMegaMenu(mm, { mq: media(false) });

    click(q('.mm__trigger-wrap[data-open="solutions"] .mm__trigger'));

    expect(q(".mm__panels").classList.contains("is-open")).toBe(true);
    expect(panel("solutions").classList.contains("is-current")).toBe(true);
    expect(q('.mm__trigger-wrap[data-open="solutions"] .mm__trigger').classList.contains("is-active")).toBe(true);
    expect(q('.mm__trigger-wrap[data-open="property-owners"] .mm__trigger').classList.contains("is-active")).toBe(false);
  });

  it("closes when the already-open trigger is clicked again", () => {
    const mm = fixture();
    initMegaMenu(mm, { mq: media(false) });
    const trigger = q('.mm__trigger-wrap[data-open="solutions"] .mm__trigger');

    click(trigger);
    click(trigger);

    expect(q(".mm__panels").classList.contains("is-open")).toBe(false);
    expect(panel("solutions").classList.contains("is-current")).toBe(false);
  });

  it("keeps the parent trigger highlighted while a secondary panel is open", () => {
    const mm = fixture();
    initMegaMenu(mm, { mq: media(false) });

    click(q('[data-tab="how-it-works"]'));

    expect(panel("how-it-works").classList.contains("is-current")).toBe(true);
    expect(PARENT["how-it-works"]).toBe("property-owners");
    expect(q('.mm__trigger-wrap[data-open="property-owners"] .mm__trigger').classList.contains("is-active")).toBe(true);
  });

  it("back returns to the parent panel instead of closing", () => {
    const mm = fixture();
    initMegaMenu(mm, { mq: media(false) });
    click(q('[data-tab="how-it-works"]'));

    click(q(".mm-back"));

    expect(panel("property-owners").classList.contains("is-current")).toBe(true);
    expect(panel("how-it-works").classList.contains("is-current")).toBe(false);
  });

  it("Escape closes the menu and releases the scroll lock", () => {
    const mm = fixture();
    initMegaMenu(mm, { mq: media(false) });
    click(q('.mm__trigger-wrap[data-open="solutions"] .mm__trigger'));
    expect(document.documentElement.style.overflow).toBe("hidden");

    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(q(".mm__panels").classList.contains("is-open")).toBe(false);
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("staggers the step reveal", async () => {
    vi.useFakeTimers();
    const mm = fixture();
    initMegaMenu(mm, { mq: media(false) });

    click(q('[data-tab="how-it-works"]'));
    const steps = panel("how-it-works").querySelectorAll(".mm-hstep");
    expect(steps[0].classList.contains("is-in")).toBe(false);

    vi.advanceTimersByTime(100);
    expect(steps[0].classList.contains("is-in")).toBe(true);
    expect(steps[1].classList.contains("is-in")).toBe(false);

    vi.advanceTimersByTime(60);
    expect(steps[1].classList.contains("is-in")).toBe(true);
    vi.useRealTimers();
  });
});

describe("two-state card", () => {
  it("data-expand toggles is-expanded on the control and on the cards in its panel", () => {
    const mm = fixture();
    const api = initMegaMenu(mm, { mq: media(false) });
    api.openPanel("talk-to-team");
    const button = q("[data-expand]");

    click(button);
    expect(button.classList.contains("is-expanded")).toBe(true);
    expect(q(".mm-assess").classList.contains("is-expanded")).toBe(true);
    expect(q(".mm-talk__reveal").classList.contains("is-expanded")).toBe(true);

    click(button);
    expect(button.classList.contains("is-expanded")).toBe(false);
    expect(q(".mm-assess").classList.contains("is-expanded")).toBe(false);
  });

  it("a panel always reopens collapsed", () => {
    const mm = fixture();
    const api = initMegaMenu(mm, { mq: media(false) });
    api.openPanel("talk-to-team");
    click(q("[data-expand]"));

    api.openPanel("talk-to-team");

    expect(q(".mm-assess").classList.contains("is-expanded")).toBe(false);
  });
});

describe("mobile", () => {
  it("burger opens the drawer and flips the burger lines", () => {
    const mm = fixture();
    initMegaMenu(mm, { mq: media(true) });

    click(q(".mm__burger"));

    expect(q(".mm__panels").classList.contains("is-open")).toBe(true);
    expect(q(".mm__burger").classList.contains("is-active")).toBe(true);
    expect(q(".mm__burger-line").classList.contains("is-active")).toBe(true);
  });

  it("accordion opens one panel at a time and closes on a second tap", () => {
    const mm = fixture();
    initMegaMenu(mm, { mq: media(true) });
    click(q(".mm__burger")); // the drawer is what the accordion lives in
    const ownersInner = panel("property-owners").querySelector(".mm-panel__inner");
    const solutionsInner = panel("solutions").querySelector(".mm-panel__inner");

    click(panel("property-owners").querySelector(".mm-panel__head"));
    expect(ownersInner.classList.contains("is-open")).toBe(true);

    click(panel("solutions").querySelector(".mm-panel__head"));
    expect(solutionsInner.classList.contains("is-open")).toBe(true);
    expect(ownersInner.classList.contains("is-open")).toBe(false);

    click(panel("solutions").querySelector(".mm-panel__head"));
    expect(solutionsInner.classList.contains("is-open")).toBe(false);
  });

  it("a secondary panel opens as a slide-over and back closes only it", () => {
    const mm = fixture();
    initMegaMenu(mm, { mq: media(true) });
    click(q(".mm__burger"));
    click(panel("property-owners").querySelector(".mm-panel__head"));

    click(q('[data-tab="how-it-works"]'));
    expect(panel("how-it-works").classList.contains("is-current")).toBe(true);
    expect(panel("how-it-works").querySelector(".mm-panel__inner").classList.contains("is-open")).toBe(true);

    click(q(".mm-back"));
    expect(panel("how-it-works").classList.contains("is-current")).toBe(false);
    // the drawer underneath is untouched
    expect(q(".mm__panels").classList.contains("is-open")).toBe(true);
  });

  // A same-page anchor scrolls without reloading, so the drawer has to get out of
  // the way itself — otherwise it covers the section and keeps the page locked.
  it("a link in the drawer closes it and releases the scroll lock", () => {
    const mm = fixture();
    initMegaMenu(mm, { mq: media(true) });
    click(q(".mm__burger"));
    click(panel("solutions").querySelector(".mm-panel__head"));
    expect(document.documentElement.style.overflow).toBe("hidden");

    click(q('.mm-link[href="/#ready-to-get-started"]'));

    expect(q(".mm__panels").classList.contains("is-open")).toBe(false);
    expect(q(".mm__burger").classList.contains("is-active")).toBe(false);
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("a placeholder row leaves the drawer open", () => {
    const mm = fixture();
    initMegaMenu(mm, { mq: media(true) });
    click(q(".mm__burger"));
    click(panel("solutions").querySelector(".mm-panel__head"));

    click(q('.mm-link[href="#"]'));

    expect(q(".mm__panels").classList.contains("is-open")).toBe(true);
  });

  // Webflow's smooth scroll ignores scroll-padding-top and parks the heading under
  // the fixed bar, so the controller takes same-page anchors itself.
  it("scrolls a same-page anchor itself instead of letting Webflow do it", () => {
    const mm = fixture();
    const section = document.createElement("section");
    section.id = "ready-to-get-started";
    document.body.appendChild(section);
    const calls = [];
    section.scrollIntoView = (opts) => calls.push(opts);
    initMegaMenu(mm, { mq: media(true) });
    click(q(".mm__burger"));

    const ev = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    q('.mm-link[href="/#ready-to-get-started"]').dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].block).toBe("start");
    expect(q(".mm__panels").classList.contains("is-open")).toBe(false);
  });

  it("leaves a link to another page to the browser", () => {
    const mm = fixture();
    initMegaMenu(mm, { mq: media(true) });
    click(q(".mm__burger"));

    const ev = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    q('.mm-link[href="/pricing"]').dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(false);
    expect(q(".mm__panels").classList.contains("is-open")).toBe(false);
  });

  it("an outside click does not close the drawer on mobile", () => {
    const mm = fixture();
    initMegaMenu(mm, { mq: media(true) });
    click(q(".mm__burger"));

    click(document.body);

    expect(q(".mm__panels").classList.contains("is-open")).toBe(true);
  });
});
