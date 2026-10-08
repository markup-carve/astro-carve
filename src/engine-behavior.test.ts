import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderCarve } from './transform.js'

/**
 * Engine behavior this transform's own path reaches, and that no plugin diff
 * would announce. All three changed between the engine the lockfile held
 * (0.1.7) and the one a consumer resolves from `^0.1.7` (0.1.10).
 */
describe('engine behavior the transform reaches', () => {
  it('leaves a case-only cross-reference literal instead of resolving it', () => {
    // Engine 0.1.7 resolved `</#alpha-beta>` against a heading whose id is
    // `Alpha-Beta`; 0.1.10 compares case exactly, so the reference degrades to
    // text and a built page gains visible markup where a link was.
    const { html } = renderCarve('# Alpha Beta\n\n</#alpha-beta>\n', {})

    expect(html).toContain('&lt;/#alpha-beta&gt;')
    expect(html).not.toContain('href="#Alpha-Beta"')
  })

  it('still resolves an exact cross-reference and clones the target text', () => {
    expect(renderCarve('# Alpha Beta\n\n</#Alpha-Beta>\n', {}).html)
      .toContain('href="#Alpha-Beta">Alpha Beta')
  })

  it('renames every colliding id an include brings in, not only a heading id', () => {
    // Engine 0.1.7 emitted three elements carrying id="dup" from one included
    // file, which is invalid HTML and makes the anchors collide.
    const root = mkdtempSync(join(tmpdir(), 'astro-carve-behavior-'))
    try {
      mkdirSync(join(root, 'pages'))
      writeFileSync(join(root, 'child.crv'), '{#sec}\n# Shared\n\n{#dup}\nA note.\n')
      const { html, warnings } = renderCarve(
        '{#dup}\nBefore.\n\n{{ ../child.crv }}\n\n{{ ../child.crv }}\n',
        { includeRoot: root },
        join(root, 'pages', 'index.crv'),
      )

      const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1])
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids).toContain('dup-2')
      expect(warnings.filter((warning) => /Id "dup" was renamed/.test(warning))).toHaveLength(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports a blanked destination scheme in the warnings the hosts surface', () => {
    // The engine blanks `javascript:` either way; without the report the author
    // only sees a link that stopped working, with no position. Both the content
    // loader and the Vite plugin already forward `warnings`.
    const { html, warnings } = renderCarve('[x](javascript:alert(1))\n', {})

    expect(html).toContain('href=""')
    expect(warnings).toContain(
      'Blanked a denied destination scheme [destination-denied] (line 1, column 1)',
    )
  })
})
