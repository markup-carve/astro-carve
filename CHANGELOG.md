# Changelog

Notable changes to `astro-carve`.

Rendering is done by the Carve engine (`@markup-carve/carve`), so an engine
change can alter output with no plugin diff. Engine bumps therefore get an
entry of their own.

## 0.1.0 - 2026-08-18

First release.

### Added

- Astro integration for the Carve markup language. `.crv` files work as pages
  and as imports, rendered to HTML at build time by carve-js.
- Astro 4, 5, 6 and 7 are accepted as a peer dependency (`>=4.0.0 <8.0.0`).

### Security

- Requires the Carve engine `@markup-carve/carve` >= 0.1.4 (`^0.1.4`). 0.1.4 is a
  security release: a list-valued URL attribute was only probed on its first
  entry, so `srcset="safe.png 1x, javascript:alert(1) 2x"` passed sanitization
  on the second one. Nothing published from this repo ever carried the older
  engine, so this is a floor rather than a fix for an installed version.
