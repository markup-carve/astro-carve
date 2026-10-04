import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'

type Element = DefaultTreeAdapterMap['element']

export interface LocalImage { src: string; start: number; end: number; tagStart: number; tagEnd: number; attributes: Record<string, string> }

/** Locate file-relative image attributes in rendered HTML. */
export function localImages(html: string): LocalImage[] {
  const root = parseFragment(html, { sourceCodeLocationInfo: true })
  const images: LocalImage[] = []
  const stack: DefaultTreeAdapterMap['node'][] = [...root.childNodes]
  while (stack.length) {
    const node = stack.pop()!
    if ('childNodes' in node) stack.push(...node.childNodes)
    if (!('tagName' in node) || node.tagName !== 'img') continue
    const element = node as Element
    const src = element.attrs.find(attr => attr.name === 'src')?.value
    const location = element.sourceCodeLocation?.attrs?.src
    if (!src || !location || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(src)) continue
    const tag = element.sourceCodeLocation?.startTag
    if (!tag) continue
    images.push({ src, start: location.startOffset, end: location.endOffset, tagStart: tag.startOffset, tagEnd: tag.endOffset, attributes: Object.fromEntries(element.attrs.map(attr => [attr.name, attr.value])) })
  }
  return images.sort((a, b) => a.start - b.start)
}


export function htmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** Decode the file path while retaining query and fragment delimiters. */
export function imageImportPath(src: string): string {
  const offset = src.search(/[?#]/)
  const path = offset < 0 ? src : src.slice(0, offset)
  try { return decodeURIComponent(path) + (offset < 0 ? '' : src.slice(offset)) }
  catch { return src }
}
