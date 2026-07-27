import { describe, expect, it } from 'vitest'

import {
  categoryColorHex,
  categoryColorKey,
  CATEGORY_COLORS,
  COLOR_SWATCHES,
  defaultColorKey,
  hashColorKey,
  isSwatchKey,
  productColorHex,
  productColorKey,
  swatchHex,
} from './colors'

const ACCENT_KEYS = [
  'indigo', 'blue', 'sky', 'cyan', 'teal', 'green', 'lime',
  'amber', 'orange', 'red', 'rose', 'pink', 'purple', 'violet',
]

describe('color palette', () => {
  it('has unique, non-empty keys and valid hex values', () => {
    const keys = COLOR_SWATCHES.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const s of COLOR_SWATCHES) {
      expect(s.key).toBeTruthy()
      expect(s.label).toBeTruthy()
      expect(s.hex).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('contains every category accent', () => {
    for (const key of Object.values(CATEGORY_COLORS)) expect(isSwatchKey(key), key).toBe(true)
  })
})

describe('swatchHex', () => {
  it('resolves a known key and falls back for unknown/empty', () => {
    expect(swatchHex('silver')).toBe('#D4D4D4')
    const fallback = swatchHex('silver')
    expect(swatchHex('nope')).toBe(fallback)
    expect(swatchHex(undefined)).toBe(fallback)
    expect(swatchHex('')).toBe(fallback)
  })

  it('resolves every accent to its declared value', () => {
    for (const key of ACCENT_KEYS) {
      expect(isSwatchKey(key), key).toBe(true)
      expect(swatchHex(key)).toBe(COLOR_SWATCHES.find((s) => s.key === key)?.hex)
    }
  })
})

describe('defaultColorKey', () => {
  it('uses one accent for every product in a category', () => {
    expect(defaultColorKey('chat', 'AI')).toBe('violet')
    expect(defaultColorKey('models', 'AI')).toBe(defaultColorKey('providers', 'AI'))
  })

  it('is deterministic and valid for the long tail', () => {
    const a = defaultColorKey('some-unlisted-product')
    const b = defaultColorKey('some-unlisted-product')
    expect(a).toBe(b)
    expect(isSwatchKey(a)).toBe(true)
  })

  it('hashColorKey stays within the palette', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `product-${i}`)
    for (const id of ids) expect(isSwatchKey(hashColorKey(id)), id).toBe(true)
  })
})

describe('productColorKey — override precedence', () => {
  it('a valid user override wins over the default', () => {
    expect(productColorKey('chat', { chat: 'white' })).toBe('white')
  })

  it('an accent override is honored', () => {
    expect(productColorKey('chat', { chat: 'red' })).toBe('red')
    expect(productColorHex('chat', { chat: 'red' })).toBe(swatchHex('red'))
  })

  it('an invalid override is ignored (falls through to the default)', () => {
    expect(productColorKey('chat', { chat: 'not-a-color' })).toBe(defaultColorKey('chat'))
  })

  it('no override uses the default; hex tracks the key', () => {
    expect(productColorKey('chat', {})).toBe(defaultColorKey('chat'))
    expect(productColorKey('chat', null)).toBe(defaultColorKey('chat'))
    expect(productColorHex('chat', { chat: 'white' })).toBe(swatchHex('white'))
  })
})

describe('category colors', () => {
  it('resolves the canonical category map and a stable fallback', () => {
    expect(categoryColorKey('AI')).toBe('violet')
    expect(categoryColorKey('Data')).toBe('cyan')
    expect(categoryColorKey('Security')).toBe('red')
    expect(categoryColorKey('Nonexistent')).toBe(categoryColorKey('Nonexistent'))
    expect(isSwatchKey(categoryColorKey(undefined))).toBe(true)
  })

  it('categoryColorHex follows the category key', () => {
    expect(categoryColorHex('Security')).toBe(swatchHex('red'))
    expect(categoryColorHex('AI')).toBe(swatchHex('violet'))
  })

  it('a user override still wins over the category default', () => {
    expect(productColorKey('chat', { chat: 'white' }, 'AI')).toBe('white')
    expect(productColorKey('chat', {}, 'AI')).toBe('violet')
    expect(productColorHex('chat', null, 'Data')).toBe(swatchHex('cyan'))
  })
})
