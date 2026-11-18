import { tabsExtensions, tabsRenderer } from '@markup-carve/carve/v2'
import { describe, expect, test } from 'vitest'
import { renderCarve } from './transform.js'

describe('Carve 0.2 public API boundary', () => {
  test('uses the resolved tree for heading metadata and HTML', () => {
    const result = renderCarve('# Café\n\nText.\n', { render: { headingIds: 'ascii-lower' } })
    expect(result.headings).toEqual([{ depth: 1, slug: 'cafe', text: 'Café' }])
    expect(result.html).toContain('id="cafe"')
  })

  test('keeps raw HTML off and uses the engine URL policy', () => {
    const source = '`<script>alert(1)</script>`{=html}\n\n[x](javascript:alert(1))\n'
    const safe = renderCarve(source)
    expect(safe.html).not.toContain('<script>')
    expect(safe.html).toContain('href=""')
    expect(safe.warnings.some(warning => warning.includes('[destination-denied]'))).toBe(true)
    expect(renderCarve(source, { render: { rawHtml: true } }).html).toContain('<script>')
  })

  test('forwards named 0.2 extensions and renderers', () => {
    const source = ':::: tabs\n::: tab "Install"\nRun.\n:::\n::::\n'
    const result = renderCarve(source, { render: {
      extensions: tabsExtensions,
      renderers: { 'carve.tabs': tabsRenderer },
    } })
    expect(result.html).toContain('class="tabs"')
    expect(result.html).toContain('Install')
  })
})
