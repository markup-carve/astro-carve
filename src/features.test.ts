import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LoaderContext } from 'astro/loaders'
import type { Plugin } from 'vite'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { carveLoader } from './loader.js'
import { renderCarve } from './transform.js'
import { carveVitePlugin } from './vite-plugin.js'

const roots: string[] = []
function site(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'astro-carve-features-'))
  roots.push(root)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function hook<T extends (...args: never[]) => unknown>(plugin: Plugin, name: 'transform' | 'configResolved' | 'watchChange'): T {
  const h = plugin[name] as unknown
  return (typeof h === 'function' ? h : (h as { handler: T }).handler) as T
}

describe('@region includes', () => {
  test('splice only the named region of the included file', () => {
    const root = site({ 'shared.crv': 'Before.\n\n%% #region intro\nInside the region.\n%% #endregion\n\nAfter.\n' })
    const { html, warnings } = renderCarve('{{ shared.crv @region:intro }}', {}, join(root, 'page.crv'), root)
    expect(html).toContain('Inside the region.')
    expect(html).not.toContain('Before.')
    expect(html).not.toContain('After.')
    expect(warnings).toEqual([])
  })

  test('report a missing region instead of splicing the whole file', () => {
    const root = site({ 'shared.crv': 'Whole file.\n' })
    const { html, warnings } = renderCarve('{{ shared.crv @region:nope }}', {}, join(root, 'page.crv'), root)
    expect(html).not.toContain('Whole file.')
    expect(warnings.join('\n')).toMatch(/region "nope"/)
  })
})

describe('lint', () => {
  const source = '# A\n\n# A\n\nGo to [x](#nowhere). Fixes #12.\n'

  test('is off by default', () => {
    expect(renderCarve(source).warnings).toEqual([])
  })

  test('reports findings with rule id and position', () => {
    const { warnings } = renderCarve(source, { lint: true })
    expect(warnings.some(w => w.endsWith('[duplicate-heading-id] (line 3, column 1)'))).toBe(true)
    expect(warnings.some(w => w.includes('[broken-fragment-link] (line 5, column 7)'))).toBe(true)
    expect(warnings.some(w => w.includes('platform-issue-reference'))).toBe(false)
  })

  test('adds platform rules on request', () => {
    const { warnings } = renderCarve(source, { lint: { platforms: ['github'] } })
    expect(warnings.some(w => w.includes('[platform-issue-reference]'))).toBe(true)
  })

  test('names the included file a finding comes from', () => {
    const root = site({ 'part.crv': 'See [x](#gone).\n' })
    const { warnings } = renderCarve('{{ part.crv }}\n', { lint: true }, join(root, 'page.crv'), root)
    expect(warnings.some(w => w.includes('[broken-fragment-link]') && w.includes('part.crv'))).toBe(true)
  })

  test('reaches the Vite warnings channel', () => {
    const root = site({})
    const plugin = carveVitePlugin({ lint: true })
    const warn = vi.fn()
    hook<(this: unknown, s: string, id: string) => unknown>(plugin, 'transform').call({ warn, addWatchFile: vi.fn() }, '[x](#nowhere)\n', join(root, 'doc.crv'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[broken-fragment-link]'))
  })
})

describe('wiki links', () => {
  const docs = {
    'src/content/docs/getting-started.crv': '# Getting started\n',
    'src/content/docs/guides/tigers.crv': '# Tigers\n',
    'src/content/docs/renamed.crv': '---\nslug: custom-slug\n---\n\n# Renamed\n',
    'src/content/docs/a/dup.crv': 'A\n',
    'src/content/docs/b/dup.crv': 'B\n',
  }
  const options = (root: string) => ({ wikilinks: { collections: [{ base: join(root, 'src/content/docs'), url: '/docs/{id}/' }] } })

  test('stay literal unless enabled', () => {
    expect(renderCarve('See [[Tigers]].').html).toContain('[[Tigers]]')
  })

  test('use the carve-js slug when enabled without collections', () => {
    expect(renderCarve('See [[Big Cats]].', { wikilinks: true }).html).toContain('href="big-cats"')
  })

  test('resolve against collection ids, file names and frontmatter slugs', () => {
    const root = site(docs)
    const { html, warnings } = renderCarve('[[Getting Started]] [[Tigers|big cats]] [[guides/tigers#stripes]] [[custom-slug]] [[#top]]', options(root), undefined, root)
    expect(html).toContain('<a href="/docs/getting-started/" class="wikilink" data-wikilink="Getting Started">Getting Started</a>')
    expect(html).toContain('href="/docs/guides/tigers/"')
    expect(html).toContain('>big cats</a>')
    expect(html).toContain('href="/docs/guides/tigers/#stripes"')
    expect(html).toContain('href="/docs/custom-slug/"')
    expect(html).toContain('href="#top"')
    expect(warnings).toEqual([])
  })

  test('warn on a missing or ambiguous target and keep the default slug', () => {
    const root = site(docs)
    const { html, warnings } = renderCarve('[[Lions]] [[dup]] [[Lions]]', options(root), undefined, root)
    expect(html).toContain('href="lions"')
    expect(warnings).toEqual([
      'Wiki link [[Lions]] matches no collection entry',
      'Wiki link [[dup]] matches several collection entries: /docs/a/dup/, /docs/b/dup/',
    ])
  })

  test('try a custom resolver first', () => {
    const root = site(docs)
    const resolve = (page: string) => page === 'Tigers' ? 'https://example.org/tigers' : undefined
    const { html } = renderCarve('[[Tigers]] [[Getting Started]]', { wikilinks: { ...options(root).wikilinks, resolve } }, undefined, root)
    expect(html).toContain('href="https://example.org/tigers"')
    expect(html).toContain('href="/docs/getting-started/"')
  })

  test('resolve relative collection bases against the Vite root and see new entries after a watch event', () => {
    const root = site(docs)
    const plugin = carveVitePlugin({ wikilinks: { collections: [{ base: 'src/content/docs', url: '/docs/{id}/' }] } })
    hook<(c: { root: string }) => void>(plugin, 'configResolved')({ root })
    const transform = (s: string) => hook<(this: unknown, s: string, id: string) => { code: string }>(plugin, 'transform').call({ warn: vi.fn(), addWatchFile: vi.fn() }, s, join(root, 'src/pages/x.crv')).code
    expect(transform('[[Tigers]]')).toContain('/docs/guides/tigers/')
    expect(transform('[[Lions]]')).toContain('href=\\"lions\\"')
    writeFileSync(join(root, 'src/content/docs/lions.crv'), '# Lions\n')
    hook<(id: string) => void>(plugin, 'watchChange')(join(root, 'src/content/docs/lions.crv'))
    expect(transform('[[Lions]]')).toContain('/docs/lions/')
  })

  test('relink loader entries when a target is added', async () => {
    const root = site({ 'docs/home.crv': 'See [[Lions]].\n' })
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
    const store = new Map<string, any>()
    const logger = { warn: vi.fn(), error: vi.fn() }
    const context = { config: { root: pathToFileURL(root + '/') }, store: { set: (e: any) => store.set(e.id, e), keys: () => [...store.keys()], delete: (id: string) => store.delete(id) },
      watcher, parseData: async ({ data }: any) => data, generateDigest: JSON.stringify, logger } as unknown as LoaderContext
    await carveLoader({ base: './docs', wikilinks: { collections: [{ base: './docs', url: '/docs/{id}/' }] } }).load(context)
    expect(store.get('home').rendered.html).toContain('href="lions"')
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[[Lions]] matches no collection entry'))
    writeFileSync(join(root, 'docs/lions.crv'), '# Lions\n')
    for (const handler of watcher.listeners('add')) await handler(join(root, 'docs/lions.crv'))
    expect(store.get('home').rendered.html).toContain('href="/docs/lions/"')
  })
})
