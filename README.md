# staymo-code

Versioned front-end modules (JS/CSS) for the Staymo Webflow project, served via jsDelivr.

- `src/` — modules (vanilla ES, no build). `tests/` — Vitest + happy-dom.
- Exception: `src/beds-early.js` is not loaded from jsDelivr; the page pastes its code as an inline `<script>` (it must run before first paint, which no module can). Paste it again when it changes.
- JS binds to `data-*` attributes only, never to classes. Exception: markup a Webflow component owns and cannot carry `data-*` (`megamenu.js`, `button-names.js`); say so in the module header.
- Release: Actions → **Release** → Run workflow with `version: vX.Y.Z` (tests, tags main, prints SRI in the run summary; agents trigger it via the API since they cannot push tags). Manual fallback: `git tag vX.Y.Z && git push --tags`. CDN: `https://cdn.jsdelivr.net/gh/Dmitry-Wide/staymo-code@vX.Y.Z/src/<file>`.

## Release flow

No local copy of the site is kept: modules are tested here with Vitest and checked on the live/staging page.

1. **Tag.** Actions → **Release** → `version: vX.Y.Z` (runs tests, tags `main`, prints SRI in the run summary).
2. **SRI.** Take the `integrity="sha384-…"` hash from the run summary, or compute it:
   ```bash
   curl -s "https://cdn.jsdelivr.net/gh/Dmitry-Wide/staymo-code@vX.Y.Z/src/<file>" \
     | openssl dgst -sha384 -binary | openssl base64 -A
   ```
3. **Pin in Webflow.** Update the `<script>`/`<link>` tag (page or site custom code, or a Code component) to the new tag and hash. Done from `Dmitry-Wide/staymo-site`, not here. Never use `@latest`, and only jsDelivr — no githack or other CDN.
4. **Verify.** In staymo-site: `python3 tools/verify.py drift` (no unpinned or SRI-less staymo-code tags). Which page loads which module at which tag: staymo-site `docs/INVENTORY.md` (`tools/inventory.py`).
