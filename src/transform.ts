import {
  includeDependencies,
  lint,
  parseWithDiagnostics,
  renderWithDiagnostics,
  type Diagnostic,
  type DocumentNode,
  type ExtensionDefinition,
  type RenderOptions,
} from '@markup-carve/carve/v2'
import { fileSystemResolver } from '@markup-carve/carve/v2/node'
import { readFileSync } from 'node:fs'
import { isAbsolute, dirname, relative, resolve as resolvePath } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { localImages, imageImportPath } from './assets.js'
import { WikiIndex, type CarveWikilinksOptions } from './wikilinks.js'
import type { CarveHighlightOptions } from './highlight.js'

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
   * Options forwarded to the Carve 0.2 renderer, including `extensions`,
   * `renderers`, `headingIds`, `rawHtml`, and `urlPolicy`.
   */
  render?: Omit<RenderOptions, 'includes'>
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
  /**
   * Run the carve-js linter and report its findings as warnings. Default
   * `false`. `platforms` adds host-specific rules such as `github`.
   */
  lint?: boolean | CarveLintOptions
  /** Reserved for wiki links. The 0.2 engine lacks the syntax hook; enabling this currently throws. */
  wikilinks?: boolean | CarveWikilinksOptions
  /**
   * Reserved for Shiki highlighting. The 0.2 engine lacks an ordinary code block hook;
   * enabling this currently throws. Default `false`.
   */
  highlight?: boolean | CarveHighlightOptions
}

export interface CarveLintOptions {
  /** Host-specific rules, such as `github`. */
  platforms?: ('github')[]
  /** Also report advisory `Hint` findings, such as a thematic break not written `***`. */
  hints?: boolean
  /** Opt-in rules to run in addition to the defaults. */
  enabledRules?: readonly string[]
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
/** Render a v2 diagnostic with its UTF-8 byte range as an author-facing location. */
function diagnosticMessage(diagnostic: Diagnostic, source: string, sourcePath?: string, includeRoot?: string): string {
  if (!diagnostic.range) return `${diagnostic.message} [${diagnostic.code}]`
  const diagnosticPath = diagnostic.file && includeRoot ? resolvePath(includeRoot, diagnostic.file) : undefined
  const text = diagnosticPath ? readFileSync(diagnosticPath, 'utf8') : source
  const before = Buffer.from(text).subarray(0, diagnostic.range.startOffset).toString('utf8')
  const lines = before.split('\n')
  const line = lines.length
  const column = [...(lines.at(-1) ?? '')].length + 1
  const file = diagnosticPath && diagnosticPath !== sourcePath ? ` of ${diagnosticPath}` : ''
  return `${diagnostic.message} [${diagnostic.code}] (line ${line}, column ${column}${file})`
}

/** Text used by Astro's heading metadata. The engine supplies the resolved id. */
function headingText(nodes: readonly unknown[], symbols: Readonly<Record<string, string>>): string {
  let out = ''
  for (const value of nodes) {
    if (!value || typeof value !== 'object') continue
    const node = value as Record<string, unknown>
    if (node.type === 'text' || node.type === 'code' || node.type === 'math' || node.type === 'literal_inline') out += String(node.value ?? '')
    else if (node.type === 'soft_break' || node.type === 'hard_break') out += ' '
    else if (node.type === 'smart_punctuation') out += String(node.glyph ?? node.source ?? '')
    else if (node.type === 'image') out += String(node.alt ?? '')
    else if (node.type === 'autolink') out += String(node.text ?? node.href ?? '')
    else if (node.type === 'mention') out += `@${String(node.target ?? '')}`
    else if (node.type === 'tag') out += `#${String(node.name ?? '')}`
    else if (node.type === 'symbol') out += symbols[String(node.name)] ?? `:${String(node.name)}:`
    else if (node.type === 'abbreviation') out += String(node.key ?? '')
    else if (node.type === 'non_breaking_space') out += '\u00a0'
    else if (Array.isArray(node.children) && node.type !== 'inline_footnote') out += headingText(node.children, symbols)
  }
  return out
}

function headingsOf(document: DocumentNode, symbols: Readonly<Record<string, string>>): CarveTransformResult['headings'] {
  const headings: CarveTransformResult['headings'] = []
  const visit = (nodes: readonly unknown[]): void => {
    for (const value of nodes) {
      if (!value || typeof value !== 'object') continue
      const node = value as Record<string, unknown>
      if (node.type === 'heading') headings.push({
        depth: Number(node.level),
        slug: String((node.attrs as { id?: string } | undefined)?.id ?? node.generatedId ?? ''),
        text: headingText(Array.isArray(node.children) ? node.children : [], symbols),
      })
      if (Array.isArray(node.children)) visit(node.children)
    }
  }
  visit(document.children)
  return headings
}

/** Convert one Carve 0.2 tree into the values shared by Astro pages, imports and collections. */
export function renderCarve(
  source: string,
  options: CarveTransformOptions = {},
  sourcePath?: string,
  defaultIncludeRoot?: string,
  _wikiIndex?: WikiIndex,
  extraExtensions: ExtensionDefinition[] = [],
): CarveTransformResult {
  if (options.wikilinks) throw new Error('Carve 0.2 wiki links are not available yet: the engine cannot register [[Page]] syntax')
  if (options.highlight) throw new Error('Carve 0.2 syntax highlighting is not available yet: the engine has no general code block renderer hook')
  const renderOpts = options.render ?? {}
  const extensions = [...(renderOpts.extensions ?? []), ...extraExtensions]
  const documentPath = sourcePath ? resolvePath(sourcePath) : undefined
  const includeRoot = options.includeRoot ?? defaultIncludeRoot ?? (documentPath ? dirname(documentPath) : undefined)
  if (includeRoot !== undefined && !isAbsolute(includeRoot)) throw new Error('Carve includeRoot must be an absolute path')
  const includes = documentPath && (options.includes ?? true) && includeRoot
    ? { resolver: fileSystemResolver(includeRoot), file: relative(includeRoot, documentPath).split('\\').join('/') }
    : undefined
  const parsed = parseWithDiagnostics(source, { extensions, headingIds: renderOpts.headingIds, includes })
  const rendered = renderWithDiagnostics(parsed.document, { ...renderOpts, extensions })
  const lintOptions = options.lint === true ? {} : options.lint || undefined
  const lintDiagnostics = lintOptions
    ? lint(source, { extensions, includes, platforms: lintOptions.platforms,
        rules: Object.fromEntries((lintOptions.enabledRules ?? []).map(rule => [rule, 'on' as const])) })
        .filter(diagnostic => lintOptions.hints || diagnostic.severity !== 'hint')
    : []
  const frontmatterNode = parsed.document.children.find(node => node.type === 'frontmatter')
  const frontmatter: CarveFrontmatter | null = frontmatterNode?.type === 'frontmatter'
    ? { format: frontmatterNode.format, content: frontmatterNode.value }
    : null
  const parseFm = options.parseFrontmatter ?? true
  const frontmatterData = parseFm && frontmatter ? parseFrontmatterData(frontmatter) : {}
  const diagnostics = [...parsed.diagnostics, ...rendered.diagnostics.filter(diagnostic => diagnostic.channel === 'render-loss'), ...lintDiagnostics]
  const warningMessages = diagnostics.map(diagnostic => diagnosticMessage(diagnostic, source, documentPath, includeRoot))
  const dependencies = includeDependencies(parsed.document).flatMap(dependency => {
    if (!includes || !includeRoot) return []
    const candidate = dependency.file
      ? resolvePath(includeRoot, dependency.file)
      : resolvePath(includeRoot, dirname(dependency.from ?? relative(includeRoot, documentPath!)), dependency.path)
    const inside = relative(includeRoot, candidate)
    return inside === '..' || inside.startsWith('../') || isAbsolute(inside) ? [] : [candidate]
  })
  return {
    html: rendered.html,
    source,
    frontmatter,
    frontmatterData,
    headings: headingsOf(parsed.document, renderOpts.symbols ?? {}),
    dependencies,
    warnings: warningMessages,
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
