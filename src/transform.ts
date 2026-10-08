import {
  carveToHtmlWithReport,
  expandIncludes,
  parse,
  renderDocumentWithReport,
  renderPlainText,
  resolve,
  type ParseOptions,
  type RenderOptions,
} from '@markup-carve/carve'
import { fileSystemResolver } from '@markup-carve/carve/node'
import { load as loadYaml } from 'js-yaml'
import { localImages, imageImportPath } from './assets.js'
import { dirname, resolve as resolvePath } from 'node:path'

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
  /** Which module ids count as Carve. Default: `*.crv`. */
  include?: RegExp
  /**
   * Options forwarded to carve-js (`carveToHtml`). Includes `extensions`
   * for Tier-2 syntax, heading-id options, profile, etc.
   */
  render?: ParseOptions & RenderOptions
  /**
   * Parse YAML frontmatter into an object that the
   * emitted module exports as `frontmatterData`. Default `true`.
   * The raw frontmatter (`{ format, content }`) is always exported too,
   * including frontmatter in formats other than YAML.
   */
  parseFrontmatter?: boolean
  /** Resolve includes for file-backed modules. Default `true`. */
  includes?: boolean
  /** Include containment root. Defaults to Astro's Vite project root. */
  includeRoot?: string
}

export interface CarveTransformResult {
  html: string
  source: string
  frontmatter: CarveFrontmatter | null
  frontmatterData: Record<string, unknown>
  dependencies: string[]
  warnings: string[]
  headings: { depth: number; slug: string; text: string }[]
}

export const DEFAULT_INCLUDE = /\.crv$/

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

/** Parse YAML metadata while keeping non-YAML import behavior compatible. */
export function parseFrontmatterData(frontmatter: CarveFrontmatter): Record<string, unknown> {
  if (frontmatter.format !== 'yaml') return parseSimpleFrontmatter(frontmatter.content)
  const parsed: unknown = loadYaml(frontmatter.content)
  if (parsed === undefined || parsed === null) return {}
  if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed instanceof Date) throw new TypeError('Carve frontmatter must be a mapping')
  return parsed as Record<string, unknown>
}

function metadataModule(data: Record<string, unknown>): string[] {
  // JSON.parse keeps keys such as __proto__ as data. Restore YAML dates after
  // serialization so layouts receive the same values as collection schemas.
  const serialized = JSON.stringify(data)
  const lines = [`export const frontmatterData = JSON.parse(${JSON.stringify(serialized)});`]
  const visit = (value: unknown, path: string): void => {
    if (value instanceof Date) lines.push(`${path} = new Date(${JSON.stringify(value.toISOString())});`)
    else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) visit(child, `${path}[${JSON.stringify(key)}]`)
    }
  }
  visit(data, 'frontmatterData')
  return lines
}

/**
 * Render Carve source to the data an Astro/Vite module needs. Pure and
 * synchronous so it can be unit tested directly without a Vite pipeline.
 */
export function renderCarve(
  source: string,
  options: CarveTransformOptions = {},
  sourcePath?: string,
  defaultIncludeRoot?: string,
): CarveTransformResult {
  const renderOpts = options.render ?? {}
  const doc = parse(source, renderOpts)
  const expanded = sourcePath && (options.includes ?? true)
    ? expandIncludes(doc, source, {
        // A configured root reaches the resolver unchanged, so its absolute-path
        // refusal (PART 9 section 19, I10) still fires. Resolving it here would
        // root containment at the process working directory instead.
        resolve: fileSystemResolver(options.includeRoot ?? defaultIncludeRoot ?? resolvePath(dirname(sourcePath))),
        sourcePath: resolvePath(sourcePath),
        extensions: renderOpts.extensions,
      })
    : null
  const resolved = resolve(expanded?.doc ?? doc, { asciiHeadingIds: renderOpts.asciiHeadingIds, lowercaseHeadingIds: renderOpts.lowercaseHeadingIds })
  const headings: CarveTransformResult['headings'] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (value === null || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    if (node.type === 'heading') {
      const heading = node as unknown as import('@markup-carve/carve').Heading
      headings.push({ depth: heading.level, slug: heading.attrs?.id ?? '', text: renderPlainText({ type:'document', children:[heading] }).trim() })
    }
    for (const key of ['children','items','target','fallback']) visit(node[key])
  }
  visit(resolved.children)
  // A render loss is the engine saying it dropped something the author wrote: a
  // blanked `javascript:` destination, a flattened ruby annotation, a raw block
  // for another format. It joins `warnings`, which the loader and the Vite
  // plugin already surface, so neither needs a change.
  const rendered = expanded
    ? renderDocumentWithReport(resolved, renderOpts)
    : carveToHtmlWithReport(source, renderOpts)
  const html = rendered.value
  const lossWarnings = rendered.losses.map((loss) => {
    const at = loss.pos ? ` (line ${loss.pos.startLine}, column ${loss.pos.startColumn})` : ''
    return `${loss.message} [${loss.code}]${at}`
  })
  if (rendered.truncated) {
    lossWarnings.push(`${rendered.totalLosses} render losses in total; the rest were not reported`)
  }
  const frontmatter: CarveFrontmatter | null = doc.frontmatter
    ? { format: doc.frontmatter.format, content: doc.frontmatter.content }
    : null
  const parseFm = options.parseFrontmatter ?? true
  const frontmatterData =
    parseFm && frontmatter ? parseFrontmatterData(frontmatter) : {}
  return {
    html,
    source,
    frontmatter,
    frontmatterData,
    headings,
    dependencies: expanded?.dependencies.filter((dependency) => dependency.resolved || dependency.denial === 'not-found').map((dependency) => dependency.id) ?? [],
    warnings: [...(expanded?.warnings.map((warning) => warning.message) ?? []), ...lossWarnings],
  }
}

/**
 * Build the JavaScript module source that a Carve file compiles to. The
 * module exports the rendered `html`, the raw `source`, the raw
 * `frontmatter`, and the parsed `frontmatterData`, with `html` as the
 * default export so `import html from './doc.crv'` works.
 */
export function emitModule(result: CarveTransformResult, bundleAssets = false, defaultExport = true): string {
  const images = bundleAssets ? localImages(result.html) : []
  const imports = images.map((image, i) => `import $$asset${i} from ${JSON.stringify((image.src.startsWith('.') ? imageImportPath(image.src) : './' + imageImportPath(image.src)) + (image.src.includes('?') ? '&url' : '?url'))};`)
  const parts: string[] = []
  let cursor = 0
  images.forEach((image, i) => {
    parts.push(JSON.stringify(result.html.slice(cursor, image.start)))
    parts.push(`${JSON.stringify('src="')} + $$asset${i}.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + ${JSON.stringify('"')}`)
    cursor = image.end
  })
  parts.push(JSON.stringify(result.html.slice(cursor)))
  const expression = parts.join(' + ')
  return [
    ...imports,
    `export const source = ${JSON.stringify(result.source)};`,
    `export const html = ${expression};`,
    `export const frontmatter = ${JSON.stringify(result.frontmatter)};`,
    ...metadataModule(result.frontmatterData),
    ...(defaultExport ? ['export default html;'] : []),
    '',
  ].join('\n')
}

/** Emit an Astro component while retaining the named document exports. */
export function emitPageModule(result: CarveTransformResult): string {
  const layout = result.frontmatterData.layout
  if (layout !== undefined && typeof layout !== 'string') throw new TypeError('Carve page layout must be a string')
  return [
    'import { createComponent, render, renderComponent, unescapeHTML } from "astro/runtime/server/index.js";',
    ...(typeof layout === 'string' ? [`import Layout from ${JSON.stringify(layout)};`] : []),
    emitModule(result, true, false),
    'const Content = createComponent(($$result, $$props, $$slots) => {',
    typeof layout === 'string'
      ? 'return render`${renderComponent($$result, "Layout", Layout, { ...frontmatterData, frontmatter: frontmatterData }, { default: () => render`${unescapeHTML(html)}` })}`;'
      : 'return render`${unescapeHTML(html)}`;',
    '});',
    'export default Content;',
    '',
  ].join('\n')
}
