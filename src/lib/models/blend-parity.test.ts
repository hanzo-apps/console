/**
 * Cross-implementation parity: this TS port vs the arms.py reference ITSELF.
 *
 * `blend.test.ts` pins the semantics against hand-written expectations. This suite is
 * the stronger check: it EXECUTES hanzoai/enso-bench `harness/arms.py`, reads its real
 * CATALOG and its own `tier_members` output, and asserts the port reproduces it exactly
 * — membership AND order — over the full catalog and over an enable+disable blend.
 *
 * It earned its place: it caught a real divergence. Python's `sorted` is stable, so two
 * models priced identically (opus-4.8 / opus-4.6 both blend to 21.0) keep CATALOG order;
 * an id tie-break in the port silently reordered them relative to the router.
 *
 * SKIPS (never fails) when the enso-bench checkout or python3 is absent — CI runs the
 * console alone, and a missing sibling repo is not a console regression. Point it
 * elsewhere with ENSO_BENCH.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { blendedPrice, resolveBlend, tierMembers, type BlendModel } from './blend'

const BENCH = process.env.ENSO_BENCH ?? `${process.env.HOME}/work/hanzo/enso-bench`

/** The blend the parity cases exercise: an allowlist with one model denied. */
const SPEC = {
  enable: ['gpt-5.6-sol', 'opus-4.8', 'glm-5.2', 'kimi-k2.6', 'deepseek-4-flash', 'mimo-v2.5'],
  disable: ['opus-4.8'],
  add: [],
}

type Reference = {
  catalog: (BlendModel & { prepaid: boolean })[]
  tiers: Record<string, string[]>
  sub: Record<string, string[]>
  blendedGlm: number
}

/** Run arms.py and read back its own catalog + tier output, or null when unavailable. */
function reference(): Reference | null {
  if (!existsSync(`${BENCH}/harness/arms.py`)) return null
  const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(BENCH)})
from harness.arms import CATALOG, PREPAID, tier_members, resolve_blend, blended
spec = json.loads(${JSON.stringify(JSON.stringify(SPEC))})
_, prices = resolve_blend(enable=spec["enable"], disable=spec["disable"])
print(json.dumps({
  "catalog": [{"id": r[0], "priceIn": r[3], "priceOut": r[4], "prepaid": r[0] in PREPAID} for r in CATALOG],
  "tiers": {t: tier_members(t) for t in ("flash", "blend", "ultra")},
  "sub": {t: tier_members(t, prices) for t in ("flash", "blend", "ultra")},
  "blendedGlm": blended("glm-5.2"),
}))
`
  try {
    return JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' })) as Reference
  } catch {
    return null
  }
}

const ref = reference()

describe.skipIf(!ref)('blend port vs the arms.py reference', () => {
  // arms.py holds PREPAID arms (real-cash upstreams) out of a tier DRAW — a sampler
  // guard, not a blend rule (see tierMembers). So parity is over the arms both sides
  // agree the tiers range across.
  const catalog: BlendModel[] = (ref?.catalog ?? [])
    .filter((r) => !r.prepaid)
    .map(({ id, priceIn, priceOut }) => ({ id, priceIn, priceOut }))

  it('reads a real catalog from arms.py', () => {
    expect(catalog.length).toBeGreaterThan(20)
  })

  it('agrees on the blended price formula', () => {
    expect(blendedPrice({ id: 'glm-5.2', priceIn: 1.05, priceOut: 4.4 })).toBeCloseTo(ref!.blendedGlm, 9)
  })

  for (const tier of ['flash', 'blend', 'ultra'] as const) {
    it(`agrees on the full-catalog ${tier} band, in the same order`, () => {
      expect(tierMembers(catalog, tier).map((m) => m.id)).toEqual(ref!.tiers[tier])
    })
  }

  for (const tier of ['flash', 'blend', 'ultra'] as const) {
    it(`agrees on the ${tier} band of an enable+disable blend`, () => {
      const blend = resolveBlend(catalog, SPEC)
      expect(tierMembers(blend, tier).map((m) => m.id)).toEqual(ref!.sub[tier])
    })
  }
})
