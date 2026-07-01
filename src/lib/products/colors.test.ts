import { describe, expect, it } from 'vitest'

import {
  CATEGORY_COLORS,
  categoryColorHex,
  categoryColorKey,
  COLOR_SWATCHES,
  CURATED_COLORS,
  defaultColorKey,
  hashColorKey,
  isSwatchKey,
  productColorHex,
  productColorKey,
  swatchHex,
} from './colors'

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

  it('every curated color references a real swatch key', () => {
    for (const [id, key] of Object.entries(CURATED_COLORS)) {
      expect(isSwatchKey(key), `${id} → ${key}`).toBe(true)
    }
  })
})

describe('swatchHex', () => {
  it('resolves a known key and falls back for unknown/empty', () => {
    expect(swatchHex('indigo')).toBe('#5E6AD2')
    const fallback = swatchHex('slate')
    expect(swatchHex('nope')).toBe(fallback)
    expect(swatchHex(undefined)).toBe(fallback)
    expect(swatchHex('')).toBe(fallback)
  })
})

describe('defaultColorKey', () => {
  it('prefers a curated color for a flagship product', () => {
    expect(defaultColorKey('chat')).toBe('green')
    expect(defaultColorKey('gpus')).toBe('orange')
  })

  it('is deterministic and valid for the long tail', () => {
    const a = defaultColorKey('some-unlisted-product')
    const b = defaultColorKey('some-unlisted-product')
    expect(a).toBe(b)
    expect(isSwatchKey(a)).toBe(true)
  })

  it('hashColorKey spreads across the palette (not a single color)', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `product-${i}`)
    const distinct = new Set(ids.map(hashColorKey))
    expect(distinct.size).toBeGreaterThan(4)
  })
})

describe('productColorKey — override precedence', () => {
  it('a valid user override wins over curated + hash', () => {
    expect(productColorKey('chat', { chat: 'red' })).toBe('red')
  })

  it('an invalid override is ignored (falls through to the default)', () => {
    expect(productColorKey('chat', { chat: 'not-a-color' })).toBe('green')
  })

  it('no override → the default key; hex tracks the key', () => {
    expect(productColorKey('chat', {})).toBe('green')
    expect(productColorKey('chat', null)).toBe('green')
    expect(productColorHex('chat', { chat: 'red' })).toBe(swatchHex('red'))
  })
})

describe('category colors — per-category scheme', () => {
  it('every category color references a real swatch key', () => {
    for (const [cat, key] of Object.entries(CATEGORY_COLORS)) {
      expect(isSwatchKey(key), `${cat} → ${key}`).toBe(true)
    }
  })

  it('categoryColorKey resolves a known category and is deterministic for unknown', () => {
    expect(categoryColorKey('AI')).toBe(CATEGORY_COLORS.AI)
    expect(categoryColorKey('Data')).toBe(CATEGORY_COLORS.Data)
    const unknown = categoryColorKey('Nonexistent')
    expect(isSwatchKey(unknown)).toBe(true)
    expect(categoryColorKey('Nonexistent')).toBe(unknown)
    expect(isSwatchKey(categoryColorKey(undefined))).toBe(true)
  })

  it('categoryColorHex tracks the category key', () => {
    expect(categoryColorHex('Security')).toBe(swatchHex(CATEGORY_COLORS.Security))
  })

  it('a known category makes the whole category share ONE color (curated ignored there)', () => {
    // Passing a category → every product in it resolves to the category color…
    expect(defaultColorKey('chat', 'AI')).toBe(CATEGORY_COLORS.AI)
    expect(defaultColorKey('models', 'AI')).toBe(defaultColorKey('providers', 'AI'))
    // …while the no-category path (product-module callers) keeps the legacy curated pick.
    expect(defaultColorKey('chat')).toBe('green')
  })

  it('a user override still wins over the category default', () => {
    expect(productColorKey('chat', { chat: 'red' }, 'AI')).toBe('red')
    expect(productColorKey('chat', {}, 'AI')).toBe(CATEGORY_COLORS.AI)
    expect(productColorHex('chat', null, 'Data')).toBe(swatchHex(CATEGORY_COLORS.Data))
  })
})
