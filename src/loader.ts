import type { Loader } from 'astro/loaders'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { glob } from 'tinyglobby'
import { localImages, imageImportPath } from './assets.js'
import { renderCarve, type CarveTransformOptions } from './transform.js'

export interface CarveLoaderOptions extends CarveTransformOptions {
  base: string | URL
  pattern?: string | string[]
  generateId?: (entry: { entry: string; data: Record<string, unknown> }) => string
}

/** Load file-backed Carve entries into Astro 5+ content collections. */
export function carveLoader(options: CarveLoaderOptions): Loader {
  let cleanup: (() => void) | undefined
  return {
    name: 'astro-carve:loader',
    async load(context) {
      cleanup?.()
      const projectRoot = fileURLToPath(context.config.root)
      const base = options.base instanceof URL ? fileURLToPath(options.base) : resolve(projectRoot, options.base)
      const pattern = options.pattern ?? '**/*.crv'
      const patterns = Array.isArray(pattern) ? pattern : [pattern]
      if (patterns.some(p => isAbsolute(p) || p.split(/[\\/]/).includes('..'))) {
        throw new Error('Carve loader patterns must stay within base')
      }
      const ids = new Set<string>()
      const owners = new Map<string, string>()
      const dependencies = new Map<string, Set<string>>()
      const sync = async (file: string): Promise<void> => {
        file = resolve(file)
        const source = await readFile(file, 'utf8')
        const result = renderCarve(source, options, file, projectRoot)
        const data = result.frontmatterData
        if (options.parseFrontmatter !== false && result.frontmatter && result.frontmatter.format !== 'yaml') {
          throw new Error(`${file}: collection frontmatter must be YAML`)
        }
        const entry = relative(base, file).split(sep).join('/')
        const id = options.generateId?.({ entry, data }) ?? (typeof data.slug === 'string' ? data.slug : entry.replace(/\.crv$/, ''))
        if (!id) throw new Error(`${file}: collection id must not be empty`)
        const owner = owners.get(id)
        if (owner && owner !== file) throw new Error(`Duplicate Carve collection id ${id}: ${owner} and ${file}`)
        let html = result.html
        const imagePaths: string[] = []
        const images = localImages(html).filter(image => /\.(?:jpeg|jpg|png|tiff|webp|gif|svg|avif)$/i.test(image.src))
        const occurrences = new Map<string, number>()
        const imageOptions = images.map(image => {
          const index = occurrences.get(image.src) ?? 0
          occurrences.set(image.src, index + 1)
          const decoded = imageImportPath(image.src)
          const src = decoded.startsWith('.') ? decoded : './' + decoded
          const attributes: Record<string, unknown> = { ...image.attributes, src, index }
          for (const key of ['width', 'height']) {
            const value = image.attributes[key]
            if (value !== undefined && /^\d+$/.test(value)) attributes[key] = Number(value)
          }
          imagePaths.push(src)
          return attributes
        })
        // Astro's content layer resolves these image references through the
        // entry's filePath and imagePaths metadata on supported majors.
        for (let i = images.length - 1; i >= 0; i--) {
          const image = images[i]!
          const tag = `<img __ASTRO_IMAGE_="${JSON.stringify(imageOptions[i]).replace(/</g, '\\u003c').replace(/&/g, '\\u0026').replace(/"/g, '&#x22;')}">`
          html = html.slice(0, image.tagStart) + tag + html.slice(image.tagEnd)
        }
        const parsed = await context.parseData({ id, data, filePath: file })
        for (const [oldId, oldOwner] of owners) {
          if (oldOwner === file && oldId !== id) { context.store.delete(oldId); owners.delete(oldId) }
        }
        for (const warning of result.warnings) context.logger.warn(`${file}: ${warning}`)
        context.store.set({ id, data: parsed, body: source, filePath: relative(projectRoot, file).split(sep).join('/'),
          digest: context.generateDigest({ source, html }), rendered: { html, metadata: { imagePaths, frontmatter: parsed, headings: result.headings } }, assetImports: imagePaths })
        owners.set(id, file)
        ids.add(id)
        dependencies.set(file, new Set(result.dependencies.map(dependency => resolve(dependency))))
        context.watcher?.add([file, ...result.dependencies])
      }
      const files = await glob(patterns, { cwd: base, absolute: true })
      for (const file of files.map(file => resolve(file)).sort()) await sync(file)
      for (const id of context.store.keys()) if (!ids.has(id)) context.store.delete(id)
      if (context.watcher) {
        const watcher = context.watcher
        watcher.add(base)
        const onUpdate = async (file: string): Promise<void> => {
          file = resolve(file)
          try {
            const inside = relative(base, file)
            const knownDependency = [...dependencies.values()].some(deps => deps.has(file))
            if (!knownDependency && (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`))) return
            const matches = await glob(patterns, { cwd: base, absolute: true })
            const affected = new Set([...dependencies].filter(([, deps]) => deps.has(file)).map(([owner]) => owner))
            if (matches.some(match => resolve(match) === file)) affected.add(file)
            for (const owner of affected) await sync(owner)
          } catch (error) { context.logger.error(String(error)) }
        }
        watcher.on('add', onUpdate)
        watcher.on('change', onUpdate)
        const onUnlink = async (file: string): Promise<void> => {
          file = resolve(file)
          for (const [id, owner] of owners) if (owner === file) { context.store.delete(id); owners.delete(id); dependencies.delete(file) }
          await onUpdate(file)
        }
        watcher.on('unlink', onUnlink)
        cleanup = () => { watcher.off('add', onUpdate); watcher.off('change', onUpdate); watcher.off('unlink', onUnlink) }
      }
    },
  }
}
