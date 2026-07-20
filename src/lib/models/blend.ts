/**
 * Enso blend — the per-org enabled-model set and the tiers that form over it.
 *
 * This is a faithful port of the REFERENCE SEMANTICS in hanzoai/enso-bench
 * `harness/arms.py` (`resolve_blend`, `blended`, `TIER_BANDS`, `tier_members`). The
 * console must not invent different rules: an org's blend as configured here is the
 * blend its router runs, so the two implementations have to agree on what "enabled"
 * means. Where the Python and this file could drift, this file follows the Python.
 *
 * THE THREE OPERATORS, applied in this ORDER (arms.py `resolve_blend`):
 *   1. `enable` — an ALLOWLIST. `null`/undefined means "the whole catalog"; an EMPTY
 *      list means the empty blend. These are different, and the distinction is
 *      load-bearing: an org that has never touched its blend inherits everything,
 *      whereas an org that turned everything off gets nothing.
 *   2. `disable` — a DENYLIST applied AFTER the allowlist, so disable wins over
 *      enable for a model named in both.
 *   3. `add` — bring-your-own models, appended AFTER both filters, so an added model
 *      is never removed by the org's own denylist.
 *
 * TIERS ARE NOT ROSTERS. flash/blend/ultra are PRICE BANDS over whatever the blend
 * ends up being — change the blend and the tiers re-form. A model belongs to every
 * band its blended price falls in, so bands may overlap (blend and ultra share
 * 5.0–9.0). The band edges below are arms.py's TIER_BANDS verbatim.
 */

/** A model as the blend reasons about it: an id, a vendor, and its two prices. */
export type BlendModel = {
  /** The gateway model id — the identity everything joins on. */
  id: string
  /** Display name; falls back to the id at the render layer. */
  name?: string
  vendor?: string
  /** $/MTok input, or null when the catalog does not price it. */
  priceIn: number | null
  /** $/MTok output, or null when the catalog does not price it. */
  priceOut: number | null
}

/** An org's blend override — the three operators, exactly as arms.py names them. */
export type BlendSpec = {
  /** Allowlist of model ids. `null` = inherit the whole catalog (NOT the same as []). */
  enable: string[] | null
  /** Denylist of model ids, applied after `enable`. */
  disable: string[]
  /** Models the org brings itself, appended after both filters. */
  add: BlendModel[]
}

/** The empty override: inherit everything, deny nothing, add nothing. */
export const INHERIT_ALL: BlendSpec = { enable: null, disable: [], add: [] }

/**
 * Blended $/MTok = 0.2·in + 0.8·out (arms.py `blended_price`). Reasoning traffic is
 * output-dominant, so a single comparable price weights output 4:1. Null when either
 * side is unpriced — an unpriced model gets no synthetic price.
 */
export function blendedPrice(m: BlendModel): number | null {
  if (typeof m.priceIn !== 'number' || typeof m.priceOut !== 'number') return null
  return 0.2 * m.priceIn + 0.8 * m.priceOut
}

/**
 * Apply an org's override to the catalog, returning the models its router routes over.
 * Order is enable → disable → add, per `resolve_blend`. An added model that shares an
 * id with a catalog model REPLACES it (the org's own pricing/route wins), matching the
 * Python, where the later row overwrites the earlier one in the `arms`/`prices` dicts.
 */
export function resolveBlend(catalog: BlendModel[], spec: BlendSpec = INHERIT_ALL): BlendModel[] {
  let rows = catalog
  if (spec.enable !== null) {
    const keep = new Set(spec.enable)
    rows = rows.filter((m) => keep.has(m.id))
  }
  if (spec.disable.length) {
    const drop = new Set(spec.disable)
    rows = rows.filter((m) => !drop.has(m.id))
  }
  if (!spec.add.length) return rows
  const byId = new Map(rows.map((m) => [m.id, m]))
  for (const m of spec.add) byId.set(m.id, m)
  return Array.from(byId.values())
}

/** Is this model in the org's blend? The predicate the enable/disable switch reads. */
export function isEnabled(id: string, spec: BlendSpec): boolean {
  if (spec.add.some((m) => m.id === id)) return true
  if (spec.disable.includes(id)) return false
  return spec.enable === null || spec.enable.includes(id)
}

/**
 * Flip one model on or off, returned as a NEW spec (no mutation).
 *
 * The subtlety is `enable: null`. An org inheriting the whole catalog that disables
 * ONE model must stay inheriting — otherwise turning one model off would silently
 * pin the org to today's catalog and it would never receive a newly-added model.
 * So a toggle-off from inherit records a DENYLIST entry, and only an org already on
 * an allowlist edits that allowlist. Same rule as arms.py, where enable and disable
 * are independent operators rather than two views of one list.
 */
export function toggle(id: string, on: boolean, spec: BlendSpec): BlendSpec {
  const disable = spec.disable.filter((x) => x !== id)
  if (spec.enable === null) {
    return { ...spec, disable: on ? disable : [...disable, id] }
  }
  const enable = spec.enable.filter((x) => x !== id)
  return { ...spec, enable: on ? [...enable, id] : enable, disable }
}

/** Pin the blend to an explicit set of ids — what the blend builder's "Save" writes. */
export function setEnabled(ids: string[], spec: BlendSpec = INHERIT_ALL): BlendSpec {
  return { ...spec, enable: Array.from(new Set(ids)), disable: [] }
}

// ── Tiers: price bands over the resolved blend ───────────────────────────────

export type Tier = 'flash' | 'blend' | 'ultra'

/** arms.py TIER_BANDS — [lo, hi) in blended $/MTok. Bands deliberately overlap. */
export const TIER_BANDS: Record<Tier, [number, number]> = {
  flash: [0.0, 1.5],
  blend: [1.0, 9.0],
  ultra: [5.0, Number.POSITIVE_INFINITY],
}

export const TIERS: Tier[] = ['flash', 'blend', 'ultra']

export const TIER_LABEL: Record<Tier, string> = {
  flash: 'Enso Flash',
  blend: 'Enso Blend',
  ultra: 'Enso Ultra',
}

/**
 * Every model in the blend whose blended price falls in the tier's band, cheapest
 * first (arms.py `tier_members`). Unpriced models are excluded — a band is defined by
 * price, so a model without one cannot be placed in it.
 *
 * Sorted by price ALONE, with no tie-break. That is deliberate and load-bearing for
 * parity: Python's `sorted` is stable, so two models priced identically (opus-4.8 and
 * opus-4.6 both blend to 21.0) keep their CATALOG order there. `Array.prototype.sort`
 * is likewise stable (ES2019), so omitting a tie-break reproduces that exactly —
 * adding an id tie-break would silently reorder them relative to the router.
 *
 * arms.py additionally holds out PREPAID arms (models on real-cash upstreams) so a
 * RANDOM tier draw can never quietly spend money. That guard belongs to the sampler,
 * not to the org's blend: here the org is choosing models explicitly, which is the
 * very "name it to use it" opt-in the Python describes.
 */
export function tierMembers(blend: BlendModel[], tier: Tier): BlendModel[] {
  const [lo, hi] = TIER_BANDS[tier]
  return blend
    .map((m) => ({ m, p: blendedPrice(m) }))
    .filter((x): x is { m: BlendModel; p: number } => x.p !== null && x.p >= lo && x.p < hi)
    .sort((a, b) => a.p - b.p)
    .map((x) => x.m)
}

/** Per-tier member counts — the blend builder's "does this blend actually work?" read. */
export function tierCounts(blend: BlendModel[]): Record<Tier, number> {
  return { flash: tierMembers(blend, 'flash').length, blend: tierMembers(blend, 'blend').length, ultra: tierMembers(blend, 'ultra').length }
}

/**
 * The tiers a blend cannot serve. A tier with no members means the router has nothing
 * to route to at that tier, which is the one way to build a broken blend — so the
 * builder warns on it rather than letting an org save a blend that silently fails.
 */
export function emptyTiers(blend: BlendModel[]): Tier[] {
  const counts = tierCounts(blend)
  return TIERS.filter((t) => counts[t] === 0)
}
