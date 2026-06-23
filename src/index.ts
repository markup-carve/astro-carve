import type { AstroIntegration } from 'astro'
import { carveVitePlugin } from './vite-plugin.js'
import type { CarveTransformOptions } from './transform.js'

export type CarveIntegrationOptions = CarveTransformOptions & {
  /**
   * Register `.crv`/`.carve` as Astro page extensions via the (unstable,
   * undocumented) `addPageExtension` hook. Default `false`.
   *
   * Why off by default: registering the extension makes Astro treat a
   * `src/pages/*.crv` file as a route, but Astro renders the route module
   * as an Astro component. This integration's Vite transform emits a plain
   * HTML-string module, not an Astro component factory, so a registered
   * `.crv` route renders an empty `server:root` shell - the Carve HTML does
   * not appear. The reliable, content-producing surface is importing a
   * `.crv` file into an `.astro` page (`import html from './doc.crv'`).
   *
   * Set this to `true` only if you also supply a transform/renderer that
   * emits an Astro-component-compatible module for `.crv` files.
   */
  pageExtensions?: boolean
}

const PAGE_EXTENSIONS = ['.crv', '.carve']

/**
 * Astro integration for the Carve markup language.
 *
 * Wires a Vite plugin that compiles `.crv`/`.carve` files to modules
 * exporting the carve-js-rendered `html` (default export), the raw
 * `source`, the raw `frontmatter`, and parsed `frontmatterData`. This makes
 * `import html from './doc.crv'` work inside `.astro` components - the
 * surface verified by the example build.
 *
 * Page-extension registration (`addPageExtension`) is opt in and off by
 * default - see `pageExtensions`. With only an HTML-string transform, a
 * registered `.crv` route renders an empty shell, so the supported,
 * content-producing surface is the `.astro` import shown above.
 */
export default function carve(
  options: CarveIntegrationOptions = {},
): AstroIntegration {
  const wantPageExtensions = options.pageExtensions ?? false

  return {
    name: 'astro-carve',
    hooks: {
      'astro:config:setup': (params) => {
        const { updateConfig, logger } = params

        updateConfig({
          vite: {
            plugins: [carveVitePlugin(options)],
          },
        })

        // `addPageExtension` is an unstable, undocumented hook param. Feature
        // detect it rather than depend on it being present.
        const addPageExtension = (
          params as {
            addPageExtension?: (extensions: string[]) => void
          }
        ).addPageExtension

        if (wantPageExtensions && typeof addPageExtension === 'function') {
          addPageExtension(PAGE_EXTENSIONS)
          logger.info(
            `registered Carve page extensions: ${PAGE_EXTENSIONS.join(', ')}`,
          )
        } else if (wantPageExtensions) {
          logger.info(
            'addPageExtension is unavailable in this Astro version; ' +
              'Carve files are importable into .astro pages via the Vite ' +
              'plugin (import html from "./doc.crv").',
          )
        }
      },
    },
  }
}

export { carve, carveVitePlugin }
export {
  renderCarve,
  emitModule,
  parseSimpleFrontmatter,
  DEFAULT_INCLUDE,
} from './transform.js'
export type {
  CarveTransformOptions,
  CarveTransformResult,
  CarveFrontmatter,
} from './transform.js'
