/**
 * Product colors — MONOCHROME, per the Hanzo Design System (hanzoai/design).
 *
 * The design language is monochrome by construction: "one neutral ladder plus an
 * opacity ladder is the entire palette. Color appears only as genuine semantics
 * (live/error/warning)." So product/category icons are NOT tinted a per-product
 * hue — they read in ONE neutral off the foreground, distinguished by SHAPE, the
 * Linear/Vercel language. A user may still pick a neutral EMPHASIS (a lighter or
 * heavier grey) per product from the customize pane; that override is persisted
 * per-user (`productColors: Record<id, swatchKey>`).
 *
 * Every hex below is a value from the design neutral ladder (tokens/colors.css:
 * --neutral-50 … --neutral-600), so this file stays in lockstep with the tokens.
 *
 * Resolution is two honest layers (most specific wins):
 *   1. the user's per-product override (their explicit neutral choice),
 *   2. the single neutral default (uniform, cohesive).
 *
 * PURE + dependency-free (no React, no registry import) so it is unit-testable in
 * isolation and safe to import from anywhere.
 */

/** One selectable color. `hex` is a design neutral-ladder value; reads on dark AND light. */
export type Swatch = { key: string; label: string; hex: string }

/**
 * The monochrome emphasis ramp — the customize picker. A light-to-heavy neutral
 * ramp off the design neutral ladder (tokens/colors.css). Keys are stable
 * (persisted in prefs), so a key is NEVER renamed once shipped.
 */
export const COLOR_SWATCHES: Swatch[] = [
  { key: 'white', label: 'White', hex: '#FAFAFA' }, // --neutral-50
  { key: 'silver', label: 'Silver', hex: '#D4D4D4' }, // --neutral-300 (default)
  { key: 'grey', label: 'Grey', hex: '#A3A3A3' }, // --neutral-400
  { key: 'slate', label: 'Slate', hex: '#737373' }, // --neutral-500
  { key: 'steel', label: 'Steel', hex: '#525252' }, // --neutral-600
]

const SWATCH_BY_KEY: Record<string, Swatch> = Object.fromEntries(COLOR_SWATCHES.map((s) => [s.key, s]))

/**
 * The default emphasis — a calm neutral-300 that reads clearly on true-black
 * without the glare of pure white. Every product/category inherits this unless
 * the user overrides it.
 */
const DEFAULT_KEY = 'silver'

/** A stable neutral used when a key is unknown (never throws). */
const FALLBACK = SWATCH_BY_KEY[DEFAULT_KEY]

/**
 * Legacy chromatic keys (indigo/blue/purple/… from the pre-monochrome palette)
 * remain RESOLVABLE — a persisted override to an old key never breaks and never
 * reintroduces color; it maps into the neutral ramp instead. Keys are never
 * re-colored, only re-pointed. This is the one place the old palette is retired.
 */
const LEGACY_ALIAS: Record<string, string> = {
  indigo: 'silver',
  blue: 'silver',
  sky: 'silver',
  cyan: 'silver',
  teal: 'silver',
  green: 'silver',
  lime: 'grey',
  amber: 'grey',
  orange: 'grey',
  red: 'grey',
  rose: 'grey',
  pink: 'grey',
  purple: 'silver',
  violet: 'silver',
}

/** True when `key` resolves to a real swatch (a current monochrome key or a legacy alias). */
export const isSwatchKey = (key: string | undefined | null): key is string =>
  typeof key === 'string' && (key in SWATCH_BY_KEY || key in LEGACY_ALIAS)

/** Resolve a swatch key to its hex (unknown/empty → the neutral fallback). */
export const swatchHex = (key: string | undefined | null): string => {
  if (typeof key === 'string') {
    if (key in SWATCH_BY_KEY) return SWATCH_BY_KEY[key].hex
    const alias = LEGACY_ALIAS[key]
    if (alias) return SWATCH_BY_KEY[alias].hex
  }
  return FALLBACK.hex
}

/** Small, well-distributed string hash (FNV-1a, 32-bit). Deterministic + pure. */
function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * A stable swatch key for any id — hashed across the monochrome ramp. Kept for API
 * compatibility; the default path is uniform, so this only varies the LONG TAIL
 * within neutrals (never a color) when a caller opts into per-id variety.
 */
export const hashColorKey = (id: string): string => COLOR_SWATCHES[hash32(id) % COLOR_SWATCHES.length].key

/**
 * One accent per CATEGORY. Monochrome: every category resolves to the SAME neutral
 * default, so the sidebar, category-overview tiles, and level-2 headers read as one
 * cohesive scheme (a user's per-product override still wins). Signature kept stable.
 */
export const categoryColorKey = (_category?: string | null): string => DEFAULT_KEY

/** The hex for a category's accent — the neutral default (for headers / breadcrumbs). */
export const categoryColorHex = (category?: string | null): string => swatchHex(categoryColorKey(category))

/**
 * The DEFAULT swatch key for a product (no user override): the single neutral. Uniform
 * across products and categories — hue never encodes meaning; shape does. Signature kept.
 */
export const defaultColorKey = (_id: string, _category?: string | null): string => DEFAULT_KEY

/**
 * The EFFECTIVE swatch key for a product, honoring the user's override first.
 * `overrides` is the per-user `productColors` preference (id → swatch key). An
 * override to an unknown key is ignored (falls through to the neutral default).
 */
export function productColorKey(
  id: string,
  overrides?: Record<string, string> | null,
  category?: string | null,
): string {
  const override = overrides?.[id]
  if (isSwatchKey(override)) return override
  return defaultColorKey(id, category)
}

/** The effective hex for a product's icon, honoring user overrides (+ neutral default). */
export const productColorHex = (
  id: string,
  overrides?: Record<string, string> | null,
  category?: string | null,
): string => swatchHex(productColorKey(id, overrides, category))
