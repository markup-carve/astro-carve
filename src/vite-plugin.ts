import { relative, isAbsolute, sep } from 'node:path'
import type { Plugin } from 'vite'
import {
  DEFAULT_INCLUDE,
  emitModule,
  emitPageModule,
  renderCarve,
  type CarveTransformOptions,
} from './transform.js'

/**
 * Vite plugin that turns Carve modules (`*.crv`) into JavaScript
 * modules exporting the rendered HTML and frontmatter. This is the engine
 * behind the Astro integration and is reusable on its own in any Vite app.
 */
export function carveVitePlugin(options: CarveTransformOptions = {}, pageRoot?: string): Plugin {
  const include = options.include ?? DEFAULT_INCLUDE
  // Undefined until Vite resolves its config, so a transform that somehow runs
  // first falls back to the document's own directory rather than to the process
  // working directory, which I10 forbids as a containment root.
  let projectRoot: string | undefined

  return {
    name: 'astro-carve:vite',
    enforce: 'pre',
    configResolved(config) {
      projectRoot = config.root
    },
    transform(source, id) {
      const [filename] = id.split('?', 1)
      include.lastIndex = 0
      if (!filename || !include.test(filename)) return null

      const result = renderCarve(source, options, filename, projectRoot)
      for (const dependency of result.dependencies) this.addWatchFile(dependency)
      for (const warning of result.warnings) this.warn(warning)
      const pagePath = pageRoot ? relative(pageRoot, filename) : undefined
      const isPage = pagePath !== undefined && !isAbsolute(pagePath) && pagePath !== '..' && !pagePath.startsWith(`..${sep}`) && !pagePath.split(sep).some(segment => segment.startsWith('_'))
      return {
        code: isPage
          ? emitPageModule(result) : emitModule(result, true),
        map: { mappings: '' },
      }
    },
  }
}

export default carveVitePlugin
