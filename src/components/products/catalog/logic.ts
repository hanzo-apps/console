/**
 * Pure logic for the Catalog & Pricing admin editor — no React/gui/registry
 * imports, so it is node-testable in isolation (the repo convention for
 * `registry.tsx`-adjacent code).
 *
 * The editor drives commerce's platform `catalog-entry` (the SoT for products +
 * pricing — the 17 infra tiers increment 1 seeded, plus every product surface).
 * These helpers own the two value transforms the form needs: money (the display
 * dollars ↔ the stored `priceCents`) and the structured `Metadata` spec (a JSON
 * object ↔ an editable key/value list that PRESERVES each value's real type).
 */

/** The infra-tier categories whose Metadata is a structured spec (vcpus / gpu /
 *  replicas …). A NEW entry in one of these prefills the canonical scalar keys. */
export const INFRA_CATEGORIES = ['cloud', 'gpu', 'datastore'] as const
export type InfraCategory = (typeof INFRA_CATEGORIES)[number]

export function isInfraCategory(category: string): category is InfraCategory {
  return (INFRA_CATEGORIES as readonly string[]).includes(category)
}

// ── Money: display dollars ↔ stored cents ────────────────────────────────────
// commerce stores the public price in `priceCents` (an integer). The admin edits
// it as dollars; `inputToCents`/`centsToInput` are the exact round-trip, and
// `formatUsd` is the read-only table/summary rendering.

/** Parse a dollars string into integer cents (round to the nearest cent). A blank
 *  or non-numeric string is 0 — never NaN (which would corrupt the stored price). */
export function inputToCents(dollars: string): number {
  const n = Number.parseFloat(dollars)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/** Cents → an editable dollars string (no trailing-zero padding: 500→"5",
 *  6652→"66.52"). Used to seed the price input from a loaded entry. */
export function centsToInput(cents: number): string {
  const c = Number.isFinite(cents) ? cents : 0
  return String(c / 100)
}

/** Cents → a display price ("$66.52"). */
export function formatUsd(cents: number): string {
  const c = Number.isFinite(cents) ? cents : 0
  return `$${(c / 100).toFixed(2)}`
}

/** The per-period suffix for a category's price: gpu tiers are hourly, cloud +
 *  datastore tiers monthly; anything else has no implied period. */
export function priceUnit(category: string): string {
  if (category === 'gpu') return '/hr'
  if (category === 'cloud' || category === 'datastore') return '/mo'
  return ''
}

// ── Metadata: JSON object ↔ typed key/value rows ─────────────────────────────
// The Metadata spec is edited as a key/value list. Each value keeps its REAL
// JSON type across the round-trip: a value is SERIALIZED for display (a string
// shows verbatim, everything else — number/bool/null/array/object — as JSON) and
// PARSED back on save (JSON.parse, falling back to the raw string). So `2` stays
// the number 2, `"shared"` stays a string, `["1 VM"]` stays an array, and a
// nested `{…}` stays an object — nothing is flattened or lossy.

export type MetadataRow = { key: string; value: string }

/** Serialize ONE metadata value for its editable cell: a string shows raw (no
 *  quotes), every other JSON type shows as compact JSON. */
export function serializeValue(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** Parse ONE edited cell back to a JSON value: try JSON (so `2`→number,
 *  `true`→bool, `null`→null, `[…]`/`{…}`→array/object), else keep the raw string
 *  (so `shared`, `1TB`, `unlimited` stay strings). A blank cell is the empty string. */
export function parseValue(text: string): unknown {
  const t = text.trim()
  if (t === '') return ''
  try {
    return JSON.parse(t)
  } catch {
    return text
  }
}

/** A metadata object → ordered editable rows (insertion order preserved). */
export function metadataToRows(metadata: Record<string, unknown> | undefined | null): MetadataRow[] {
  if (!metadata || typeof metadata !== 'object') return []
  return Object.entries(metadata).map(([key, value]) => ({ key, value: serializeValue(value) }))
}

/** Editable rows → a metadata object. Rows with a blank key are dropped; a later
 *  duplicate key wins (last-write). Values are parsed back to their JSON type. */
export function rowsToMetadata(rows: MetadataRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const { key, value } of rows) {
    const k = key.trim()
    if (k === '') continue
    out[k] = parseValue(value)
  }
  return out
}

/** The canonical scalar spec keys for a NEW infra tier, so creating one starts
 *  from the right shape (a light "typed sub-form" seed) rather than a blank JSON
 *  blob. Non-infra categories start empty. */
export function metadataTemplate(category: string): MetadataRow[] {
  switch (category) {
    case 'cloud':
      return rowsOf([
        ['id', ''],
        ['vcpus', '1'],
        ['memoryGB', '1'],
        ['diskGB', '20'],
        ['cpuType', 'shared'],
        ['maxVMs', '1'],
        ['priceMonthly', '5'],
        ['features', '[]'],
      ])
    case 'gpu':
      return rowsOf([
        ['gpu', '1x H100'],
        ['vram', '80 GB'],
        ['price', '3.48'],
      ])
    case 'datastore':
      return rowsOf([
        ['id', ''],
        ['replicas', '1'],
        ['ramGiB', '8'],
        ['vcpu', '2'],
        ['storageGB', '1000'],
        ['priceMonthly', '0'],
        ['priceHourly', '0'],
      ])
    default:
      return []
  }
}

function rowsOf(pairs: [string, string][]): MetadataRow[] {
  return pairs.map(([key, value]) => ({ key, value }))
}

/** A compact, read-only spec summary for an infra tier's table cell (the headline
 *  scalars only). Returns [] for a non-infra category or absent metadata. */
export function specSummary(category: string, metadata: Record<string, unknown> | undefined): string[] {
  if (!metadata || !isInfraCategory(category)) return []
  const m = metadata
  const parts: string[] = []
  const push = (label: string, key: string, suffix = '') => {
    const v = m[key]
    if (v !== undefined && v !== null && v !== '') parts.push(`${label} ${v}${suffix}`)
  }
  if (category === 'cloud') {
    push('', 'vcpus', ' vCPU')
    push('', 'memoryGB', ' GB')
    push('', 'diskGB', ' GB SSD')
  } else if (category === 'gpu') {
    if (typeof m.gpu === 'string') parts.push(m.gpu)
    if (typeof m.vram === 'string') parts.push(m.vram)
  } else if (category === 'datastore') {
    push('', 'replicas', '× replica')
    push('', 'ramGiB', ' GiB')
    push('', 'vcpu', ' vCPU')
  }
  return parts.map((p) => p.trim())
}

/** The distinct categories present in a set of entries, sorted, with the infra
 *  categories floated to the front (they are the increment-1 focus). Drives the
 *  category filter chips. */
export function distinctCategories(entries: { category: string }[]): string[] {
  const set = new Set<string>()
  for (const e of entries) if (e.category) set.add(e.category)
  const all = [...set]
  const infra = INFRA_CATEGORIES.filter((c) => set.has(c))
  const rest = all.filter((c) => !isInfraCategory(c)).sort()
  return [...infra, ...rest]
}
