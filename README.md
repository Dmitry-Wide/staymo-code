# staymo-code

Versioned front-end modules (JS/CSS) for the Staymo Webflow project, served via jsDelivr.

- `src/` — modules (vanilla ES, no build). `tests/` — Vitest + happy-dom.
- JS binds to `data-*` attributes only, never to classes.
- Release: `git tag vX.Y.Z && git push --tags`. CDN: `https://cdn.jsdelivr.net/gh/Dmitry-Wide/staymo-code@vX.Y.Z/src/<file>`.

## Local + Webflow from one URL

The jsDelivr URL is public, so the same `<script>`/`<link>` tags work when the
export page is opened locally AND when pasted into Webflow custom code. Build
locally against a version tag; when it works, paste the identical tags into
Webflow (Page settings → custom code / a Code component). Bump the tag to ship
a change — never reference `@latest` (cache + reproducibility). Each tag bump
changes the file, so **regenerate the `integrity="sha384-…"` SRI hash** and
update the tags; a stale hash blocks the file from loading.

Generate SRI for a released file:
```bash
curl -s "https://cdn.jsdelivr.net/gh/Dmitry-Wide/staymo-code@vX.Y.Z/src/chart.js" \
  | openssl dgst -sha384 -binary | openssl base64 -A
```
