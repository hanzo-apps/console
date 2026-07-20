/**
 * Blend semantics — pinned against the reference implementation in hanzoai/enso-bench
 * `harness/arms.py` (`resolve_blend`, `blended_price`, `TIER_BANDS`, `tier_members`).
 * These tests exist so the console can never drift from the router's own meaning of
 * "enabled": if arms.py changes, one of these must fail.
 */
import { describe, expect, it } from 'vitest'

import {
  blendedPrice,
  emptyTiers,
  INHERIT_ALL,
  isEnabled,
  resolveBlend,
  setEnabled,
  tierCounts,
  tierMembers,
  toggle,
  TIER_BANDS,
  type BlendModel,
} from './blend'

const m = (id: string, priceIn: number | null, priceOut: number | null): BlendModel => ({ id, priceIn, priceOut })

// Prices lifted straight from the arms.py CATALOG rows of the same name.
const CATALOG: BlendModel[] = [
  m('gpt-5.6-sol', 5.0, 30.0), // blended 25.0  → ultra
  m('opus-4.8', 5.0, 25.0), //     blended 21.0  → ultra
  m('glm-5.2', 1.05, 4.4), //      blended 3.73  → blend
  m('kimi-k2.6', 0.76, 3.2), //    blended 2.71  → blend
  m('deepseek-4-flash', 0.11, 0.22), // blended 0.198 → flash
  m('mimo-v2.5', 0.1, 0.28), //    blended 0.244 → flash
  m('unpriced', null, null),
]

describe('blendedPrice', () => {
  it('is 0.2*in + 0.8*out, the output-dominant weighting arms.py uses', () => {
    expect(blendedPrice(m('x', 5.0, 30.0))).toBeCloseTo(25.0, 10)
    expect(blendedPrice(m('x', 1.05, 4.4))).toBeCloseTo(3.73, 10)
  })

  it('is null when either side is unpriced — never a synthetic price', () => {
    expect(blendedPrice(m('x', null, 30.0))).toBeNull()
    expect(blendedPrice(m('x', 5.0, null))).toBeNull()
  })
})

describe('resolveBlend', () => {
  it('inherits the whole catalog when enable is null', () => {
    expect(resolveBlend(CATALOG, INHERIT_ALL)).toHaveLength(CATALOG.length)
  })

  it('distinguishes enable:null (inherit all) from enable:[] (the empty blend)', () => {
    expect(resolveBlend(CATALOG, { enable: null, disable: [], add: [] })).toHaveLength(CATALOG.length)
    expect(resolveBlend(CATALOG, { enable: [], disable: [], add: [] })).toHaveLength(0)
  })

  it('treats enable as an allowlist', () => {
    const out = resolveBlend(CATALOG, { enable: ['glm-5.2', 'opus-4.8'], disable: [], add: [] })
    expect(out.map((x) => x.id).sort()).toEqual(['glm-5.2', 'opus-4.8'])
  })

  it('applies disable AFTER enable, so disable wins over enable', () => {
    const out = resolveBlend(CATALOG, { enable: ['glm-5.2', 'opus-4.8'], disable: ['opus-4.8'], add: [] })
    expect(out.map((x) => x.id)).toEqual(['glm-5.2'])
  })

  it('appends add AFTER both filters, so a denylist cannot remove an added model', () => {
    const mine = m('my-model', 1.0, 2.0)
    const out = resolveBlend(CATALOG, { enable: [], disable: ['my-model'], add: [mine] })
    expect(out.map((x) => x.id)).toEqual(['my-model'])
  })

  it('lets an added model replace a catalog model of the same id (later row wins)', () => {
    const cheaper = m('glm-5.2', 0.5, 1.0)
    const out = resolveBlend(CATALOG, { enable: ['glm-5.2'], disable: [], add: [cheaper] })
    expect(out).toHaveLength(1)
    expect(blendedPrice(out[0]!)).toBeCloseTo(0.9, 10)
  })
})

describe('isEnabled / toggle', () => {
  it('reads everything as enabled under inherit', () => {
    expect(isEnabled('glm-5.2', INHERIT_ALL)).toBe(true)
  })

  it('records a denylist entry when toggling off from inherit, so inherit is preserved', () => {
    const next = toggle('glm-5.2', false, INHERIT_ALL)
    expect(next.enable).toBeNull() // still inheriting — a future catalog model still arrives
    expect(next.disable).toEqual(['glm-5.2'])
    expect(isEnabled('glm-5.2', next)).toBe(false)
    expect(isEnabled('opus-4.8', next)).toBe(true)
  })

  it('edits the allowlist when the org is already pinned to one', () => {
    const pinned = setEnabled(['glm-5.2', 'opus-4.8'])
    const off = toggle('opus-4.8', false, pinned)
    expect(off.enable).toEqual(['glm-5.2'])
    expect(isEnabled('opus-4.8', off)).toBe(false)
    expect(isEnabled('glm-5.2', toggle('glm-5.2', true, off))).toBe(true)
  })

  it('clears a denylist entry when a model is turned back on', () => {
    const off = toggle('glm-5.2', false, INHERIT_ALL)
    expect(toggle('glm-5.2', true, off).disable).toEqual([])
  })

  it('reports an added model as enabled regardless of the filters', () => {
    const spec = { enable: [], disable: ['mine'], add: [m('mine', 1, 2)] }
    expect(isEnabled('mine', spec)).toBe(true)
  })
})

describe('tiers as price bands', () => {
  it('uses the arms.py band edges verbatim', () => {
    expect(TIER_BANDS.flash).toEqual([0.0, 1.5])
    expect(TIER_BANDS.blend).toEqual([1.0, 9.0])
    expect(TIER_BANDS.ultra[0]).toBe(5.0)
  })

  it('places each model in every band its blended price falls in, cheapest first', () => {
    expect(tierMembers(CATALOG, 'flash').map((x) => x.id)).toEqual(['deepseek-4-flash', 'mimo-v2.5'])
    expect(tierMembers(CATALOG, 'blend').map((x) => x.id)).toEqual(['kimi-k2.6', 'glm-5.2'])
    expect(tierMembers(CATALOG, 'ultra').map((x) => x.id)).toEqual(['opus-4.8', 'gpt-5.6-sol'])
  })

  it('lets bands overlap — 5.0-9.0 is both blend and ultra', () => {
    const overlap = [m('mid', 1.0, 8.0)] // blended 6.6
    expect(tierMembers(overlap, 'blend').map((x) => x.id)).toEqual(['mid'])
    expect(tierMembers(overlap, 'ultra').map((x) => x.id)).toEqual(['mid'])
  })

  it('excludes unpriced models from every band', () => {
    const counts = tierCounts(CATALOG)
    expect(counts.flash + counts.blend + counts.ultra).toBe(6)
    expect(tierMembers(CATALOG, 'flash').some((x) => x.id === 'unpriced')).toBe(false)
  })

  it('re-forms the tiers when the blend changes — tiers are bands, not rosters', () => {
    const cheapOnly = resolveBlend(CATALOG, { enable: ['deepseek-4-flash', 'mimo-v2.5'], disable: [], add: [] })
    expect(tierCounts(cheapOnly)).toEqual({ flash: 2, blend: 0, ultra: 0 })
    expect(emptyTiers(cheapOnly)).toEqual(['blend', 'ultra'])
  })

  it('reports no empty tiers for a blend that spans all three bands', () => {
    expect(emptyTiers(CATALOG)).toEqual([])
  })
})
