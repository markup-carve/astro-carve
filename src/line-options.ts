import type { ShikiTransformer } from 'shiki'

type Attrs = { classes?: string[]; keyValues?: [string, string][] }

/** Carve C2-H-211 to C2-H-213, for one Shiki code block. */
export function lineOptionsTransformer(attrs?: Attrs): ShikiTransformer {
  const numbered = attrs?.classes?.includes('line-numbers') ?? false
  const values = new Map(attrs?.keyValues ?? [])
  const highlight = values.get('data-highlight')
  const startValue = values.get('data-line-start')
  const start = typeof startValue === 'string' && /^[1-9][0-9]*$/.test(startValue) ? BigInt(startValue) : 1n
  let ranges: bigint[][] = []
  return {
    name: 'astro-carve:line-options',
    preprocess() {
      ranges = []
      if (typeof highlight !== 'string' || !/^[1-9][0-9]*(?:-[1-9][0-9]*)?(?:,[1-9][0-9]*(?:-[1-9][0-9]*)?)*$/.test(highlight)) return
      const items = highlight.split(',').map((item) => item.split('-').map(BigInt))
      if (items.some(([first, last = first]) => first > last)) return
      ranges = items
    },
    pre(node) {
      if (numbered || highlight !== undefined) this.addClassToHast(node, 'has-line-options')
      if (numbered) this.addClassToHast(node, 'has-line-numbers')
    },
    line(node, line) {
      if (numbered) {
        const number = String(start + BigInt(line - 1))
        node.properties.dataLineNumber = number
        node.children.unshift({
          type: 'element', tagName: 'span',
          properties: { class: ['line-number'], 'aria-hidden': 'true', style: 'display:inline-block;min-width:3ch;padding-right:1ch;text-align:right;user-select:none;opacity:.6' },
          children: [{ type: 'text', value: number }],
        })
      }
      if (ranges.some(([first, last = first]) => first <= BigInt(line) && BigInt(line) <= last)) {
        this.addClassToHast(node, 'highlighted-line')
        node.properties.style = [node.properties.style, 'background:rgb(255 213 0 / 18%)'].filter(Boolean).join(';')
      }
    },
  }
}
