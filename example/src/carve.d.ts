declare module '*.crv' {
  export const source: string
  export const html: string
  export const frontmatter: { format: string; content: string } | null
  export const frontmatterData: Record<string, unknown>
  const _default: string
  export default _default
}

declare module '*.carve' {
  export const source: string
  export const html: string
  export const frontmatter: { format: string; content: string } | null
  export const frontmatterData: Record<string, unknown>
  const _default: string
  export default _default
}
