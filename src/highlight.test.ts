import { describe, expect, test } from 'vitest'
import { renderCarve } from './transform.js'

describe('Shiki highlighting on Carve 0.2', () => {
  test('retains the option and explains the missing general code block hook', () => {
    expect(() => renderCarve('```ts\nlet a\n```\n', { highlight: true }))
      .toThrow(/general code block renderer hook/)
  })

  test.skip('Shiki code block renderer awaits a 0.2 engine hook', () => {})
})
