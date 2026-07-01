// Pure catalog taxonomy + per-brand scope. NO React / component imports — the
// heavy `registry.tsx` re-exports these, but this module stays dependency-free
// (the `BrandId` import is type-only, erased at compile) so the brand scope is
// unit-testable in isolation (registry-brand.test.ts).
//
// The ONE knob that makes each brand's console show the right surfaces: `hanzo`
// is the full AI cloud; the sovereign-chain brands (`lux`, `zoo`, `pars`) are
// **web3 / bootnode admin** consoles — Web3 (on-chain), Network (nodes/peering),
// Security (keys/HSM/authz), Dev (keys/CLI), Settings (org) — NOT the AI-cloud
// surfaces. `null` = every category.
import type { BrandId } from '~/config'

export type ProductCategory =
  | 'AI'
  | 'Compute'
  | 'Training'
  | 'Data'
  | 'Network'
  | 'Security'
  | 'Observe'
  | 'Platform'
  | 'Dev'
  | 'Web3'
  | 'Apps'
  | 'Settings'

export const categoryOrder: ProductCategory[] = [
  'AI',
  'Compute',
  'Training',
  'Data',
  'Network',
  'Security',
  'Observe',
  'Platform',
  'Dev',
  'Web3',
  'Apps',
  'Settings',
]

export const BRAND_CATEGORIES: Record<BrandId, ProductCategory[] | null> = {
  hanzo: null,
  lux: ['Web3', 'Network', 'Security', 'Dev', 'Settings'],
  zoo: ['Web3', 'Network', 'Security', 'Dev', 'Settings'],
  pars: ['Web3', 'Network', 'Security', 'Dev', 'Settings'],
}

/** Categories a given brand's console surfaces, in display order (all for hanzo). */
export const categoriesForBrand = (brand: BrandId): ProductCategory[] => {
  const allowed = BRAND_CATEGORIES[brand]
  return allowed === null ? categoryOrder : categoryOrder.filter((c) => allowed.includes(c))
}

/** True when a category belongs to a given brand's console. */
export const categoryInBrand = (brand: BrandId, category: ProductCategory): boolean => {
  const allowed = BRAND_CATEGORIES[brand]
  return allowed === null || allowed.includes(category)
}
