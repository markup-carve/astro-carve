import { relative, isAbsolute, sep } from 'node:path'
import type { Plugin } from 'vite'
import {
  DEFAULT_INCLUDE,
  emitModule,
  emitPageModule,
  renderCarve,
  type CarveTransformOptions,
} from './transform.js'
import { WikiIndex } from './wikilinks.js'
import { codeCollector, highlighterFor } from './highlight.js'

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
  let wikiIndex: WikiIndex | undefined
  const collections = typeof options.wikilinks === 'object' ? options.wikilinks.collections ?? [] : []

  return {
    name: 'astro-carve:vite',
    enforce: 'pre',
    configResolved(config) {
      projectRoot = config.root
      if (collections.length > 0) wikiIndex = new WikiIndex(collections, config.root)
    },
    watchChange(id) {
      // An edit can change a frontmatter slug, so every event rebuilds the index.
      if (wikiIndex?.covers(id)) wikiIndex.invalidate()
    },
    async transform(source, id) {
      const [filename] = id.split('?', 1)
      include.lastIndex = 0
      if (!filename || !include.test(filename)) return null

      const highlighter = await highlighterFor(options.highlight)
      const collector = highlighter ? codeCollector(highlighter) : undefined
      const result = renderCarve(source, options, filename, projectRoot, wikiIndex, collector ? [collector.extension] : [])
      if (collector) result.html = await collector.apply(result.html)
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
