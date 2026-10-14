/* LCP preload — warm the next page's hero image on hover intent.
   Speculation Rules prefetch fetches only the next page's HTML, so with
   cross-document View Transitions the next page reveals while its hero photo
   is still loading. On intent to follow a same-site link this fetches the
   target HTML, picks its main image and loads it with new Image(), so the
   photo is in the HTTP cache before the navigation.

   Intent: pointerover with a mouse after 80 ms on the same link (pointerout
   cancels), touchstart and focusin at once; all delegated on document.
   Links: a[href], target empty or _self, no download, http(s), same origin,
   not the same document, not inside [data-no-prefetch]. Off under Save-Data
   or a 2g connection; at most 8 targets per page, each URL once.

   Main image of the target, first found: a link[rel~=preload][as=image] whose
   media matches (imagesrcset, imagesizes, href), img[fetchpriority=high],
   img[loading=eager]. URLs resolve against the target page. sizes, srcset,
   then src are set in that order so the browser picks the candidate the page
   will. No-op without fetch or DOMParser; no DOM writes. */

const DWELL = 80;
const MAX_TARGETS = 8;

export function initLcpPreload(win = window, doc = document) {
  if (typeof win.fetch !== "function" || typeof win.DOMParser !== "function") return;
  const conn = win.navigator?.connection;
  if (conn?.saveData || ["slow-2g", "2g"].includes(conn?.effectiveType)) return;

  const loc = win.location;
  const seen = new Set();
  const loading = new Set(); // keeps Image objects alive until they settle
  let hoverLink = null;
  let hoverTimer;

  const targetOf = (a) => {
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return null;
    if (a.closest("[data-no-prefetch]")) return null;
    let url;
    try {
      url = new URL(a.href, loc.href);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(url.protocol) || url.origin !== loc.origin) return null;
    if (url.pathname === loc.pathname && url.search === loc.search) return null;
    url.hash = "";
    return url;
  };

  const go = (a) => {
    const url = targetOf(a);
    if (!url || seen.has(url.href) || seen.size >= MAX_TARGETS) return;
    seen.add(url.href);
    preload(url).catch(() => {});
  };

  async function preload(url) {
    const res = await win.fetch(url.href, { credentials: "same-origin", priority: "low" });
    if (!res.ok || !/text\/html/i.test(res.headers.get("content-type") || "")) return;
    const page = new win.DOMParser().parseFromString(await res.text(), "text/html");
    const pick = mainImage(page, url.href);
    if (!pick || (!pick.src && !pick.srcset)) return;
    const img = new win.Image();
    img.fetchPriority = "high";
    img.decoding = "async";
    loading.add(img);
    const done = () => loading.delete(img);
    img.addEventListener("load", done);
    img.addEventListener("error", done);
    if (pick.sizes) img.sizes = pick.sizes;
    if (pick.srcset) img.srcset = pick.srcset;
    if (pick.src) img.src = pick.src;
  }

  function mainImage(page, base) {
    const abs = (u) => {
      try {
        return u ? new URL(u, base).href : "";
      } catch {
        return "";
      }
    };
    const matches = (media) => !media || !win.matchMedia || win.matchMedia(media).matches;
    const link = [...page.querySelectorAll('link[rel~="preload"][as="image"]')].find((l) =>
      matches(l.getAttribute("media"))
    );
    if (link) {
      return {
        src: abs(link.getAttribute("href")),
        srcset: resolveSrcset(link.getAttribute("imagesrcset"), abs),
        sizes: link.getAttribute("imagesizes") || ""
      };
    }
    const img = page.querySelector('img[fetchpriority="high"]') || page.querySelector('img[loading="eager"]');
    if (!img) return null;
    return {
      src: abs(img.getAttribute("src")),
      srcset: resolveSrcset(img.getAttribute("srcset"), abs),
      sizes: img.getAttribute("sizes") || ""
    };
  }

  const cancelHover = () => {
    win.clearTimeout(hoverTimer);
    hoverLink = null;
  };

  doc.addEventListener("pointerover", (e) => {
    if (e.pointerType && e.pointerType !== "mouse") return;
    const a = e.target.closest?.("a[href]");
    if (a === hoverLink) return;
    cancelHover();
    if (!a) return;
    hoverLink = a;
    hoverTimer = win.setTimeout(() => {
      hoverLink = null;
      go(a);
    }, DWELL);
  });

  doc.addEventListener("pointerout", (e) => {
    if (!hoverLink) return;
    if (e.relatedTarget && hoverLink.contains(e.relatedTarget)) return;
    cancelHover();
  });

  const now = (e) => go(e.target.closest?.("a[href]"));
  doc.addEventListener("touchstart", now, { passive: true });
  doc.addEventListener("focusin", now);
}

// Rewrites each candidate URL of a srcset against the target page; a URL is a
// run of non-space characters, its trailing commas end the candidate.
function resolveSrcset(srcset, abs) {
  if (!srcset) return "";
  const out = [];
  const s = srcset;
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    if (i >= s.length) break;
    let j = i;
    while (j < s.length && !/\s/.test(s[j])) j++;
    let url = s.slice(i, j);
    let desc = "";
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
    } else {
      const k = s.indexOf(",", j);
      const end = k === -1 ? s.length : k;
      desc = s.slice(j, end).trim();
      j = end;
    }
    i = j;
    const u = abs(url);
    if (u) out.push(desc ? `${u} ${desc}` : u);
  }
  return out.join(", ");
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initLcpPreload());
  else initLcpPreload();
}
