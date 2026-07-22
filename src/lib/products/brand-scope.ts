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
  | 'Commerce'
  | 'Billing'
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
  'Commerce',
  'Billing',
  'Settings',
]

export const BRAND_CATEGORIES: Record<BrandId, ProductCategory[] | null> = {
  hanzo: null,
  lux: ['Web3', 'Network', 'Security', 'Dev', 'Settings'],
  zoo: ['Web3', 'Network', 'Security', 'Dev', 'Settings'],
  pars: ['Web3', 'Network', 'Security', 'Dev', 'Settings'],
  // General Hanzo-cloud customers (not sovereign-chain brands) → the FULL AI-cloud
  // catalog, exactly like `hanzo`. `null` = every category.
  '7stars': null,
  yotoda: null,
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

/** URL slug for a category — lowercased and stable (e.g. 'AI' → 'ai', 'Web3' → 'web3'). */
export const categorySlug = (category: ProductCategory): string => category.toLowerCase()

/** The category a URL slug names, or null when it matches none. */
export const categoryFromSlug = (slug: string): ProductCategory | null =>
  categoryOrder.find((c) => categorySlug(c) === slug.toLowerCase()) ?? null

/**
 * One honest line describing each category — the header copy for its landing
 * page. It describes what the category IS (the class of products it groups); the
 * product list on the page is always the live catalog, so nothing here is data.
 */
export const CATEGORY_SUMMARY: Record<ProductCategory, string> = {
  AI: 'Models, providers, inference, agents, embeddings, prompts, and the playground — the hub for everything you build and ship with AI.',
  Compute: 'Kubernetes, containers, functions, GPUs, machines, and tasks — the infrastructure your workloads run on.',
  Training: 'Fine-tuning and ML pipelines — build, tune, and improve your own models.',
  Data: 'Vector, SQL, key-value, object, document, and memory stores — managed data primitives for your apps.',
  Network: 'Gateway, DNS, CDN, load balancing, VPC, and service mesh — connect, route, and expose your services.',
  Security: 'IAM, authorization, KMS, HSM, secrets, MPC, and audit — identity and secrets for your organization.',
  Observe: 'Traces, metrics, logs, dashboards, alerts, evals, and LLM research — observe and evaluate what your models and workloads do.',
  Platform: 'Projects, environments, builds, registry, releases, and pipelines — ship and run your applications.',
  Dev: 'API, SDKs, CLI, IDE, desktop, and keys — the developer tools to build against the cloud.',
  Web3: 'Networks, tokens, wallets, oracles, indexer, and settlement — the on-chain surface.',
  Apps: 'Chat, bot, search, marketplace, and studio — end-user AI applications.',
  Commerce: 'Products, orders, customers, inventory, and promotions — run your store on Hanzo Commerce (payments via Square in Billing).',
  Billing: 'Balance, credits, usage-based spend, invoices, payment methods, revenue, and grants — your account\'s money, metering, and the Square-backed billing console.',
  Settings: 'Team, organization, and profile — administer your account and members.',
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
