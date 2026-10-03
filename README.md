# astro-carve

An [Astro](https://astro.build) integration for the
[Carve](https://markup-carve.github.io/carve/) markup language. It lets you
author content in `.crv` files and render it to HTML at build time
with [carve-js](https://github.com/markup-carve/carve-js)
(`@markup-carve/carve`).

## Install

```bash
npm install @markup-carve/astro-carve
```

`astro` is a peer dependency. carve-js (`@markup-carve/carve`) is a regular
dependency, installed from npm, so the command above is all that is needed.

## Usage

Add the integration to your Astro config:

```js
// astro.config.mjs
import { defineConfig } from 'astro/config'
import carve from '@markup-carve/astro-carve'

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

Each `.crv` module exports:

| Export            | Type                                       | Description                                              |
| ----------------- | ------------------------------------------ | -------------------------------------------------------- |
| `default`         | `string`                                   | The rendered HTML (same value as `html`).                |
| `html`            | `string`                                   | The carve-js-rendered HTML.                              |
| `source`          | `string`                                   | The raw Carve source.                                    |
| `frontmatter`     | `{ format, content } \| null`              | Raw frontmatter as Carve exposes it (verbatim, unparsed).|
| `frontmatterData` | `Record<string, unknown>`                  | YAML metadata, including nested values and dates.       |

Carve does not interpret frontmatter itself. This integration parses YAML
metadata for imports, page layouts, and collections. Non-YAML imports retain
the raw frontmatter and the existing simple scalar reader. Collections require
YAML. `parseFrontmatter: false` leaves metadata unparsed.

## Options

```js
carve({
  // Which module ids count as Carve. Default: /\.crv$/
  include: /\.crv$/,

  // Forwarded to carve-js carveToHtml (extensions, heading-id options, ...).
  render: {},

  // Parse YAML frontmatter into frontmatterData. Default true.
  parseFrontmatter: true,

  // Resolve includes and contain them to Astro's project root. Default true.
  includes: true,

  // Override the include containment root. Must be an absolute path.
  includeRoot: '/absolute/path/to/content',

  // Register .crv as Astro page extensions. Default false. See below.
  pageExtensions: false,
})
```

All carve-js render/parse options (including `extensions` for Tier-2 syntax)
pass through `render`.

Include paths resolve relative to the `.crv` file. Included files are watched,
so editing one invalidates the importing module. Set `includes: false` to leave
all include directives literal.

## Integration surfaces

- Verified and supported: importing a `.crv` file into an `.astro`
  page or component (`import html from './doc.crv'`). The example project
  builds this with a real `astro build` and the rendered Carve HTML appears in
  the static output.
- Direct `.crv` page routes: enable `carve({ pageExtensions: true })`. Files
  under `src/pages` compile to Astro components. Optional `layout` frontmatter
  names a component relative to the `.crv` file; that component receives the
  parsed metadata and a default slot containing the rendered document.
- Content collections: use `carveLoader` on Astro 5, 6, or 7. Collection YAML
  metadata is parsed before Astro validates it against the collection schema.

## Content collections

```ts
// src/content.config.ts
import { defineCollection, z } from 'astro:content'
import { carveLoader } from '@markup-carve/astro-carve'

export const collections = {
  docs: defineCollection({
    loader: carveLoader({ base: './src/content/docs' }),
    schema: z.object({ title: z.string(), tags: z.array(z.string()).optional() }),
  }),
}
```

Use Astro's `getCollection` and `render(entry)` to query and render these entries.
IDs default to the relative filename without `.crv`, or the YAML `slug` when
provided. `generateId` can override that policy. Duplicate IDs fail loading.
`pattern` defaults to `**/*.crv` and must stay within `base`.

YAML timestamps are dates, matching Astro's YAML frontmatter behavior. Non-YAML
collection frontmatter is rejected; imports still expose the raw format and text.

Local image paths are processed by Astro's asset pipeline. Keep public assets
as root-relative URLs. Missing local images fail the build. Includes use the project root as their containment root
and are watched for changes. The loader updates entries after source edits,
include edits, ID changes, and file removal. Failed schema validation stops
the build; development errors identify the affected source file.

Page routes, imports, and collections retain native Carve table rendering,
including merged cells and captions. Page routes remain opt-in. If an Astro
version lacks the page-extension hook, enabling them fails with an explanation
instead of creating an empty page. This release requires Astro 5.9 or newer.

## Vite plugin (standalone)

The transform is also exported as a standalone Vite plugin, so it works in any
Vite app, not only Astro:

```js
import { carveVitePlugin } from '@markup-carve/astro-carve'

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

Image paths in included files resolve relative to the entry that includes them. Collection image processing supports local JPEG, PNG, TIFF, WebP, GIF, SVG, and AVIF paths without URL query strings or fragments. Other image URLs retain their authored `src`; place those assets in `public/` and use root-relative URLs.
