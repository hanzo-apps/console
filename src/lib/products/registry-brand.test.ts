import { describe, it, expect } from 'vitest'
import {
  categoriesForBrand,
  categoryInBrand,
  entryInBrandScope,
  BRAND_CATEGORIES,
  categoryOrder,
  categorySlug,
  categoryFromSlug,
  CATEGORY_SUMMARY,
  ALL_NODE_NETWORKS,
  BRAND_NODE_NETWORKS,
  nodeNetworksForBrand,
  type ProductCategory,
  type NodeNetworkId,
} from './brand-scope'
import type { BrandId } from '~/config'

// Proves the per-brand catalog scope: hanzo = full AI cloud; the sovereign-chain
// brands (lux/zoo/pars) = web3/bootnode admin only. brand-scope is pure (brand
// passed in) + dependency-free, so this proves the filter without hostname
// mocking and without loading the (React-heavy) registry.

const WEB3: ProductCategory[] = ['Web3', 'Network', 'Security', 'Dev', 'Settings']
const AI_ONLY: ProductCategory[] = ['AI', 'Compute', 'Data', 'Observe', 'Apps', 'Platform']

describe('per-brand catalog scope', () => {
  it('hanzo sees every category (full AI cloud)', () => {
    expect(BRAND_CATEGORIES.hanzo).toBeNull()
    expect(categoriesForBrand('hanzo')).toEqual(categoryOrder)
    for (const c of categoryOrder) expect(categoryInBrand('hanzo', c)).toBe(true)
  })

  for (const brand of ['lux', 'zoo', 'pars'] as BrandId[]) {
    describe(`${brand} = web3/bootnode admin`, () => {
      it('shows ONLY the web3 categories, in display order', () => {
        const cats = categoriesForBrand(brand)
        // exactly the web3 set, ordered by the canonical categoryOrder
        expect(cats).toEqual(categoryOrder.filter((c) => WEB3.includes(c)))
        expect(new Set(cats)).toEqual(new Set(WEB3))
      })

      it('HIDES every AI-cloud category', () => {
        for (const c of AI_ONLY) expect(categoryInBrand(brand, c)).toBe(false)
      })

      it('admits the web3 categories (Web3/Network/Security/Dev/Settings)', () => {
        for (const c of WEB3) expect(categoryInBrand(brand, c)).toBe(true)
      })
    })
  }

  for (const brand of ['7stars', 'yotoda'] as BrandId[]) {
    describe(`${brand} = general Hanzo-cloud tenant (full catalog)`, () => {
      it('sees every category (null scope, like hanzo)', () => {
        expect(BRAND_CATEGORIES[brand]).toBeNull()
        expect(categoriesForBrand(brand)).toEqual(categoryOrder)
        for (const c of categoryOrder) expect(categoryInBrand(brand, c)).toBe(true)
      })

      it('surfaces the AI-cloud categories a sovereign brand hides', () => {
        for (const c of AI_ONLY) expect(categoryInBrand(brand, c)).toBe(true)
      })

      it('owns NO chain → the Nodes surface reports on zero networks', () => {
        expect(BRAND_NODE_NETWORKS[brand]).toEqual([])
        expect(nodeNetworksForBrand(brand)).toEqual([])
      })
    })
  }

  it('Bootnode Networks lives in Web3 → shows on lux/zoo, hidden nowhere web3', () => {
    // Networks is a Web3 entry (registry), so proving Web3 ∈ lux/zoo scope proves
    // the bootnode Networks module surfaces on the web3 consoles.
    for (const brand of ['lux', 'zoo', 'pars'] as BrandId[]) {
      expect(categoryInBrand(brand, 'Web3')).toBe(true)
    }
    expect(categoryInBrand('hanzo', 'Web3')).toBe(true)
  })

  it('every brand map key is a known brand; web3 sets reference real categories', () => {
    for (const brand of Object.keys(BRAND_CATEGORIES) as BrandId[]) {
      const cats = BRAND_CATEGORIES[brand]
      if (cats === null) continue
      for (const c of cats) expect(categoryOrder).toContain(c)
    }
  })
})

// Proves the per-ENTRY brand scope — the orthogonal companion to the per-category
// scope. A brand-agnostic entry (no `brands`) shows everywhere its category admits;
// a brand-specific entry (e.g. a Lux/Zoo chain-app launch tile) shows ONLY for its
// brands. Pure predicate, so this proves the no-cross-leak rule without a hostname.
describe('per-entry brand scope', () => {
  const ALL: BrandId[] = ['hanzo', 'lux', 'zoo', 'pars']

  it('an OMITTED brands list shows on EVERY brand (default = agnostic)', () => {
    for (const brand of ALL) expect(entryInBrandScope(brand, undefined)).toBe(true)
  })

  it('an EMPTY brands list is the empty inclusion set — hidden everywhere (fail-closed)', () => {
    for (const brand of ALL) expect(entryInBrandScope(brand, [])).toBe(false)
  })

  it('a Lux chain-app tile shows ONLY on lux, hidden on every other brand', () => {
    expect(entryInBrandScope('lux', ['lux'])).toBe(true)
    for (const brand of ['hanzo', 'zoo', 'pars'] as BrandId[]) {
      expect(entryInBrandScope(brand, ['lux'])).toBe(false)
    }
  })

  it('a Zoo chain-app tile shows ONLY on zoo — no Lux↔Zoo cross-leak', () => {
    expect(entryInBrandScope('zoo', ['zoo'])).toBe(true)
    for (const brand of ['hanzo', 'lux', 'pars'] as BrandId[]) {
      expect(entryInBrandScope(brand, ['zoo'])).toBe(false)
    }
    // the two suites never appear on each other's console
    expect(entryInBrandScope('zoo', ['lux'])).toBe(false)
    expect(entryInBrandScope('lux', ['zoo'])).toBe(false)
  })

  it('multi-brand scope admits each listed brand and only those', () => {
    expect(entryInBrandScope('hanzo', ['hanzo', 'lux'])).toBe(true)
    expect(entryInBrandScope('lux', ['hanzo', 'lux'])).toBe(true)
    expect(entryInBrandScope('zoo', ['hanzo', 'lux'])).toBe(false)
  })
})

// Category landing pages — the `/category/<slug>` surface. The slug<->category
// mapping is pure, so this proves it (and the one-line copy) without loading the
// React-heavy registry or mocking a hostname.
describe('category landing pages', () => {
  it('slugs are lowercase, stable, and round-trip through categoryFromSlug', () => {
    for (const c of categoryOrder) {
      const slug = categorySlug(c)
      expect(slug).toBe(c.toLowerCase())
      expect(categoryFromSlug(slug)).toBe(c)
    }
    // known shapes
    expect(categorySlug('AI')).toBe('ai')
    expect(categorySlug('Web3')).toBe('web3')
  })

  it('every category maps to a UNIQUE slug (no collisions)', () => {
    const slugs = categoryOrder.map(categorySlug)
    expect(new Set(slugs).size).toBe(categoryOrder.length)
  })

  it('categoryFromSlug is case-insensitive and null for unknown slugs', () => {
    expect(categoryFromSlug('AI')).toBe('AI')
    expect(categoryFromSlug('ai')).toBe('AI')
    expect(categoryFromSlug('nope')).toBeNull()
    expect(categoryFromSlug('')).toBeNull()
  })

  it('has an honest one-line summary for EVERY category', () => {
    for (const c of categoryOrder) {
      expect(typeof CATEGORY_SUMMARY[c]).toBe('string')
      expect(CATEGORY_SUMMARY[c].length).toBeGreaterThan(20)
    }
    // no stray keys beyond the taxonomy
    expect(Object.keys(CATEGORY_SUMMARY).sort()).toEqual([...categoryOrder].sort())
  })
})

// Proves the per-brand DATA scope for the Nodes surface: hanzo = every configured
// network (all-networks super-admin/infra view); each sovereign brand = ONLY its
// own chain's networks. Pure (brand passed in), so no hostname mocking needed.
describe('per-brand Nodes network scope', () => {
  it('hanzo sees EVERY configured network, in order (all-networks admin view)', () => {
    expect(BRAND_NODE_NETWORKS.hanzo).toBe('all')
    expect(nodeNetworksForBrand('hanzo')).toEqual(ALL_NODE_NETWORKS)
  })

  it('lux sees only the three Lux networks', () => {
    expect(nodeNetworksForBrand('lux')).toEqual(['lux-mainnet', 'lux-testnet', 'lux-devnet'])
  })

  it('zoo sees only Zoo, pars sees only Pars — no cross-brand leak', () => {
    expect(nodeNetworksForBrand('zoo')).toEqual(['zoo-mainnet'])
    expect(nodeNetworksForBrand('pars')).toEqual(['pars-mainnet'])
    // a sovereign brand NEVER sees another chain's networks
    for (const brand of ['lux', 'zoo', 'pars'] as BrandId[]) {
      const seen = nodeNetworksForBrand(brand)
      const otherChains = seen.filter((n) => !n.startsWith(brand === 'lux' ? 'lux' : brand))
      expect(otherChains).toEqual([])
    }
  })

  it('returns networks in the canonical ALL_NODE_NETWORKS order', () => {
    for (const brand of Object.keys(BRAND_NODE_NETWORKS) as BrandId[]) {
      const seen = nodeNetworksForBrand(brand)
      const ordered = ALL_NODE_NETWORKS.filter((n) => seen.includes(n))
      expect(seen).toEqual(ordered)
    }
  })

  it('every brand-scoped network id is a real configured network', () => {
    for (const brand of Object.keys(BRAND_NODE_NETWORKS) as BrandId[]) {
      const cfg = BRAND_NODE_NETWORKS[brand]
      if (cfg === 'all') continue
      for (const n of cfg as NodeNetworkId[]) expect(ALL_NODE_NETWORKS).toContain(n)
    }
  })
})
