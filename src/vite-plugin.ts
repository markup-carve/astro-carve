import type { Plugin } from 'vite'
import {
  DEFAULT_INCLUDE,
  emitModule,
  renderCarve,
  type CarveTransformOptions,
} from './transform.js'

/**
 * Vite plugin that turns Carve modules (`*.crv`) into JavaScript
 * modules exporting the rendered HTML and frontmatter. This is the engine
 * behind the Astro integration and is reusable on its own in any Vite app.
 */
export function carveVitePlugin(options: CarveTransformOptions = {}): Plugin {
  const include = options.include ?? DEFAULT_INCLUDE
  let projectRoot = process.cwd()

  return {
    name: 'astro-carve:vite',
    enforce: 'pre',
    configResolved(config) {
      projectRoot = config.root
    },
    transform(source, id) {
      const [filename] = id.split('?', 1)
      if (!filename || !include.test(filename)) return null

      const result = renderCarve(source, options, filename, projectRoot)
      for (const dependency of result.dependencies) this.addWatchFile(dependency)
      for (const warning of result.warnings) this.warn(warning)
      return {
        code: emitModule(result),
        map: { mappings: '' },
      }
    },
  }
}

export default carveVitePlugin
