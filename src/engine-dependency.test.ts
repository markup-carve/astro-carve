import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * A `github:` or `git+` specifier installs fine here and breaks a consumer:
 * npm hands them a spec that needs git and a build step, and nothing in the
 * suite notices. It has been reintroduced twice, most recently by #15, and the
 * only check that saw it runs on a schedule - a day after the pull request
 * that did it.
 */
const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

describe('the declared engine', () => {
  it('is a registry version, not a git specifier', () => {
    const spec =
      manifest.dependencies?.['@markup-carve/carve'] ??
      manifest.devDependencies?.['@markup-carve/carve']

    expect(spec).toBeDefined()
    expect(spec).toMatch(/^[\^~]?\d+\.\d+\.\d+/)
  })
})
