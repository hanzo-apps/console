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
import {
  CATEGORY_ORDER,
  CATEGORY_SUMMARY as PRODUCT_SUMMARY,
  BRAND_CATEGORIES as PRODUCT_SCOPE,
  type ProductCategory,
} from '@hanzo/products'
import type { BrandId } from '~/config'

// Which product categories exist is NOT this file's answer. hanzoai/commerce owns
// it, serves it at `api.hanzo.ai/v1/commerce/catalog`, and @hanzo/products
// generates its typed copy from that API — so the list arrives here already
// agreed with the catalog, the marketing site and the docs, and a rename lands
// once rather than in four places. This file had its own copy for a while; the
// copy in @hanzo/products meanwhile lost `Dev` and grew a `Commerce` the catalog
// has never held a product under, and nothing failed, because each copy's tests
// asserted that copy.
export type { ProductCategory }

/**
 * Account administration — members, organization, profile.
 *
 * It sits in the console's nav next to the product sections and it is NOT one:
 * nothing under it is a product, it is not in the catalog, and it has no
 * `/products/settings` page. Keeping it inside `ProductCategory` is what made
 * that union a mixture of two ideas, and the mixture is how `Training`,
 * `Billing` and `Commerce` were once shelved beside real categories.
 *
 * So the two ideas are named separately. `ProductCategory` is the catalog's
 * taxonomy; `NavSection` is what this console draws, which is that taxonomy plus
 * this one administrative section.
 */
export const SETTINGS = 'Settings' as const

/** A section of the console's nav: a product category, or account administration. */
export type NavSection = ProductCategory | typeof SETTINGS

/** Every nav section in display order — the catalog's categories, Settings last. */
export const categoryOrder: NavSection[] = [...CATEGORY_ORDER, SETTINGS]

/** Settings scoped onto a brand's product categories — every console admits it. */
const withSettings = (cats: readonly ProductCategory[]): NavSection[] => [...cats, SETTINGS]

export const BRAND_CATEGORIES: Record<BrandId, NavSection[] | null> = {
  hanzo: null,
  // The sovereign-chain consoles show the catalog's own lux/zoo/pars scope —
  // `GET /v1/commerce/catalog?brand=lux` is the request these consoles make, so
  // its answer is the scope rather than a second list that can disagree with it.
  lux: withSettings(PRODUCT_SCOPE.lux ?? CATEGORY_ORDER),
  zoo: withSettings(PRODUCT_SCOPE.zoo ?? CATEGORY_ORDER),
  pars: withSettings(PRODUCT_SCOPE.pars ?? CATEGORY_ORDER),
  // General Hanzo-cloud customers (not sovereign-chain brands) → the FULL AI-cloud
  // catalog, exactly like `hanzo`. `null` = every category.
  '7stars': null,
  yotoda: null,
}

/** Sections a given brand's console surfaces, in display order (all for hanzo). */
export const categoriesForBrand = (brand: BrandId): NavSection[] => {
  const allowed = BRAND_CATEGORIES[brand]
  return allowed === null ? categoryOrder : categoryOrder.filter((c) => allowed.includes(c))
}

/** True when a section belongs to a given brand's console. */
export const categoryInBrand = (brand: BrandId, category: NavSection): boolean => {
  const allowed = BRAND_CATEGORIES[brand]
  return allowed === null || allowed.includes(category)
}

/**
 * Per-ENTRY brand scope — the orthogonal companion to the per-CATEGORY scope
 * above. Category scope decides which SECTIONS a brand shows; this decides
 * whether one specific entry shows, WITHIN a section its brand already admits.
 * It exists because a single category can hold brand-specific tiles that must
 * NOT cross-leak: the Web3 category holds BOTH the Lux and the Zoo chain-app
 * launch tiles, but lux.cloud must show only Lux and zoo.cloud only Zoo.
 *
 * An entry with no `brands` list is brand-agnostic (shows on every brand its
 * category admits — the default for all in-console products). An entry that
 * DOES declare `brands` shows only for those brands. Pure + dependency-free
 * (BrandId is type-only), like `nodeNetworksForBrand` — a value, not a place —
 * so it's unit-testable without a hostname or the React registry.
 */
export const entryInBrandScope = (brand: BrandId, brands?: readonly BrandId[]): boolean =>
  !brands || brands.includes(brand)

// ── Category landing pages ───────────────────────────────────────────────────
// A category is a GROUPING of products (not a product), so it gets its own
// stable landing route `/category/<slug>` — the slug<->category mapping and the
// one-line copy live here (pure, dependency-free), while the products shown on
// the page are always derived live from the catalog (never fabricated).

/** URL slug for a section — lowercased and stable (e.g. 'AI' → 'ai', 'Web3' → 'web3'). */
export const categorySlug = (category: NavSection): string => category.toLowerCase()

/** The section a URL slug names, or null when it matches none. */
export const categoryFromSlug = (slug: string): NavSection | null =>
  categoryOrder.find((c) => categorySlug(c) === slug.toLowerCase()) ?? null

/**
 * One honest line describing each section — the header copy for its landing page.
 * It describes what the section IS (the class of products it groups); the product
 * list on the page is always the live catalog, so nothing here is data.
 *
 * The product categories' lines come from @hanzo/products, which is where the
 * marketing site and the docs read the same copy from — a category described one
 * way in the console and another on the site is the same drift in prose. Only
 * Settings is written here, because only Settings is this console's own.
 */
export const CATEGORY_SUMMARY: Record<NavSection, string> = {
  ...PRODUCT_SUMMARY,
  [SETTINGS]: 'Members, organization, and profile — administer your account.',
}

// ── Nodes surface — which chain networks each brand reports on ────────────────
// The Nodes module (Network category) surfaces per-node blockchain infrastructure
// — validators (P-chain) + peers (info API) — of the REAL luxd primary networks.
// Category visibility already admits it on every brand (`hanzo` = all, and the
// sovereign brands include `Network`); this is the orthogonal DATA scope: which
// networks' nodes a given brand may SEE. It is the ONE knob for the per-brand
// node inventory — a value, not a place — so it stays here (pure, dependency-free,
// unit-testable) alongside the category scope.

/**
 * A configured chain network the Nodes surface can report on. Each maps to a
 * luxd endpoint (the host lives server-side in the `/nodes` proxy — this is just
 * the identity). The Hanzo L2 runs as a subnet ON the Lux primary networks, so
 * "all networks' nodes" for the hanzo super-admin view IS this whole set.
 */
export type NodeNetworkId =
  | 'lux-mainnet'
  | 'lux-testnet'
  | 'lux-devnet'
  | 'pars-mainnet'
  | 'zoo-mainnet'

/** Every configured node network, in display order. */
export const ALL_NODE_NETWORKS: NodeNetworkId[] = [
  'lux-mainnet',
  'lux-testnet',
  'lux-devnet',
  'pars-mainnet',
  'zoo-mainnet',
]

/**
 * Which chain networks each brand's Nodes surface reports on. `hanzo` is the
 * all-networks super-admin / infra view (every configured network — since every
 * L2 runs as a subnet on these primary node fleets). Each sovereign brand sees
 * ONLY its own chain's networks. Re-scope a brand by editing one row.
 */
export const BRAND_NODE_NETWORKS: Record<BrandId, NodeNetworkId[] | 'all'> = {
  hanzo: 'all',
  lux: ['lux-mainnet', 'lux-testnet', 'lux-devnet'],
  zoo: ['zoo-mainnet'],
  pars: ['pars-mainnet'],
  // General cloud tenants own NO chain — the Nodes surface reports on no networks
  // for them (they'd otherwise see other brands' chains). Empty, not 'all'.
  '7stars': [],
  yotoda: [],
}

/** The node networks a given brand may see, in display order (all for hanzo). */
export const nodeNetworksForBrand = (brand: BrandId): NodeNetworkId[] => {
  const allowed = BRAND_NODE_NETWORKS[brand]
  return allowed === 'all' ? ALL_NODE_NETWORKS : ALL_NODE_NETWORKS.filter((n) => allowed.includes(n))
}
