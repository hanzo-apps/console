/**
 * Product colors — one accent per CATEGORY, everything else neutral.
 *
 * Colour here does ONE job: it tells you which family a product belongs to at a
 * glance, across the sidebar icons, the category-overview tiles and the level-2
 * header. It is identity, not decoration — chrome, shell, surfaces and controls
 * stay monochrome, which is what makes the accent legible at all.
 *
 * The palette was flattened to a neutral ramp in the monochrome redesign
 * (0ee6a9274a). That went one step too far: with every icon the same grey the
 * sidebar lost the only cue that distinguished fourteen categories at a glance,
 * and shape alone does not carry that far at 16px. The hues below are the
 * originals, restored verbatim — they were tuned to read on true black.
 *
 * The neutral ramp did NOT go away. It stays as the per-product EMPHASIS the
 * customize pane offers, so a user who wants a uniform sidebar can still have
 * one, and a persisted neutral override still resolves.
 *
 * Resolution is three honest layers (most specific wins):
 *   1. the user's per-product override,
 *   2. the product's curated colour,
 *   3. its category's family colour, else a stable hash.
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
  // Category hues — restored from the pre-monochrome palette, tuned for true black.
  { key: 'violet', label: 'Violet', hex: '#8257E6' },
  { key: 'purple', label: 'Purple', hex: '#A972F0' },
  { key: 'indigo', label: 'Indigo', hex: '#5E6AD2' },
  { key: 'blue', label: 'Blue', hex: '#4C8DFF' },
  { key: 'sky', label: 'Sky', hex: '#38BDF8' },
  { key: 'cyan', label: 'Cyan', hex: '#22C3C3' },
  { key: 'teal', label: 'Teal', hex: '#2DD4A7' },
  { key: 'green', label: 'Green', hex: '#3FB950' },
  { key: 'lime', label: 'Lime', hex: '#84CC16' },
  { key: 'amber', label: 'Amber', hex: '#E3A008' },
  { key: 'orange', label: 'Orange', hex: '#F0883E' },
  { key: 'red', label: 'Red', hex: '#F2564B' },
  { key: 'rose', label: 'Rose', hex: '#F16D8A' },
  { key: 'pink', label: 'Pink', hex: '#EC6FAF' },
  // Neutral emphasis ramp (design tokens/colors.css --neutral-50 … --neutral-600).
  { key: 'white', label: 'White', hex: '#FAFAFA' },
  { key: 'silver', label: 'Silver', hex: '#D4D4D4' },
  { key: 'grey', label: 'Grey', hex: '#A3A3A3' },
  { key: 'slate', label: 'Slate', hex: '#737373' },
  { key: 'steel', label: 'Steel', hex: '#525252' },
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
 * No aliasing: every key in COLOR_SWATCHES is a real swatch again. The table that
 * used to live here re-pointed the chromatic keys at neutrals, which is how a
 * persisted "violet" silently became grey. Kept empty rather than deleted so the
 * resolver below stays one shape, and so it is obvious this is deliberate.
 */
const LEGACY_ALIAS: Record<string, string> = {}


/** True when `key` resolves to a real swatch or a legacy alias. */
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

/**
 * One accent per CATEGORY — the family every product in it inherits by default,
 * so sidebar, tiles and the level-2 header read as one scheme. Keys MUST be real
 * swatch keys; a category not listed falls back to a stable hash.
 */
export const CATEGORY_COLORS: Record<string, string> = {
  AI: 'violet',
  Compute: 'blue',
  Data: 'cyan',
  Network: 'sky',
  Security: 'red',
  Observe: 'green',
  Platform: 'teal',
  Dev: 'indigo',
  Web3: 'amber',
  Apps: 'pink',
  Settings: 'slate',
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
 * A stable swatch key for any id. Used only when no category color is defined.
 */
export const hashColorKey = (id: string): string => COLOR_SWATCHES[hash32(id) % COLOR_SWATCHES.length].key

/**
 * One accent per category. A user's per-product override still wins.
 */
export const categoryColorKey = (category?: string | null): string =>
  (typeof category === 'string' && CATEGORY_COLORS[category]) || hashColorKey(category ?? 'category')

/** The hex for a category's accent. */
export const categoryColorHex = (category?: string | null): string => swatchHex(categoryColorKey(category))

/**
 * The DEFAULT swatch key for a product (no user override): its CATEGORY's family
 * colour, so a whole category reads as one scheme. Falls back to a stable per-id
 * hash when the category is unknown, which keeps the long tail distinguishable
 * instead of collapsing it into one grey.
 */
export const defaultColorKey = (id: string, category?: string | null): string =>
  (typeof category === 'string' && CATEGORY_COLORS[category]) || hashColorKey(id)

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
