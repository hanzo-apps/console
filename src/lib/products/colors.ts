/**
 * Product colors — the Linear-style palette for the console.
 *
 * Every product gets a stable, tasteful accent color that tints its icon in the
 * sidebar, command palette, and app launcher. Colors are chosen from ONE curated
 * palette so the whole console stays cohesive (no random rainbow), and a user can
 * override any product's color from the customize pane (persisted per-user via the
 * account-backed preferences — `productColors: Record<id, swatchKey>`).
 *
 * Resolution is three honest layers (most specific wins):
 *   1. the user's per-product override (their explicit choice),
 *   2. a curated color for a flagship product (an intentional, on-brand pick),
 *   3. a deterministic hash of the id into the palette (stable + varied for the
 *      long tail — the same product always gets the same color).
 *
 * PURE + dependency-free (no React, no registry import) so it is unit-testable in
 * isolation and safe to import from anywhere.
 */

/** One selectable color. `hex` is tuned to read well on BOTH dark and light. */
export type Swatch = { key: string; label: string; hex: string }

/**
 * The curated palette — a cohesive, Linear-like set. Ordered for a pleasant
 * left-to-right ramp in the picker. Keys are stable (persisted in prefs), so a
 * key is NEVER renamed once shipped (add new ones at the end instead).
 */
export const COLOR_SWATCHES: Swatch[] = [
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
  { key: 'purple', label: 'Purple', hex: '#A972F0' },
  { key: 'violet', label: 'Violet', hex: '#8257E6' },
  { key: 'slate', label: 'Slate', hex: '#8B93A7' },
]

const SWATCH_BY_KEY: Record<string, Swatch> = Object.fromEntries(COLOR_SWATCHES.map((s) => [s.key, s]))

/** A stable neutral used when a key is unknown (never throws). */
const FALLBACK = SWATCH_BY_KEY.slate

/** True when `key` is a real, selectable swatch key. */
export const isSwatchKey = (key: string | undefined | null): key is string =>
  typeof key === 'string' && key in SWATCH_BY_KEY

/** Resolve a swatch key to its hex (unknown/empty → the neutral fallback). */
export const swatchHex = (key: string | undefined | null): string =>
  (isSwatchKey(key) ? SWATCH_BY_KEY[key] : FALLBACK).hex

/**
 * Intentional colors for flagship products, so the surfaces that matter most read
 * exactly right. Every value MUST be a real swatch key. A product not listed here
 * still gets a stable color from the hash — this map only pins the important ones.
 */
export const CURATED_COLORS: Record<string, string> = {
  overview: 'indigo',
  // AI
  models: 'violet',
  providers: 'blue',
  chat: 'green',
  playground: 'purple',
  bot: 'orange',
  marketplace: 'pink',
  inference: 'violet',
  agents: 'purple',
  // Data
  embeddings: 'cyan',
  vector: 'cyan',
  sql: 'teal',
  kv: 'teal',
  s3: 'amber',
  datastore: 'blue',
  docdb: 'sky',
  search: 'sky',
  base: 'indigo',
  // Compute
  gpus: 'orange',
  machines: 'blue',
  kubernetes: 'sky',
  containers: 'sky',
  functions: 'amber',
  tasks: 'amber',
  clusters: 'blue',
  edge: 'lime',
  // Network
  dns: 'sky',
  cdn: 'sky',
  network: 'sky',
  gateway: 'blue',
  // Security
  iam: 'red',
  kms: 'red',
  authz: 'red',
  hsm: 'rose',
  audit: 'rose',
  // Observe
  traces: 'purple',
  observations: 'purple',
  cost: 'green',
  plans: 'green',
  billing: 'green',
  status: 'teal',
  alerts: 'red',
  // Dev
  cli: 'slate',
  sdks: 'slate',
  ide: 'indigo',
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

/** A stable swatch key for any id — hashed across the palette so it is varied. */
export const hashColorKey = (id: string): string =>
  COLOR_SWATCHES[hash32(id) % COLOR_SWATCHES.length].key

/**
 * One accent color per CATEGORY — the Linear-style family that every product in a
 * category inherits by DEFAULT, so the sidebar icons, the category-overview tiles,
 * and the level-2 header read as one coherent per-category scheme (a user's
 * per-product override still wins). Keys MUST be real swatch keys; a category not
 * listed here (or an entry with no category) falls back to a stable hash.
 */
export const CATEGORY_COLORS: Record<string, string> = {
  AI: 'violet',
  Compute: 'blue',
  Training: 'purple',
  Data: 'cyan',
  Network: 'sky',
  Security: 'red',
  Observe: 'green',
  Platform: 'teal',
  Dev: 'indigo',
  Web3: 'amber',
  Apps: 'pink',
  Commerce: 'orange',
  Billing: 'lime',
  Settings: 'slate',
}

/** The swatch key for a category — its curated family color, else a stable hash. */
export const categoryColorKey = (category: string | undefined | null): string =>
  (typeof category === 'string' && CATEGORY_COLORS[category]) || hashColorKey(category ?? 'category')

/** The hex for a category's accent — for tinting category headers / breadcrumbs. */
export const categoryColorHex = (category: string | undefined | null): string =>
  swatchHex(categoryColorKey(category))

/**
 * The DEFAULT swatch key for a product (no user override). When the product's
 * CATEGORY is known, the category family color wins (so a whole category reads as
 * one color scheme); with no category it is a curated flagship pick, else the
 * deterministic hash. Stable per id (+ category).
 */
export const defaultColorKey = (id: string, category?: string | null): string =>
  category ? categoryColorKey(category) : CURATED_COLORS[id] ?? hashColorKey(id)

/**
 * The EFFECTIVE swatch key for a product, honoring the user's overrides first.
 * `overrides` is the per-user `productColors` preference (id → swatch key). An
 * override to an unknown key is ignored (falls through to the default).
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

/** The effective hex for a product's icon, honoring user overrides (+ category default). */
export const productColorHex = (
  id: string,
  overrides?: Record<string, string> | null,
  category?: string | null,
): string => swatchHex(productColorKey(id, overrides, category))
