import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Reading this repository's own `package.json` off disk would answer "what does
 * the file say", which is NOT the question an `exports` map decides. The map is
 * enforced by the resolver, against an INSTALLED package, and a `readFileSync`
 * assertion on it passes just as happily with the entry deleted.
 *
 * So these cases take a consumer's position: a scratch directory gets the
 * `node_modules` layout an install produces, this package is linked into it,
 * and a real `node` reads the specifier back the way a version-pinning CI step
 * would. What is under test is Node's resolution, not this file's opinion of it.
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
}

describe('resolving a subpath from a consumer position', () => {
  let consumer: string

  beforeAll(() => {
    consumer = mkdtempSync(join(tmpdir(), 'astro-carve-consumer-'))
    mkdirSync(join(consumer, 'node_modules', '@markup-carve'), { recursive: true })
    symlinkSync(root, join(consumer, 'node_modules', '@markup-carve', 'astro-carve'), 'dir')
  })

  afterAll(() => rmSync(consumer, { recursive: true, force: true }))

  const run = (script: string): string =>
    execFileSync('node', ['-e', script], {
      cwd: consumer,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()

  const codeOf = (specifier: string): string =>
    run(
      `import(${JSON.stringify(specifier)}).then(() => console.log('RESOLVED'),` +
        ` (e) => console.log(e.code ?? String(e)))`,
    )

  it('reads the installed version back through the package specifier', () => {
    // The question a version-pinning CI step asks. Closed, it throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED, which reads as "this package is not
    // installed" rather than "this subpath is closed" - so whoever hits it goes
    // and audits their install before they suspect a manifest.
    expect(run(`console.log(require('@markup-carve/astro-carve/package.json').version)`)).toBe(
      pkg.version,
    )
  })

  it('reads it back under import as well as require', () => {
    // Both resolvers consult the same map, but only one of them is what a given
    // CI one-liner happens to use.
    expect(
      run(
        `import('@markup-carve/astro-carve/package.json', { with: { type: 'json' } })` +
          `.then((m) => console.log(m.default.version))`,
      ),
    ).toBe(pkg.version)
  })

  it('opens that one file and not the directory holding it', () => {
    // The tempting way to fix the cases above is a `./*` wildcard, or dropping
    // the map. Either publishes the whole checkout as importable API - `src/`
    // included - and nothing else here would notice.
    expect(codeOf('@markup-carve/astro-carve/tsconfig.json')).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED')
    expect(codeOf('@markup-carve/astro-carve/src/index.ts')).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED')
    expect(codeOf('@markup-carve/astro-carve/dist/index.js')).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED')
  })

  it('still resolves the entry point the map already named', () => {
    // Requires `dist/`, which `prepare` builds on install.
    expect(codeOf('@markup-carve/astro-carve')).toBe('RESOLVED')
  })
})
