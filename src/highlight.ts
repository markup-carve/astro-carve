import type { CodeBlockNode } from '@markup-carve/carve'
import type {
  BundledLanguage,
  BundledTheme,
  Highlighter,
  LanguageRegistration,
  ShikiTransformer,
  ThemeRegistration,
} from 'shiki'

/** The fields of Astro's `markdown.shikiConfig` that apply to Carve fences. */
export interface CarveHighlightOptions {
  theme?: BundledTheme | ThemeRegistration
  themes?: Record<string, BundledTheme | ThemeRegistration>
  defaultColor?: string | false
  langs?: (BundledLanguage | LanguageRegistration)[]
  langAlias?: Record<string, string>
  transformers?: ShikiTransformer[]
  wrap?: boolean | null
}

type Attrs = { id?: string; classes?: string[]; keyValues?: [string, string][] }

interface PendingBlock {
  lang: string
  code: string
  attrs?: Attrs
  header?: string
}

/** A loaded Shiki instance plus the Carve grammar and theme extras from carve-grammars. */
export interface CarveHighlighter {
  /** True when a fence word names a grammar this highlighter can load. */
  accepts(lang: string): boolean
  highlight(block: PendingBlock): Promise<string>
}

// Astro's default when `shikiConfig.theme` is unset.
const DEFAULT_THEME = 'github-dark'

interface GrammarsShiki {
  carveGrammar: LanguageRegistration
  carveCsvGrammar: LanguageRegistration
  carveTsvGrammar: LanguageRegistration
  carveStylingTransformer: ShikiTransformer
  carveLightExtras: unknown[]
  carveDarkExtras: unknown[]
  extendTheme(theme: ThemeRegistration, extras: unknown[]): ThemeRegistration
}

/** Build the highlighter once per plugin or loader; Shiki loads grammars on demand. */
export async function createCarveHighlighter(options: CarveHighlightOptions = {}): Promise<CarveHighlighter> {
  const shiki = await import('shiki')
  // Untyped entry in carve-grammars; the cast keeps the contract in one place.
  const grammars = await import('@markup-carve/carve-grammars/shiki' as string) as GrammarsShiki
  const resolveTheme = async (theme: BundledTheme | ThemeRegistration): Promise<ThemeRegistration> => {
    const base = typeof theme === 'string' ? (await shiki.bundledThemes[theme]()).default as ThemeRegistration : theme
    return grammars.extendTheme(base, base.type === 'light' ? grammars.carveLightExtras : grammars.carveDarkExtras)
  }
  // Astro fills `themes` with `{}` when only `theme` is set.
  const themes = options.themes && Object.keys(options.themes).length > 0
    ? Object.fromEntries(await Promise.all(Object.entries(options.themes).map(async ([key, t]) => [key, await resolveTheme(t)] as const)))
    : undefined
  const theme = themes ? undefined : await resolveTheme(options.theme ?? DEFAULT_THEME)
  const highlighter: Highlighter = await shiki.createHighlighter({
    themes: themes ? Object.values(themes) : [theme!],
    // The Carve grammar highlights CSV and TSV fence bodies with these.
    langs: [grammars.carveGrammar, grammars.carveCsvGrammar, grammars.carveTsvGrammar, ...(options.langs ?? [])],
    langAlias: options.langAlias,
  })
  const carveNames = new Set([grammars.carveGrammar.name, ...(grammars.carveGrammar.aliases ?? [])])
  const resolveLang = (lang: string): string => options.langAlias?.[lang] ?? lang
  const loaded = (lang: string): boolean => highlighter.getLoadedLanguages().includes(lang)

  return {
    accepts(lang) {
      const name = resolveLang(lang)
      return loaded(name) || name in shiki.bundledLanguages
    },
    async highlight(block) {
      const lang = resolveLang(block.lang)
      if (!loaded(lang)) await highlighter.loadLanguage(lang as BundledLanguage)
      const attrs = block.attrs
      const preAttributes: ShikiTransformer = {
        name: 'astro-carve:attributes',
        pre(node) {
          if (attrs?.id) node.properties.id = attrs.id
          for (const c of attrs?.classes ?? []) this.addClassToHast(node, c)
          for (const [key, value] of attrs?.keyValues ?? []) node.properties[key] = value
          if (block.header !== undefined) node.properties.title = block.header
          node.properties.dataLanguage = block.lang
          if (options.wrap === true) node.properties.style = `${node.properties.style ?? ''};overflow-x:auto;white-space:pre-wrap;word-wrap:break-word`
          else if (options.wrap === false) node.properties.style = `${node.properties.style ?? ''};overflow-x:auto`
        },
      }
      return highlighter.codeToHtml(block.code.replace(/\n$/, ''), {
        lang,
        ...(themes ? { themes, defaultColor: options.defaultColor } : { theme: theme!.name! }),
        transformers: [
          // Scope explanations are costly, so only Carve fences pay for them.
          ...(carveNames.has(lang) ? [grammars.carveStylingTransformer] : []),
          ...(options.transformers ?? []),
          preAttributes,
        ],
      })
    },
  }
}

const cache = new WeakMap<object, Promise<CarveHighlighter>>()
// Shared so every `highlight: true` render without Astro config hits the cache.
const DEFAULTS: CarveHighlightOptions = {}

/** One highlighter per options object, or none when highlighting is off. */
export function highlighterFor(option: boolean | CarveHighlightOptions | undefined, fallback: CarveHighlightOptions = DEFAULTS): Promise<CarveHighlighter> | undefined {
  if (!option) return undefined
  const config = option === true ? fallback : option
  let highlighter = cache.get(config)
  if (!highlighter) cache.set(config, highlighter = createCarveHighlighter(config))
  return highlighter
}

/** Plain text of a fence title, for the `title` attribute. */
function titleText(nodes: readonly unknown[] | undefined): string | undefined {
  if (!nodes) return undefined
  let out = ''
  for (const value of nodes) {
    if (!value || typeof value !== 'object') continue
    const node = value as { value?: unknown; children?: unknown[] }
    if (typeof node.value === 'string') out += node.value
    else if (Array.isArray(node.children)) out += titleText(node.children) ?? ''
  }
  return out
}

/**
 * Highlight through the engine's `codeBlockRenderer` (C2-H-206): accepted fences
 * render as a marker, and `apply` swaps in Shiki's HTML once it is ready.
 */
export function codeCollector(
  highlighter: CarveHighlighter,
  fallback?: ((node: Readonly<CodeBlockNode>, defaultHtml: string) => string | null | undefined) | null,
): { codeBlockRenderer: (node: Readonly<CodeBlockNode>, defaultHtml: string) => string | null | undefined; apply(html: string): Promise<string> } {
  const blocks: PendingBlock[] = []
  const nonce = Math.random().toString(36).slice(2)
  const marker = (i: number): string => `<!--astro-carve-shiki:${nonce}:${i}-->`
  return {
    codeBlockRenderer(node, defaultHtml) {
      if (!node.syntax || !highlighter.accepts(node.syntax)) return fallback?.(node, defaultHtml)
      blocks.push({ lang: node.syntax, code: node.value, attrs: node.attrs, header: titleText(node.title) })
      return marker(blocks.length - 1)
    },
    async apply(html) {
      const rendered = await Promise.all(blocks.map(block => highlighter.highlight(block)))
      return rendered.reduce((out, block, i) => out.replace(marker(i), () => block), html)
    },
  }
}
