import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A `github:` or `git+` specifier installs fine here and breaks a consumer:
 * npm hands them a spec that needs git and a build step. main may pin a merged
 * carve-js commit between engine releases, so the guard runs at publish time
 * (release.yml); these tests run the real script on every pull request.
 */
const guard = fileURLToPath(new URL('../scripts/no-git-dependencies.mjs', import.meta.url))
const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url))
const releaseWorkflow = fileURLToPath(new URL('../.github/workflows/release.yml', import.meta.url))

type Manifest = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const committed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
const scratch = mkdtempSync(join(tmpdir(), 'astro-carve-guard-'))

function runGuard(manifest: Manifest): { status: number | null; out: string } {
  const path = join(scratch, 'package.json')
  writeFileSync(path, JSON.stringify(manifest, null, 2), 'utf8')
  const run = spawnSync(process.execPath, [guard, path], { encoding: 'utf8' })
  expect(run.error).toBeUndefined()
  return { status: run.status, out: `${run.stdout}${run.stderr}` }
}

const withEngine = (spec: string): Manifest => ({
  ...committed,
  dependencies: { ...committed.dependencies, '@markup-carve/carve': spec },
})

const isGitSpec = (spec: string): boolean =>
  /^(github|gitlab|bitbucket|git|git\+[a-z.+-]+|ssh):/i.test(spec) || /^[^@:\s]+\/[^@:\s]+(#.*)?$/.test(spec)

describe('the publish-time git-dependency guard', () => {
  it.each([
    ['a github: pin', withEngine('github:markup-carve/carve-js#99ad0d2a4e5ec192440c3e5a1b4b95f50ed3cfcf')],
    ['a git+https:// pin', withEngine('git+https://github.com/markup-carve/carve-js.git#99ad0d2')],
    ['the owner/repo shorthand', withEngine('markup-carve/carve-js#99ad0d2')],
    ['an npm: alias of a git spec', withEngine('npm:github:markup-carve/carve-js')],
    [
      'a git spec in optionalDependencies',
      { ...withEngine('^0.1.16'), optionalDependencies: { x: 'github:owner/repo' } },
    ],
  ])('refuses %s', (_name, manifest) => {
    const { status, out } = runGuard(manifest)
    expect(status).not.toBe(0)
    expect(out).toMatch(/would not resolve from the registry/)
  })

  it.each([
    ['a caret range', withEngine('^0.1.16')],
    ['an exact version', withEngine('0.1.16')],
    ['an npm: registry alias', withEngine('npm:@markup-carve/carve@^0.1.16')],
  ])('accepts %s', (_name, manifest) => {
    const { status, out } = runGuard(manifest)
    expect(out).toMatch(/resolve from the registry/)
    expect(status).toBe(0)
  })

  it('gives the committed manifest the verdict a publish would', () => {
    const spec =
      committed.dependencies?.['@markup-carve/carve'] ?? committed.devDependencies?.['@markup-carve/carve']
    expect(spec).toBeDefined()
    const { status } = runGuard(committed)
    if (isGitSpec(spec as string)) {
      expect(status).not.toBe(0)
    } else {
      expect(spec).toMatch(/^[\^~]?\d+\.\d+\.\d+/)
      expect(status).toBe(0)
    }
  })

  it('is run by the release workflow before the tag and the publish', () => {
    const workflow = readFileSync(releaseWorkflow, 'utf8')
    expect(workflow).toMatch(/run: node scripts\/no-git-dependencies\.mjs\s*$/m)
    const needs = [...workflow.matchAll(/^\s{4}needs: \[([^\]]*)\]/gm)].map((m) => m[1])
    expect(needs.filter((n) => n.includes('no-git-dependencies'))).toHaveLength(2)
  })
})
