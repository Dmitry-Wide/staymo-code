# staymo-code

Versioned front-end modules (JS/CSS) for the Staymo Webflow project, served via jsDelivr.

- `src/` — modules (vanilla ES, no build). `tests/` — Vitest + happy-dom.
- JS binds to `data-*` attributes only, never to classes.
- Release: `git tag vX.Y.Z && git push --tags`. CDN: `https://cdn.jsdelivr.net/gh/Dmitry-Wide/staymo-code@vX.Y.Z/src/<file>`.
