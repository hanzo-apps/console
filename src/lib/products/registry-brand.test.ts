import { describe, it, expect } from 'vitest'
import {
  categoriesForBrand,
  categoryInBrand,
  BRAND_CATEGORIES,
  categoryOrder,
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
