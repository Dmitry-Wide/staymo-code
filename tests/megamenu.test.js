import { describe, it, expect, beforeEach } from "vitest";
import { initMegaMenu } from "../src/megamenu.js";

// Markup mirrors the live Webflow structure: a bar of triggers, a panels surface
// holding one .mm-panel per key. A leftover secondary-panel hook (data-tab) is
// kept in the markup to prove it no longer does anything.
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

  it("Escape closes the menu and releases the scroll lock", () => {
    const mm = fixture();
    initMegaMenu(mm, { mq: media(false) });
    click(q('.mm__trigger-wrap[data-open="solutions"] .mm__trigger'));
    expect(document.documentElement.style.overflow).toBe("hidden");

    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(q(".mm__panels").classList.contains("is-open")).toBe(false);
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("fades the panel content in and resets it on close", () => {
    const mm = fixture();
    const api = initMegaMenu(mm, { mq: media(false) });
    const content = panel("solutions").querySelector(".mm-panel__content");

    api.openPanel("solutions");
    expect(content.classList.contains("is-in")).toBe(true);

    api.closeAll();
    expect(content.classList.contains("is-in")).toBe(false);
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

  it("a leftover data-tab hook does nothing (secondary panels removed 2026-08-12)", () => {
    const mm = fixture();
    initMegaMenu(mm, { mq: media(true) });
    click(q(".mm__burger"));
    click(panel("property-owners").querySelector(".mm-panel__head"));

    click(q('[data-tab="how-it-works"]'));

    expect(q(".mm__panels").classList.contains("is-open")).toBe(true);
    expect(panel("property-owners").querySelector(".mm-panel__inner").classList.contains("is-open")).toBe(true);
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
    // Webflow's own smooth scroll is delegated on document; the click must not reach it.
    let reachedDocument = 0;
    const spy = () => reachedDocument++;
    document.addEventListener("click", spy);
    initMegaMenu(mm, { mq: media(true) });
    click(q(".mm__burger"));
    reachedDocument = 0;

    const ev = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    q('.mm-link[href="/#ready-to-get-started"]').dispatchEvent(ev);
    document.removeEventListener("click", spy);

    expect(ev.defaultPrevented).toBe(true);
    expect(reachedDocument).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].block).toBe("start");
    expect(q(".mm__panels").classList.contains("is-open")).toBe(false);
  });

  it("leaves a link to another page to the browser", () => {
    const mm = fixture();
    let reachedDocument = 0;
    const spy = () => reachedDocument++;
    initMegaMenu(mm, { mq: media(true) });
    click(q(".mm__burger"));
    document.addEventListener("click", spy);

    const ev = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    q('.mm-link[href="/pricing"]').dispatchEvent(ev);
    document.removeEventListener("click", spy);

    expect(ev.defaultPrevented).toBe(false);
    expect(reachedDocument).toBe(1);
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

describe("aria state", () => {
  const trig = (key) => q(`.mm__trigger-wrap[data-open="${key}"] .mm__trigger`);

  it("wires aria-controls and starts collapsed", () => {
    initMegaMenu(fixture(), { mq: media(false) });
    expect(q(".mm__burger").getAttribute("aria-expanded")).toBe("false");
    expect(q(".mm__burger").getAttribute("aria-controls")).toBe(q(".mm__panels").id);
    expect(trig("solutions").getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(trig("solutions").getAttribute("aria-controls"))).toBe(panel("solutions"));
  });

  it("desktop trigger reports open/closed", () => {
    initMegaMenu(fixture(), { mq: media(false) });
    click(trig("solutions"));
    expect(trig("solutions").getAttribute("aria-expanded")).toBe("true");
    expect(trig("property-owners").getAttribute("aria-expanded")).toBe("false");
    click(trig("property-owners"));
    expect(trig("solutions").getAttribute("aria-expanded")).toBe("false");
    expect(trig("property-owners").getAttribute("aria-expanded")).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(trig("property-owners").getAttribute("aria-expanded")).toBe("false");
  });

  it("burger reports open/closed", () => {
    initMegaMenu(fixture(), { mq: media(true) });
    click(q(".mm__burger"));
    expect(q(".mm__burger").getAttribute("aria-expanded")).toBe("true");
    click(q(".mm__burger"));
    expect(q(".mm__burger").getAttribute("aria-expanded")).toBe("false");
  });
});
