# astro-carve

An [Astro](https://astro.build) integration for the
[Carve](https://markup-carve.github.io/carve/) markup language. It lets you
author content in `.crv` / `.carve` files and render it to HTML at build time
with [carve-js](https://github.com/markup-carve/carve-js)
(`@markup-carve/carve`).

## Install

```bash
npm install astro-carve
```

`astro` is a peer dependency. carve-js (`@markup-carve/carve`) is a regular
dependency, installed from its git repository.

## Usage

Add the integration to your Astro config:

```js
// astro.config.mjs
import { defineConfig } from 'astro/config'
import carve from 'astro-carve'

export default defineConfig({
  integrations: [carve()],
})
```

Author a Carve document, for example `src/content/doc.crv`:

```
---
title: Carve in Astro
---

# Carve in Astro

A paragraph with *bold*, /emphasis/, and _underline_.

- one
- two
```

Import it into an `.astro` page and render the HTML:

```astro
---
import html, { frontmatterData } from '../content/doc.crv'
const title = frontmatterData.title ?? 'Carve page'
---

<html lang="en">
  <head><title>{title}</title></head>
  <body>
    <main set:html={html} />
  </body>
</html>
```

The build emits the carve-js-rendered HTML into your static output.

## What a `.crv` import exports

Each `.crv` / `.carve` module exports:

| Export            | Type                                       | Description                                              |
| ----------------- | ------------------------------------------ | -------------------------------------------------------- |
| `default`         | `string`                                   | The rendered HTML (same value as `html`).                |
| `html`            | `string`                                   | The carve-js-rendered HTML.                              |
| `source`          | `string`                                   | The raw Carve source.                                    |
| `frontmatter`     | `{ format, content } \| null`              | Raw frontmatter as Carve exposes it (verbatim, unparsed).|
| `frontmatterData` | `Record<string, unknown>`                  | Simple `key: value` frontmatter parsed to scalars.       |

Carve does not interpret frontmatter itself. `frontmatterData` is a small,
dependency-free reader for flat scalar metadata (`title`, `draft`, numbers,
quoted strings). For structured YAML, run your own parser over
`frontmatter.content`.

## Options

```js
carve({
  // Which module ids count as Carve. Default: /\.(?:crv|carve)$/
  include: /\.(?:crv|carve)$/,

  // Forwarded to carve-js carveToHtml (extensions, heading-id options, ...).
  render: {},

  // Parse simple key: value frontmatter into frontmatterData. Default true.
  parseFrontmatter: true,

  // Register .crv/.carve as Astro page extensions. Default false. See below.
  pageExtensions: false,
})
```

All carve-js render/parse options (including `extensions` for Tier-2 syntax)
pass through `render`.

## Integration surfaces

- Verified and supported: importing a `.crv` / `.carve` file into an `.astro`
  page or component (`import html from './doc.crv'`). The example project
  builds this with a real `astro build` and the rendered Carve HTML appears in
  the static output.
- Off by default: page-extension routes (`pageExtensions: true`). Astro 7
  exposes an unstable `addPageExtension` hook, and the integration will call it
  when this option is on. However, registering the extension makes Astro render
  a `src/pages/*.crv` file as an Astro component; this integration's transform
  emits a plain HTML-string module, not an Astro component factory, so a
  registered `.crv` route renders an empty shell rather than the Carve HTML. A
  true page route would need a content-entry-type / renderer that emits an
  Astro-component-compatible module. Until that exists, use the `.astro` import
  surface for page routes.

## Vite plugin (standalone)

The transform is also exported as a standalone Vite plugin, so it works in any
Vite app, not only Astro:

```js
import { carveVitePlugin } from 'astro-carve'

export default {
  plugins: [carveVitePlugin()],
}
```

## TypeScript

Add an ambient declaration so `.crv` imports are typed:

```ts
// src/carve.d.ts
declare module '*.crv' {
  export const source: string
  export const html: string
  export const frontmatter: { format: string; content: string } | null
  export const frontmatterData: Record<string, unknown>
  const _default: string
  export default _default
}
```

## License

MIT
