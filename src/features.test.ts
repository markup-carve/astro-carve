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
    expect(warnings.join('\n')).toMatch(/region nope/)
  })
})

describe('render losses', () => {
  test('name the included file a loss comes from', () => {
    const root = site({ 'child.crv': 'A [bad](javascript:x) link.\n' })
    const { warnings } = renderCarve('[top](javascript:y)\n\n{{ child.crv }}\n', {}, join(root, 'page.crv'), root)
    expect(warnings).toEqual([
      'Blanked a denied destination scheme [destination-denied] (line 1, column 1)',
      `Blanked a denied destination scheme [destination-denied] (line 1, column 3 of ${join(root, 'child.crv')})`,
    ])
  })
})

describe('CSV table includes', () => {
  test('select records with @rows and columns with @cols', () => {
    const root = site({ 'data.csv': 'a,b\n1,2\n3,4\n5,6\n' })
    const { html, warnings } = renderCarve('{table}\n{{ data.csv @code:csv @rows:3-4 @cols:"b" }}\n', {}, join(root, 'page.crv'), root)
    expect(html).toContain('<th scope="col">b</th>')
    expect(html).toContain('<tr><td>4</td></tr>\n    <tr><td>6</td></tr>')
    expect(html).not.toMatch(/<td>2<\/td>|>a</)
    expect(warnings).toEqual([])
  })
})

describe('lint', () => {
  const source = '# A\n\n# A\n\nGo to [x](#nowhere). Fixes #12.\n'

  test('is off by default', () => {
    expect(renderCarve(source).warnings).toEqual([])
  })

  test('reports findings with rule id and position', () => {
    const { warnings } = renderCarve(source, { lint: true })
    expect(warnings.some(w => w.includes('duplicate-heading-id'))).toBe(false)
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

  test('leaves hints out unless asked for', () => {
    const source = 'Text {.x} here.\n'
    expect(renderCarve(source, { lint: true }).warnings).toEqual([])
    expect(renderCarve(source, { lint: { hints: true } }).warnings).toEqual([
      'This attribute block is attached to nothing and renders as text. Glue it to a span, link or code span, or escape the brace. [unattached-inline-attribute] (line 1, column 6)',
    ])
  })

  test('runs opt-in rules named in enabledRules', () => {
    const source = 'See [here](https://example.com).\n'
    expect(renderCarve(source, { lint: true }).warnings).toEqual([])
    const { warnings } = renderCarve(source, { lint: { enabledRules: ['non-descriptive-link-text'] } })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/\[non-descriptive-link-text\] \(line 1, column 5\)$/)
  })

  test('reaches the Vite warnings channel', async () => {
    const root = site({})
    const plugin = carveVitePlugin({ lint: true })
    const warn = vi.fn()
    await hook<(this: unknown, s: string, id: string) => unknown>(plugin, 'transform').call({ warn, addWatchFile: vi.fn() }, '[x](#nowhere)\n', join(root, 'doc.crv'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[broken-fragment-link]'))
  })
})

describe('upgradeHints', () => {
  const source = 'Text\n# Heading\n\nSome _underline_ and _more_.\n'

  test('is off by default', () => {
    expect(renderCarve(source).warnings).toEqual([])
  })

  test('reports each upgrade row once and renders the source as written', () => {
    const { html, warnings } = renderCarve(source, { upgradeHints: true })
    expect(warnings).toEqual([
      'Carve 0.1 source: blank line put above a block that 0.2 reads as a lazy line directly under text [U-001] (line 2)',
      'Carve 0.1 source: bare underline put in braces [U-065] (line 4)',
    ])
    expect(html).toBe(renderCarve(source).html)
  })

  test('reports an upgrade row that needs a person even when nothing is rewritten', () => {
    expect(renderCarve('- a\n\n  b\n', { upgradeHints: true }).warnings).toEqual(['Carve 0.1 source: a loose list with one item is tight in 0.2, its first paragraph loses the paragraph element [U-021] (line 1)'])
  })

  test('stays quiet on a document the upgrade leaves unchanged', () => {
    expect(renderCarve('# Heading\n\nPlain text.\n', { upgradeHints: true }).warnings).toEqual([])
  })

  test('reports 0.1 wiki links when wikilinks is on', () => {
    const wiki = '[[Page]]\n'
    expect(renderCarve(wiki, { upgradeHints: true }).warnings).toEqual([])
    expect(renderCarve(wiki, { upgradeHints: true, wikilinks: true }).warnings).toEqual([
      expect.stringMatching(/^Carve 0\.1 source: The 0\.1 wikilinks extension read `\[\[Page\]\]`.*\[U-423\] \(line 1\)$/),
    ])
  })

  test('reaches the Vite warnings channel', async () => {
    const root = site({})
    const plugin = carveVitePlugin({ upgradeHints: true })
    const warn = vi.fn()
    await hook<(this: unknown, s: string, id: string) => unknown>(plugin, 'transform').call({ warn, addWatchFile: vi.fn() }, 'Some _underline_ text.\n', join(root, 'doc.crv'))
    expect(warn).toHaveBeenCalledWith('Carve 0.1 source: bare underline put in braces [U-065] (line 1)')
  })
})

// U-408, C2-X-057: the 0.1 `[[Page]]` spelling is `:wiki[Page]` in 0.2; the cases below use it.
describe('wiki links', () => {
  const docs = {
    'src/content/docs/getting-started.crv': '# Getting started\n',
    'src/content/docs/guides/tigers.crv': '# Tigers\n',
    'src/content/docs/renamed.crv': '---\nslug: custom-slug\n---\n\n# Renamed\n',
    'src/content/docs/a/dup.crv': 'A\n',
    'src/content/docs/b/dup.crv': 'B\n',
  }
  const options = (root: string) => ({ wikilinks: { collections: [{ base: join(root, 'src/content/docs'), url: '/docs/{id}/' }] } })

  // C2-X-057: without the matcher, the target keeps its core-text fallback instead of 0.1's literal brackets.
  test('stay unlinked text unless enabled', () => {
    const { html } = renderCarve('See :wiki[Tigers].')
    expect(html).toContain('Tigers')
    expect(html).not.toContain('<a ')
  })

  test('use the carve-js slug when enabled without collections', () => {
    expect(renderCarve('See :wiki[Big Cats].', { wikilinks: true }).html).toContain('href="big-cats"')
  })

  test('resolve against collection ids, file names and frontmatter slugs', () => {
    const root = site(docs)
    const { html, warnings } = renderCarve(':wiki[Getting Started] :wiki[Tigers|big cats] :wiki[guides/tigers#stripes] :wiki[custom-slug] :wiki[#top]', options(root), undefined, root)
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
    const { html, warnings } = renderCarve(':wiki[Lions] :wiki[dup] :wiki[Lions] :wiki[wrong/tigers]', options(root), undefined, root)
    expect(html).toContain('href="lions"')
    expect(html).toContain('href="wrong/tigers"')
    expect(warnings).toEqual([
      'Wiki link :wiki[Lions] matches no collection entry',
      'Wiki link :wiki[dup] matches several collection entries: /docs/a/dup/, /docs/b/dup/',
      'Wiki link :wiki[wrong/tigers] matches no collection entry',
    ])
  })

  test('report an id present in two collections as ambiguous', () => {
    const root = site({ 'docs/home.crv': 'D\n', 'blog/home.crv': 'B\n' })
    const { warnings } = renderCarve(':wiki[home]', { wikilinks: { collections: [{ base: 'docs', url: '/docs/{id}/' }, { base: 'blog', url: '/blog/{id}/' }] } }, undefined, root)
    expect(warnings).toEqual(['Wiki link :wiki[home] matches several collection entries: /docs/home/, /blog/home/'])
  })

  test('try a custom resolver first', () => {
    const root = site(docs)
    const resolve = (page: string) => page === 'Tigers' ? 'https://example.org/tigers' : undefined
    const { html } = renderCarve(':wiki[Tigers] :wiki[Getting Started]', { wikilinks: { ...options(root).wikilinks, resolve } }, undefined, root)
    expect(html).toContain('href="https://example.org/tigers"')
    expect(html).toContain('href="/docs/getting-started/"')
  })

  test('resolve relative collection bases against the Vite root and see new entries after a watch event', async () => {
    const root = site(docs)
    const plugin = carveVitePlugin({ wikilinks: { collections: [{ base: 'src/content/docs', url: '/docs/{id}/' }] } })
    hook<(c: { root: string }) => void>(plugin, 'configResolved')({ root })
    const transform = async (s: string) => (await hook<(this: unknown, s: string, id: string) => Promise<{ code: string }>>(plugin, 'transform').call({ warn: vi.fn(), addWatchFile: vi.fn() }, s, join(root, 'src/pages/x.crv'))).code
    expect(await transform(':wiki[Tigers]')).toContain('/docs/guides/tigers/')
    expect(await transform(':wiki[Lions]')).toContain('href=\\"lions\\"')
    writeFileSync(join(root, 'src/content/docs/lions.crv'), '# Lions\n')
    hook<(id: string) => void>(plugin, 'watchChange')(join(root, 'src/content/docs/lions.crv'))
    expect(await transform(':wiki[Lions]')).toContain('/docs/lions/')
  })

  test('relink loader entries when a target is added', async () => {
    const root = site({ 'docs/home.crv': 'See :wiki[Lions].\n' })
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
    const store = new Map<string, any>()
    const logger = { warn: vi.fn(), error: vi.fn() }
    const context = { config: { root: pathToFileURL(root + '/') }, store: { set: (e: any) => store.set(e.id, e), keys: () => [...store.keys()], delete: (id: string) => store.delete(id) },
      watcher, parseData: async ({ data }: any) => data, generateDigest: JSON.stringify, logger } as unknown as LoaderContext
    await carveLoader({ base: './docs', wikilinks: { collections: [{ base: './docs', url: '/docs/{id}/' }] } }).load(context)
    expect(store.get('home').rendered.html).toContain('href="lions"')
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(':wiki[Lions] matches no collection entry'))
    writeFileSync(join(root, 'docs/lions.crv'), '# Lions\n')
    for (const handler of watcher.listeners('add')) await handler(join(root, 'docs/lions.crv'))
    expect(store.get('home').rendered.html).toContain('href="/docs/lions/"')
    writeFileSync(join(root, 'docs/lions.crv'), '---\nslug: big-cats\n---\n\n# Lions\n')
    for (const handler of watcher.listeners('change')) await handler(join(root, 'docs/lions.crv'))
    expect(store.get('home').rendered.html).toContain('href="lions"')
  })

  test('watch collection directories outside the loader base', async () => {
    const root = site({ 'docs/home.crv': 'See :wiki[Lions].\n', 'animals/lions.crv': '# Lions\n' })
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
    const store = new Map<string, any>()
    const context = { config: { root: pathToFileURL(root + '/') }, store: { set: (e: any) => store.set(e.id, e), keys: () => [...store.keys()], delete: (id: string) => store.delete(id) },
      watcher, parseData: async ({ data }: any) => data, generateDigest: JSON.stringify, logger: { warn: vi.fn(), error: vi.fn() } } as unknown as LoaderContext
    await carveLoader({ base: './docs', wikilinks: { collections: [{ base: './animals', url: '/animals/{id}/' }] } }).load(context)
    expect(store.get('home').rendered.html).toContain('href="/animals/lions/"')
    expect(watcher.add).toHaveBeenCalledWith([join(root, 'docs'), join(root, 'animals')])
    rmSync(join(root, 'animals/lions.crv'))
    for (const handler of watcher.listeners('unlink')) await handler(join(root, 'animals/lions.crv'))
    expect(store.get('home').rendered.html).toContain('href="lions"')
  })
})
