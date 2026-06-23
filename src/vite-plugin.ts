import type { Plugin } from 'vite'
import {
  DEFAULT_INCLUDE,
  emitModule,
  renderCarve,
  type CarveTransformOptions,
} from './transform.js'

/**
 * Vite plugin that turns Carve modules (`*.crv`, `*.carve`) into JavaScript
 * modules exporting the rendered HTML and frontmatter. This is the engine
 * behind the Astro integration and is reusable on its own in any Vite app.
 */
export function carveVitePlugin(options: CarveTransformOptions = {}): Plugin {
  const include = options.include ?? DEFAULT_INCLUDE

  return {
    name: 'astro-carve:vite',
    enforce: 'pre',
    transform(source, id) {
      const [filename] = id.split('?', 1)
      if (!filename || !include.test(filename)) return null

      const result = renderCarve(source, options)
      return {
        code: emitModule(result),
        map: { mappings: '' },
      }
    },
  }
}

export default carveVitePlugin
