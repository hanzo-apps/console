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
  Observe: 'Usage, spend, traces, metrics, logs, dashboards, and alerts — see and evaluate what your workloads do.',
  Platform: 'Projects, environments, builds, registry, releases, and pipelines — ship and run your applications.',
  Dev: 'API, SDKs, CLI, IDE, desktop, and keys — the developer tools to build against the cloud.',
  Web3: 'Networks, tokens, wallets, oracles, indexer, and settlement — the on-chain surface.',
  Apps: 'Chat, bot, search, marketplace, and studio — end-user AI applications.',
  Settings: 'Team, organization, and profile — administer your account and members.',
}
