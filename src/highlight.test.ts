import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { LoaderContext } from 'astro/loaders'
import { carveLoader } from './loader.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { describe, expect, test, vi } from 'vitest'
import { codeCollector, createCarveHighlighter } from './highlight.js'
import { renderCarve } from './transform.js'
import { carveVitePlugin } from './vite-plugin.js'

async function render(source: string, options = {}) {
  const collector = codeCollector(await createCarveHighlighter(options))
  const result = renderCarve(source, {}, undefined, undefined, undefined, [collector.extension])
  return collector.apply(result.html)
}

describe('Shiki highlighting', () => {
  test('highlights a fence in a bundled language with the default theme', async () => {
    const html = await render('``` ts\nconst a: number = 1\n```\n')
    expect(html).toMatch(/<pre class="shiki github-dark" style="[^"]*" tabindex="0" data-language="ts"><code>/)
    expect(html).toContain('<span style="color:#F97583">const</span>')
  })

  test('highlights a Carve fence with the carve-grammars grammar and styling marks', async () => {
    const html = await render('``` carve\n*bold* and {~gone~}\n```\n')
    expect(html).toContain('data-language="carve"')
    expect(html).toContain('data-carve-strike')
  })

  test('keeps the plain engine output for a fence without a language or with an unknown one', async () => {
    const html = await render('```\nplain\n```\n\n``` nosuchlang\nx < y\n```\n')
    expect(html).toContain('<pre><code>plain\n</code></pre>')
    expect(html).toContain('<pre><code class="language-nosuchlang">x &lt; y\n</code></pre>')
    expect(html).not.toContain('shiki')
  })

  test('carries fence attributes and the title onto the highlighted pre', async () => {
    const html = await render('{#ex .wide data-x="1"}\n``` js "src/a.js"\nlet a\n```\n')
    expect(html).toContain('id="ex"')
    expect(html).toMatch(/class="shiki github-dark wide"/)
    expect(html).toContain('data-x="1"')
    expect(html).toContain('title="src/a.js"')
  })

  test('honors dual themes, aliases and wrap from shikiConfig', async () => {
    const html = await render('``` mylang\nlet a\n```\n', {
      themes: { light: 'github-light', dark: 'github-dark' },
      langAlias: { mylang: 'js' },
      wrap: true,
    })
    expect(html).toContain('shiki-themes github-light github-dark')
    expect(html).toContain('--shiki-dark:')
    expect(html).toContain('white-space:pre-wrap')
    expect(html).toContain('data-language="mylang"')
  })

  test('is off by default in the Vite plugin and on when asked', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-carve-shiki-'))
    try {
      const run = async (plugin: Plugin) => {
        const h = plugin.transform as unknown as (this: unknown, s: string, id: string) => Promise<{ code: string }>
        return (await h.call({ warn: vi.fn(), addWatchFile: vi.fn() }, '``` ts\nlet a\n```\n', join(root, 'a.crv'))).code
      }
      expect(await run(carveVitePlugin())).not.toContain('shiki')
      expect(await run(carveVitePlugin({ highlight: true }))).toContain('class=\\"shiki github-dark\\"')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('uses the project shikiConfig in the content loader', async () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-carve-shiki-loader-'))
    try {
      writeFileSync(join(root, 'page.crv'), '``` ts\nlet a\n```\n')
      const store = new Map<string, any>()
      const context = { config: { root: pathToFileURL(root + '/'), markdown: { shikiConfig: { theme: 'nord', themes: {}, langs: [], wrap: false, transformers: [] } } },
        store: { set: (e: any) => store.set(e.id, e), keys: () => [...store.keys()], delete: () => {} },
        parseData: async ({ data }: any) => data, generateDigest: JSON.stringify, logger: { warn: vi.fn() } } as unknown as LoaderContext
      await carveLoader({ base: root, highlight: true }).load(context)
      expect(store.get('page').rendered.html).toContain('class="shiki nord"')
      expect(store.get('page').rendered.html).toContain('overflow-x:auto')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
