import type { CarveExtension, CodeBlock } from '@markup-carve/carve'
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

type Attrs = { id?: string; classes?: string[]; keyValues?: Record<string, string> }

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
          for (const [key, value] of Object.entries(attrs?.keyValues ?? {})) node.properties[key] = value
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

/**
 * Collects fenced code during a synchronous render and leaves a placeholder,
 * so the async Shiki pass can run afterwards. Fences without a language, or in
 * a language Shiki cannot load, keep the engine's plain `<pre><code>`.
 */
export function codeCollector(highlighter: CarveHighlighter): { extension: CarveExtension; apply(html: string): Promise<string> } {
  const blocks: PendingBlock[] = []
  const nonce = Math.random().toString(36).slice(2)
  const marker = (i: number): string => `<!--astro-carve-shiki:${nonce}:${i}-->`
  return {
    extension: {
      name: 'astro-carve:shiki',
      blockRenderers: {
        code_block: (node, ctx) => {
          const code = node as CodeBlock
          if (!code.lang || !highlighter.accepts(code.lang)) return undefined
          blocks.push({ lang: code.lang, code: code.content, attrs: code.attrs as Attrs | undefined, header: code.header })
          return `${ctx.indent(ctx.level)}${marker(blocks.length - 1)}`
        },
      },
    },
    async apply(html) {
      const rendered = await Promise.all(blocks.map(block => highlighter.highlight(block)))
      return rendered.reduce((out, block, i) => out.replace(marker(i), () => block), html)
    },
  }
}
