import { describe, expect, it } from 'vitest'

import {
  categoryColorHex,
  categoryColorKey,
  COLOR_SWATCHES,
  defaultColorKey,
  hashColorKey,
  isSwatchKey,
  productColorHex,
  productColorKey,
  swatchHex,
} from './colors'

/** True when a #RRGGBB hex is a pure greyscale (R === G === B) — the monochrome guarantee. */
function isGreyscale(hex: string): boolean {
  const m = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/.exec(hex)
  if (!m) return false
  return m[1].toLowerCase() === m[2].toLowerCase() && m[2].toLowerCase() === m[3].toLowerCase()
}

// Every hue the pre-monochrome palette shipped — none may reintroduce color.
const LEGACY_KEYS = [
  'indigo', 'blue', 'sky', 'cyan', 'teal', 'green', 'lime',
  'amber', 'orange', 'red', 'rose', 'pink', 'purple', 'violet',
]

describe('color palette — monochrome by construction', () => {
  it('has unique, non-empty keys and valid hex values', () => {
    const keys = COLOR_SWATCHES.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const s of COLOR_SWATCHES) {
      expect(s.key).toBeTruthy()
      expect(s.label).toBeTruthy()
      expect(s.hex).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('EVERY swatch is a pure greyscale (no hue anywhere in the palette)', () => {
    for (const s of COLOR_SWATCHES) {
      expect(isGreyscale(s.hex), `${s.key} → ${s.hex}`).toBe(true)
    }
  })
})

describe('swatchHex', () => {
  it('resolves a known monochrome key and falls back for unknown/empty', () => {
    expect(swatchHex('silver')).toBe('#D4D4D4')
    const fallback = swatchHex('silver')
    expect(swatchHex('nope')).toBe(fallback)
    expect(swatchHex(undefined)).toBe(fallback)
    expect(swatchHex('')).toBe(fallback)
  })

  it('legacy chromatic keys still resolve, but ONLY to a greyscale (never a hue)', () => {
    for (const key of LEGACY_KEYS) {
      expect(isSwatchKey(key), key).toBe(true)
      expect(isGreyscale(swatchHex(key)), `${key} → ${swatchHex(key)}`).toBe(true)
    }
  })
})

describe('defaultColorKey — uniform neutral', () => {
  it('is the single neutral default for every product and category', () => {
    expect(defaultColorKey('chat')).toBe('silver')
    expect(defaultColorKey('gpus')).toBe('silver')
    expect(defaultColorKey('chat', 'AI')).toBe('silver')
    expect(defaultColorKey('models', 'AI')).toBe(defaultColorKey('providers', 'AI'))
  })

  it('is deterministic and valid for the long tail', () => {
    const a = defaultColorKey('some-unlisted-product')
    const b = defaultColorKey('some-unlisted-product')
    expect(a).toBe(b)
    expect(isSwatchKey(a)).toBe(true)
  })

  it('hashColorKey stays within the monochrome ramp', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `product-${i}`)
    for (const id of ids) {
      expect(isGreyscale(swatchHex(hashColorKey(id))), id).toBe(true)
    }
  })
})

describe('productColorKey — override precedence', () => {
  it('a valid user override wins over the default', () => {
    expect(productColorKey('chat', { chat: 'white' })).toBe('white')
  })

  it('a legacy override is honored as a key but renders greyscale', () => {
    expect(productColorKey('chat', { chat: 'red' })).toBe('red')
    expect(isGreyscale(productColorHex('chat', { chat: 'red' }))).toBe(true)
  })

  it('an invalid override is ignored (falls through to the default)', () => {
    expect(productColorKey('chat', { chat: 'not-a-color' })).toBe('silver')
  })

  it('no override → the neutral default; hex tracks the key', () => {
    expect(productColorKey('chat', {})).toBe('silver')
    expect(productColorKey('chat', null)).toBe('silver')
    expect(productColorHex('chat', { chat: 'white' })).toBe(swatchHex('white'))
  })
})

describe('category colors — one cohesive neutral scheme', () => {
  it('every category resolves to the SAME neutral default', () => {
    expect(categoryColorKey('AI')).toBe('silver')
    expect(categoryColorKey('Data')).toBe('silver')
    expect(categoryColorKey('Security')).toBe('silver')
    expect(categoryColorKey('Nonexistent')).toBe('silver')
    expect(categoryColorKey(undefined)).toBe('silver')
  })

  it('categoryColorHex is a greyscale value', () => {
    expect(categoryColorHex('Security')).toBe(swatchHex('silver'))
    expect(isGreyscale(categoryColorHex('AI'))).toBe(true)
  })

  it('a user override still wins over the category default', () => {
    expect(productColorKey('chat', { chat: 'white' }, 'AI')).toBe('white')
    expect(productColorKey('chat', {}, 'AI')).toBe('silver')
    expect(productColorHex('chat', null, 'Data')).toBe(swatchHex('silver'))
  })
})
