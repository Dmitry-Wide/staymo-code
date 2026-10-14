/* Nav progress — instant feedback after a link click on the multi-page site.
   A plain left click on a same-origin link to another document sets
   <html data-nav="loading">; the site CSS (in Webflow, not here) shows a thin
   top bar on [data-nav-bar] while it is set. One <div data-nav-bar> is created
   lazily as the last child of body and reused.

   Listens on window in the bubble phase, so handlers that preventDefault
   (menus, modals, tabs) run first and a prevented click is skipped. Skipped
   too: modifier keys, non-left buttons, target other than _self, download
   links, non-http(s) and other-origin URLs, the same document (hash anchors)
   and anything inside [data-nav-progress="off"]; SVG links fall out at the
   target check (their target is not a string). The attribute is removed on
   a bfcache restore (pageshow persisted) and after 10 s (an attachment, a
   cancelled navigation). */

const TIMEOUT = 10000;

export function initNavProgress(win = window, doc = document) {
  let timer;
  const loc = win.location;
  const stop = () => {
    win.clearTimeout(timer);
    doc.documentElement.removeAttribute("data-nav");
  };

  win.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.("a[href]");
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
    if (a.closest('[data-nav-progress="off"]')) return;
    let url;
    try {
      url = new URL(a.href, loc.href);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || url.origin !== loc.origin) return;
    if (url.pathname === loc.pathname && url.search === loc.search) return;

    if (!doc.querySelector("[data-nav-bar]")) {
      const bar = doc.createElement("div");
      bar.setAttribute("data-nav-bar", "");
      bar.setAttribute("aria-hidden", "true");
      doc.body.appendChild(bar);
    }
    doc.documentElement.setAttribute("data-nav", "loading");
    win.clearTimeout(timer);
    timer = win.setTimeout(stop, TIMEOUT);
  });

  win.addEventListener("pageshow", (e) => {
    if (e.persisted) stop();
  });
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initNavProgress());
  else initNavProgress();
}
