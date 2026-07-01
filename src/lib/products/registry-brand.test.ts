import { describe, it, expect } from 'vitest'
import {
  categoriesForBrand,
  categoryInBrand,
  BRAND_CATEGORIES,
  categoryOrder,
  categorySlug,
  categoryFromSlug,
  CATEGORY_SUMMARY,
  type ProductCategory,
} from './brand-scope'
import type { BrandId } from '~/config'

// Proves the per-brand catalog scope: hanzo = full AI cloud; the sovereign-chain
// brands (lux/zoo/pars) = web3/bootnode admin only. brand-scope is pure (brand
// passed in) + dependency-free, so this proves the filter without hostname
// mocking and without loading the (React-heavy) registry.

const WEB3: ProductCategory[] = ['Web3', 'Network', 'Security', 'Dev', 'Settings']
const AI_ONLY: ProductCategory[] = ['AI', 'Compute', 'Training', 'Data', 'Observe', 'Apps', 'Platform']

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
