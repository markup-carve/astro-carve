import { fileURLToPath } from 'node:url'
import type { AstroIntegration } from 'astro'
import { carveVitePlugin } from './vite-plugin.js'
import type { CarveTransformOptions } from './transform.js'

export type CarveIntegrationOptions = CarveTransformOptions & {
  /** Render `src/pages/*.crv` as Astro components. Default `false`. */
  pageExtensions?: boolean
}

const PAGE_EXTENSIONS = ['.crv']

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
            // Astro majors use different Vite type versions. This plugin uses
            // their shared configResolved and transform hooks.
            plugins: [carveVitePlugin(options, wantPageExtensions ? fileURLToPath(new URL('pages/', params.config.srcDir)) : undefined)] as unknown as NonNullable<Parameters<typeof updateConfig>[0]['vite']>['plugins'],
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
          throw new Error(
            'addPageExtension is unavailable in this Astro version; ' +
              'Use .crv imports in .astro pages instead.',
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
  emitPageModule,
  parseSimpleFrontmatter,
  DEFAULT_INCLUDE,
} from './transform.js'
export type {
  CarveTransformOptions,
  CarveTransformResult,
  CarveFrontmatter,
} from './transform.js'

export { carveLoader, type CarveLoaderOptions } from './loader.js'
