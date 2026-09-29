import { describe, it, expect, beforeEach } from "vitest";
import { initButtonNames } from "../src/button-names.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

// Mirrors the markup "Components | Button" renders on staymo.com.
function button({ text = "Get Estimate", icon = false, linkAttrs = "", linkText = "" } = {}) {
  return `
    <div class="c-button__wrap is-primary">
      <div class="c-button__text is-primary">${text}</div>
      ${icon ? '<div class="c-button__ico__slot"><svg><title>Arrow</title></svg>Icon</div>' : ""}
      <div class="c-button__link__slot">
        <a href="/start-hosting" class="v2-g--btn__link w-inline-block" ${linkAttrs}>${linkText}</a>
      </div>
      <div class="c-button__circle is-primary"></div>
    </div>`;
}

const links = () => Array.from(document.querySelectorAll("a.v2-g--btn__link"));

describe("initButtonNames", () => {
  it("names an empty link after the trimmed caption of its button", () => {
    document.body.innerHTML = button({ text: "\n   Get Estimate  " }) + button({ text: "Book a call" });
    initButtonNames();
    expect(links().map((a) => a.getAttribute("aria-label"))).toEqual(["Get Estimate", "Book a call"]);
  });

  it("names a target=_blank link the same way, without a suffix", () => {
    document.body.innerHTML = button({ linkAttrs: 'target="_blank"' });
    initButtonNames();
    expect(links()[0].getAttribute("aria-label")).toBe("Get Estimate");
  });

  it("keeps the icon slot out of the name", () => {
    document.body.innerHTML = button({ icon: true });
    initButtonNames();
    expect(links()[0].getAttribute("aria-label")).toBe("Get Estimate");
  });

  it("does not overwrite an existing aria-label", () => {
    document.body.innerHTML = button({ linkAttrs: 'aria-label="Start hosting"' });
    initButtonNames();
    expect(links()[0].getAttribute("aria-label")).toBe("Start hosting");
  });

  it("leaves a link named by aria-labelledby or its own text alone", () => {
    document.body.innerHTML =
      button({ linkAttrs: 'aria-labelledby="x"' }) + button({ linkText: "Start hosting" });
    initButtonNames();
    links().forEach((a) => expect(a.hasAttribute("aria-label")).toBe(false));
  });

  it("skips a button with an empty caption", () => {
    document.body.innerHTML = button({ text: "   " });
    initButtonNames();
    expect(links()[0].hasAttribute("aria-label")).toBe(false);
  });

  it("names the Button Link variant after its own caption", () => {
    document.body.innerHTML = `
      <div class="c-button-link__wrap">
        <div class="c-button-link__text">Book free expert consultation</div>
        <div class="c-button-link__ico"><svg><path d="M0 0"></path></svg></div>
        <div class="c-button-link__slot">
          <a href="https://book-call.staymo.com/" target="_blank" class="v2-g--btn__link w-inline-block"></a>
        </div>
      </div>`;
    initButtonNames();
    expect(links()[0].getAttribute("aria-label")).toBe("Book free expert consultation");
  });

  it("ignores a v2-g--btn__link outside a button wrap", () => {
    document.body.innerHTML = '<div class="c-button__text">Get Estimate</div><a class="v2-g--btn__link" href="/"></a>';
    initButtonNames();
    expect(links()[0].hasAttribute("aria-label")).toBe(false);
  });

  it("names a link in a hand-built u-v3-button-* parent after the parent's text", () => {
    document.body.innerHTML = `
      <div class="v3-prc--pl__btn u-v3-button-grey"><div>Start with onboarding</div><a href="/estimation-fixed-price" class="v2-g--btn__link w-inline-block"></a></div>
      <div class="v2-g--br__btn u-v3-button-violet"><a href="/start-hosting" class="v2-g--btn__link w-inline-block"></a><div>GET ESTIMATE</div></div>`;
    initButtonNames();
    expect(links().map((a) => a.getAttribute("aria-label"))).toEqual(["Start with onboarding", "Get Estimate"]);
  });

  it("keeps an existing aria-label in a hand-built button", () => {
    document.body.innerHTML =
      '<div class="calc-cta__btn u-v3-button-violet"><div>Get Estimate</div><a class="v2-g--btn__link" href="/" aria-label="Start hosting"></a></div>';
    initButtonNames();
    expect(links()[0].getAttribute("aria-label")).toBe("Start hosting");
  });
});
