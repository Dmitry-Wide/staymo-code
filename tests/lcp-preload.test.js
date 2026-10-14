import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Window } from "happy-dom";
import { initLcpPreload } from "../src/lcp-preload.js";

let hw, doc, win, pages, images, fetchCalls;

// Records the order of sizes/srcset/src writes; the Set in the module keeps it.
class FakeImage {
  constructor() {
    this.log = [];
    images.push(this);
  }
  addEventListener() {}
  set sizes(v) { this.log.push(["sizes", v]); }
  set srcset(v) { this.log.push(["srcset", v]); }
  set src(v) { this.log.push(["src", v]); }
}

function setup({ connection, media = {} } = {}) {
  hw = new Window({ url: "https://staymo.com/blog?page=2" });
  doc = hw.document;
  pages = {};
  images = [];
  fetchCalls = [];
  win = {
    location: new URL("https://staymo.com/blog?page=2"),
    navigator: { connection },
    DOMParser: hw.DOMParser,
    Image: FakeImage,
    matchMedia: (q) => ({ matches: !!media[q] }),
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: (...a) => clearTimeout(...a),
    fetch: vi.fn(async (url, opts) => {
      fetchCalls.push([url, opts]);
      const body = pages[url];
      return {
        ok: body !== undefined,
        headers: { get: () => (body?.type ?? "text/html; charset=utf-8") },
        text: async () => body?.html ?? body ?? ""
      };
    })
  };
  initLcpPreload(win, doc);
}

beforeEach(() => setup());

afterEach(() => {
  vi.useRealTimers();
  hw.close();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

async function touch(html, sel = "a") {
  doc.body.innerHTML = html;
  doc.querySelector(sel).dispatchEvent(new hw.Event("touchstart", { bubbles: true }));
  await flush();
}

const page = (head, body = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("initLcpPreload", () => {
  it("picks the preload link over an img and loads sizes, srcset, src in order", async () => {
    pages["https://staymo.com/areas/hackney"] = page(
      '<link rel="preload" as="image" href="hero.jpg" imagesrcset="hero-500.jpg 500w, /img/hero-1080.jpg 1080w" imagesizes="100vw">',
      '<img src="/other.jpg" fetchpriority="high">'
    );
    await touch('<a href="/areas/hackney">Hackney</a>');
    expect(fetchCalls).toEqual([["https://staymo.com/areas/hackney", { credentials: "same-origin", priority: "low" }]]);
    expect(images).toHaveLength(1);
    expect(images[0].fetchPriority).toBe("high");
    expect(images[0].decoding).toBe("async");
    expect(images[0].log).toEqual([
      ["sizes", "100vw"],
      ["srcset", "https://staymo.com/areas/hero-500.jpg 500w, https://staymo.com/img/hero-1080.jpg 1080w"],
      ["src", "https://staymo.com/areas/hero.jpg"]
    ]);
  });

  it("respects media on preload links", async () => {
    hw.close();
    setup({ media: { "(min-width: 768px)": true } });
    pages["https://staymo.com/x"] = page(
      '<link rel="preload" as="image" href="/mobile.jpg" media="(max-width: 767px)">' +
        '<link rel="preload" as="image" href="/desktop.jpg" media="(min-width: 768px)">'
    );
    await touch('<a href="/x">x</a>');
    expect(images[0].log).toEqual([["src", "https://staymo.com/desktop.jpg"]]);
  });

  it("falls back to img[fetchpriority=high], then img[loading=eager]", async () => {
    pages["https://staymo.com/a"] = page(
      '<link rel="preload" as="image" href="/no.jpg" media="(max-width: 1px)">',
      '<img src="/lazy.jpg" loading="lazy"><img src="/eager.jpg" loading="eager"><img src="hi.jpg" srcset="hi-2x.jpg 2x" fetchpriority="high">'
    );
    pages["https://staymo.com/b"] = page("", '<img src="/lazy.jpg" loading="lazy"><img src="/eager.jpg" loading="eager" sizes="50vw">');
    await touch('<a href="/a">a</a>');
    expect(images[0].log).toEqual([
      ["srcset", "https://staymo.com/hi-2x.jpg 2x"],
      ["src", "https://staymo.com/hi.jpg"]
    ]);
    await touch('<a href="/b">b</a>');
    expect(images[1].log).toEqual([
      ["sizes", "50vw"],
      ["src", "https://staymo.com/eager.jpg"]
    ]);
  });

  it("resolves relative URLs against the target page, keeping absolute ones", async () => {
    pages["https://staymo.com/deep/path/page"] = page(
      "",
      '<img fetchpriority="high" src="../img/a.jpg" srcset="a,1.jpg, ../img/b.jpg 2x,https://cdn.example.com/c.jpg 3x">'
    );
    await touch('<a href="/deep/path/page#top">x</a>');
    expect(fetchCalls[0][0]).toBe("https://staymo.com/deep/path/page");
    expect(images[0].log).toEqual([
      ["srcset", "https://staymo.com/deep/path/a,1.jpg, https://staymo.com/deep/img/b.jpg 2x, https://cdn.example.com/c.jpg 3x"],
      ["src", "https://staymo.com/deep/img/a.jpg"]
    ]);
  });

  it("ignores non-html, failed responses and pages without a main image", async () => {
    pages["https://staymo.com/pdf"] = { type: "application/pdf", html: page("", '<img fetchpriority="high" src="/a.jpg">') };
    pages["https://staymo.com/none"] = page("", '<img src="/a.jpg">');
    await touch('<a href="/pdf">x</a>');
    await touch('<a href="/missing">x</a>');
    await touch('<a href="/none">x</a>');
    expect(fetchCalls).toHaveLength(3);
    expect(images).toHaveLength(0);
  });

  it.each([
    ["another origin", '<a href="https://example.com/x">x</a>'],
    ["http on an https page", '<a href="http://staymo.com/x">x</a>'],
    ["mailto:", '<a href="mailto:hi@staymo.com">x</a>'],
    ["the same document", '<a href="/blog?page=2#faq">x</a>'],
    ["a bare hash", '<a href="#top">x</a>'],
    ["target=_blank", '<a href="/x" target="_blank">x</a>'],
    ["a download link", '<a href="/x.pdf" download>x</a>'],
    ["data-no-prefetch on an ancestor", '<nav data-no-prefetch><a href="/x">x</a></nav>'],
    ["an unparseable href", '<a href="http://[bad">x</a>']
  ])("skips %s", async (_, html) => {
    await touch(html);
    expect(win.fetch).not.toHaveBeenCalled();
  });

  it("follows target=_self", async () => {
    await touch('<a href="/x" target="_self">x</a>');
    expect(win.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["saveData", { saveData: true }],
    ["2g", { effectiveType: "2g" }],
    ["slow-2g", { effectiveType: "slow-2g" }]
  ])("does nothing under %s", async (_, connection) => {
    hw.close();
    setup({ connection });
    await touch('<a href="/x">x</a>');
    expect(win.fetch).not.toHaveBeenCalled();
  });

  it("is a no-op without fetch or DOMParser", async () => {
    for (const missing of ["fetch", "DOMParser"]) {
      hw.close();
      setup();
      const w = { ...win, [missing]: undefined };
      const other = new Window({ url: "https://staymo.com/" });
      initLcpPreload(w, other.document);
      other.document.body.innerHTML = '<a href="/x">x</a>';
      other.document.querySelector("a").dispatchEvent(new other.Event("touchstart", { bubbles: true }));
      await flush();
      expect(win.fetch).not.toHaveBeenCalled();
      other.close();
    }
  });

  it("fetches a URL once and stops after 8 targets", async () => {
    await touch('<a href="/p0">x</a>');
    await touch('<a href="/p0#a">x</a>');
    for (let i = 1; i < 12; i++) await touch(`<a href="/p${i}">x</a>`);
    expect(fetchCalls.map((c) => c[0])).toEqual([...Array(8)].map((_, i) => `https://staymo.com/p${i}`));
  });

  it("fires on focusin at once", async () => {
    doc.body.innerHTML = '<a href="/x">x</a>';
    doc.querySelector("a").dispatchEvent(new hw.FocusEvent("focusin", { bubbles: true }));
    await flush();
    expect(win.fetch).toHaveBeenCalledTimes(1);
  });

  describe("mouse hover", () => {
    const over = (el, pointerType = "mouse") =>
      el.dispatchEvent(new hw.PointerEvent("pointerover", { bubbles: true, pointerType }));
    const out = (el, relatedTarget = null) =>
      el.dispatchEvent(new hw.PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget }));

    beforeEach(() => {
      vi.useFakeTimers();
      doc.body.innerHTML = '<a href="/x"><span>inner</span></a><p>gap</p>';
    });

    it("starts after 80 ms on the same link, moving inside it included", () => {
      const a = doc.querySelector("a");
      over(a);
      vi.advanceTimersByTime(50);
      out(a, a.firstChild);
      over(a.firstChild);
      vi.advanceTimersByTime(29);
      expect(win.fetch).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(win.fetch).toHaveBeenCalledTimes(1);
    });

    it("cancels on pointerout before the dwell", () => {
      const a = doc.querySelector("a");
      over(a);
      vi.advanceTimersByTime(60);
      out(a, doc.querySelector("p"));
      over(doc.querySelector("p"));
      vi.advanceTimersByTime(200);
      expect(win.fetch).not.toHaveBeenCalled();
    });

    it("leaves touch pointers to touchstart", () => {
      over(doc.querySelector("a"), "touch");
      vi.advanceTimersByTime(200);
      expect(win.fetch).not.toHaveBeenCalled();
    });
  });
});
