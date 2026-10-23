import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, wikilinks, type CarveExtension } from '@markup-carve/carve'
import { load as loadYaml } from 'js-yaml'
import { globSync } from 'tinyglobby'

/** A content directory whose entries are wiki link targets. */
export interface CarveWikiCollection {
  /** Directory holding the entries, as for `carveLoader`. Relative to the project root. */
  base: string | URL
  /** URL template for an entry. `{id}` is replaced by the entry id, e.g. `/docs/{id}/`. */
  url: string
  /** Entry glob within `base`. Default `**\/*.crv`. */
  pattern?: string | string[]
}

export interface CarveWikilinksOptions {
  /** Collections searched for `[[Page]]` targets, in order. */
  collections?: CarveWikiCollection[]
  /** Custom resolver, tried first. Return `undefined` to fall through to the collections. */
  resolve?: (page: string) => string | undefined
  /** CSS class(es) on the anchor. Default `wikilink`. */
  cssClass?: string
  /** Open links in a new tab. Default `false`. */
  newWindow?: boolean
}

/** The same slug carve-js uses when no URL generator is given. */
export function wikiSlug(page: string): string {
  return page.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_/]/g, '').replace(/-+/g, '-')
}

/** Collection id policy shared with `carveLoader`: the YAML `slug`, else the path without `.crv`. */
export function defaultEntryId(base: string, file: string, data: Record<string, unknown>): string {
  return typeof data.slug === 'string' ? data.slug : relative(base, file).split(sep).join('/').replace(/\.crv$/, '')
}

function frontmatterData(file: string): Record<string, unknown> {
  const fm = parse(readFileSync(file, 'utf8')).frontmatter
  if (!fm || fm.format !== 'yaml') return {}
  let data: unknown
  // A malformed entry fails in its own render, not in every page linking to it.
  try { data = loadYaml(fm.content) } catch { return {} }
  return data !== null && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
}

function entryUrl(template: string, id: string): string {
  return template.replace(/\{id\}/g, id.split('/').map(encodeURIComponent).join('/'))
}

type Lookup = { url: string } | { ambiguous: string[] } | null

/** Lazily built map from page names to collection entry URLs. */
export class WikiIndex {
  private exact: Map<string, string[]> | undefined
  private byName: Map<string, string[]> | undefined
  readonly bases: { dir: string; url: string; patterns: string[] }[]

  constructor(collections: CarveWikiCollection[], projectRoot: string) {
    this.bases = collections.map(c => {
      const patterns = c.pattern === undefined ? ['**/*.crv'] : Array.isArray(c.pattern) ? c.pattern : [c.pattern]
      return { dir: c.base instanceof URL ? fileURLToPath(c.base) : resolve(projectRoot, c.base), url: c.url, patterns }
    })
  }

  /** True when `file` lies in a collection directory, so a change there can move a target. */
  covers(file: string): boolean {
    return this.bases.some(({ dir }) => {
      const inside = relative(dir, resolve(file))
      return inside === '' || (!isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`))
    })
  }

  invalidate(): void {
    this.exact = undefined
    this.byName = undefined
  }

  lookup(page: string): Lookup {
    if (!this.exact || !this.byName) this.build()
    const key = wikiSlug(page)
    const hits = this.exact!.get(key) ?? this.byName!.get(key.split('/').pop() ?? key) ?? []
    if (hits.length === 1) return { url: hits[0]! }
    return hits.length > 1 ? { ambiguous: hits } : null
  }

  /** Every target URL, so a caller can tell whether an edit moved one. */
  snapshot(): string {
    if (!this.exact || !this.byName) this.build()
    return JSON.stringify([...this.exact!].sort())
  }

  private build(): void {
    const exact = new Map<string, string[]>()
    const byName = new Map<string, string[]>()
    for (const { dir, url, patterns } of this.bases) {
      for (const file of globSync(patterns, { cwd: dir, absolute: true }).sort()) {
        const id = defaultEntryId(dir, resolve(file), frontmatterData(file))
        const key = wikiSlug(id)
        const href = entryUrl(url, id)
        for (const [map, k] of [[exact, key], [byName, key.split('/').pop() ?? key]] as const) {
          const list = map.get(k) ?? []
          if (!list.includes(href)) list.push(href)
          map.set(k, list)
        }
      }
    }
    this.exact = exact
    this.byName = byName
  }
}

/**
 * Build the carve-js `wikilinks` extension for one render. Unresolved and
 * ambiguous targets are reported through `warn` and keep carve-js's default slug.
 */
export function wikilinksExtension(options: CarveWikilinksOptions, index: WikiIndex | undefined, warn: (message: string) => void): CarveExtension {
  return wikilinks({
    cssClass: options.cssClass,
    newWindow: options.newWindow,
    urlGenerator: (page) => {
      if (page === '') return ''
      const custom = options.resolve?.(page)
      if (custom !== undefined) return custom
      if (!index) return wikiSlug(page)
      const found = index.lookup(page)
      if (found && 'url' in found) return found.url
      warn(found
        ? `Wiki link [[${page}]] matches several collection entries: ${found.ambiguous.join(', ')}`
        : `Wiki link [[${page}]] matches no collection entry`)
      return wikiSlug(page)
    },
  })
}
