import {
  carveToHtml,
  parse,
  type ParseOptions,
  type RenderOptions,
} from '@markup-carve/carve'

/**
 * Carve frontmatter as Carve exposes it: the verbatim text between the
 * frontmatter fences plus the declared format token (default `yaml`).
 * Carve itself does not interpret it - the application decides.
 */
export interface CarveFrontmatter {
  format: string
  content: string
}

export interface CarveTransformOptions {
  /** Which module ids count as Carve. Default: `*.crv` and `*.carve`. */
  include?: RegExp
  /**
   * Options forwarded to carve-js (`carveToHtml`). Includes `extensions`
   * for Tier-2 syntax, heading-id options, profile, etc.
   */
  render?: ParseOptions & RenderOptions
  /**
   * Parse simple `key: value` frontmatter into a plain object that the
   * emitted module exports as `frontmatterData`. Default `true`.
   * The raw frontmatter (`{ format, content }`) is always exported too,
   * so a consumer can run a full YAML parser if it needs one.
   */
  parseFrontmatter?: boolean
}

export interface CarveTransformResult {
  html: string
  source: string
  frontmatter: CarveFrontmatter | null
  frontmatterData: Record<string, unknown>
}

export const DEFAULT_INCLUDE = /\.(?:crv|carve)$/

/**
 * Minimal, dependency-free `key: value` frontmatter reader. It handles the
 * flat scalar case (strings, numbers, booleans) that page metadata such as
 * `title`, `layout`, and `draft` typically use. Anything more structured is
 * left to the consumer via the raw `frontmatter` export. This deliberately
 * avoids pulling a YAML dependency into the integration.
 */
export function parseSimpleFrontmatter(content: string): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    if (!key) continue
    let value: string = line.slice(idx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      data[key] = value.slice(1, -1)
      continue
    }
    if (value === 'true' || value === 'false') {
      data[key] = value === 'true'
      continue
    }
    if (value !== '' && !Number.isNaN(Number(value))) {
      data[key] = Number(value)
      continue
    }
    data[key] = value
  }
  return data
}

/**
 * Render Carve source to the data an Astro/Vite module needs. Pure and
 * synchronous so it can be unit tested directly without a Vite pipeline.
 */
export function renderCarve(
  source: string,
  options: CarveTransformOptions = {},
): CarveTransformResult {
  const renderOpts = options.render ?? {}
  const html = carveToHtml(source, renderOpts)
  const doc = parse(source, renderOpts)
  const frontmatter: CarveFrontmatter | null = doc.frontmatter
    ? { format: doc.frontmatter.format, content: doc.frontmatter.content }
    : null
  const parseFm = options.parseFrontmatter ?? true
  const frontmatterData =
    parseFm && frontmatter ? parseSimpleFrontmatter(frontmatter.content) : {}
  return { html, source, frontmatter, frontmatterData }
}

/**
 * Build the JavaScript module source that a Carve file compiles to. The
 * module exports the rendered `html`, the raw `source`, the raw
 * `frontmatter`, and the parsed `frontmatterData`, with `html` as the
 * default export so `import html from './doc.crv'` works.
 */
export function emitModule(result: CarveTransformResult): string {
  return [
    `export const source = ${JSON.stringify(result.source)};`,
    `export const html = ${JSON.stringify(result.html)};`,
    `export const frontmatter = ${JSON.stringify(result.frontmatter)};`,
    `export const frontmatterData = ${JSON.stringify(result.frontmatterData)};`,
    `export default html;`,
    '',
  ].join('\n')
}
