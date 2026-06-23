import { describe, expect, test } from 'vitest'
import { carveVitePlugin } from './vite-plugin.js'
import {
  emitModule,
  parseSimpleFrontmatter,
  renderCarve,
} from './transform.js'
import type { Plugin } from 'vite'

function runTransform(plugin: Plugin, source: string, id: string) {
  const hook = plugin.transform
  if (!hook) throw new Error('plugin has no transform hook')
  const fn = typeof hook === 'function' ? hook : hook.handler
  return fn.call({} as never, source, id)
}

const SAMPLE = [
  '---',
  'title: My Carve Page',
  'draft: false',
  '---',
  '',
  '# Hello Carve',
  '',
  'A paragraph with *bold* and _italic_ text.',
  '',
  '- one',
  '- two',
  '- three',
  '',
].join('\n')

describe('renderCarve', () => {
  test('renders a heading', () => {
    const { html } = renderCarve('# Hello Carve')
    expect(html).toContain('<h1')
    expect(html).toContain('Hello Carve</h1>')
  })

  test('renders bold (strong) inline', () => {
    const { html } = renderCarve('A paragraph with *bold* text.')
    expect(html).toContain('<strong>bold</strong>')
  })

  test('renders underline inline (Carve maps _x_ to <u>)', () => {
    const { html } = renderCarve('A paragraph with _underline_ text.')
    expect(html).toContain('<u>underline</u>')
  })

  test('renders an unordered list with all items', () => {
    const { html } = renderCarve('- one\n- two\n- three\n')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<li>two</li>')
    expect(html).toContain('<li>three</li>')
  })

  test('exposes raw frontmatter and parsed frontmatterData', () => {
    const { frontmatter, frontmatterData } = renderCarve(SAMPLE)
    expect(frontmatter).not.toBeNull()
    expect(frontmatter?.content).toContain('title: My Carve Page')
    expect(frontmatterData.title).toBe('My Carve Page')
    expect(frontmatterData.draft).toBe(false)
  })
})

describe('parseSimpleFrontmatter', () => {
  test('parses scalars: string, number, boolean, quoted', () => {
    const data = parseSimpleFrontmatter(
      ['title: Hello', 'count: 42', 'draft: true', 'slug: "my-slug"'].join(
        '\n',
      ),
    )
    expect(data.title).toBe('Hello')
    expect(data.count).toBe(42)
    expect(data.draft).toBe(true)
    expect(data.slug).toBe('my-slug')
  })
})

describe('emitModule', () => {
  test('emits html + default export + frontmatter exports', () => {
    const result = renderCarve(SAMPLE)
    const code = emitModule(result)
    expect(code).toContain('export const html =')
    expect(code).toContain('export const source =')
    expect(code).toContain('export const frontmatter =')
    expect(code).toContain('export const frontmatterData =')
    expect(code).toContain('export default html;')
  })
})

describe('carveVitePlugin', () => {
  test('transforms .crv modules into html-exporting modules', async () => {
    const plugin = carveVitePlugin()
    const result = await runTransform(plugin, '# Hello', '/tmp/example.crv')
    expect(result).toBeTruthy()
    if (!result || typeof result === 'string') throw new Error('no result')
    expect(result.code).toContain('Hello</h1>')
    expect(result.code).toContain('export default html;')
  })

  test('transforms .carve modules too', async () => {
    const plugin = carveVitePlugin()
    const result = await runTransform(plugin, '# Hi', '/tmp/example.carve')
    expect(result).toBeTruthy()
    if (!result || typeof result === 'string') throw new Error('no result')
    expect(result.code).toContain('Hi</h1>')
  })

  test('ignores non-Carve modules', async () => {
    const plugin = carveVitePlugin()
    const result = await runTransform(plugin, '# Hello', '/tmp/example.md')
    expect(result).toBeNull()
  })

  test('strips a query suffix before matching the id', async () => {
    const plugin = carveVitePlugin()
    const result = await runTransform(
      plugin,
      '# Q',
      '/tmp/example.crv?raw',
    )
    expect(result).toBeTruthy()
    if (!result || typeof result === 'string') throw new Error('no result')
    expect(result.code).toContain('Q</h1>')
  })
})
