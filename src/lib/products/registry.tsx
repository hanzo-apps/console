/**
 * Product catalog — the single source of truth for the unified console.
 *
 * ONE list (`catalog`) describes every Hanzo product, whether it is an
 * in-console admin module (owns routes, rendered here) or an external surface
 * (owned by another service, opened in a tab). The nav shell, the catalog
 * overview, the favorites system, and the router all render from this list, so
 * surfacing a product = adding ONE `CatalogEntry` — no shell/route/page edits.
 *
 * Orthogonal: an entry owns its identity + how it opens and knows nothing about
 * siblings. The catalog only composes them. `productModules` (the in-console
 * subset) is derived, so the router/match layer is unchanged.
 */
import type { ComponentType } from 'react'
import {
  Server,
  Route as RouteIcon,
  Boxes,
  Database,
  MessageSquare,
  CreditCard,
  Search,
  Bot,
  BarChart3,
  Workflow,
  FileSignature,
  Shield,
  Key,
  Cloud,
} from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { ProvidersModule } from '~/components/products/ProvidersModule'
import { ModelsModule } from '~/components/products/ModelsModule'
import { ApplicationsModule } from '~/components/products/ApplicationsModule'
import { StoresModule } from '~/components/products/StoresModule'
import { ChatModule } from '~/components/products/ChatModule'

/** A Hanzo GUI icon component (e.g. `Server` from `@hanzogui/lucide-icons-2`). */
export type ProductIcon = typeof Server

/** One screen inside an in-console product module. */
export type ProductRoute = {
  /** Path segment under the product, '' for the index. */
  path: string
  /** Rendered surface. Receives the matched route params. */
  component: ComponentType<{ params: Record<string, string> }>
}

/** Category grouping for the nav + catalog. Order here is display order. */
export type ProductCategory =
  | 'AI'
  | 'Data'
  | 'Apps'
  | 'Identity'
  | 'Infrastructure'
  | 'Commerce'

export const categoryOrder: ProductCategory[] = [
  'AI',
  'Data',
  'Apps',
  'Identity',
  'Infrastructure',
  'Commerce',
]

/**
 * Enablement state. `enabled` products open straight into their surface;
 * `available` products are offered with a "Get started" onboarding affordance.
 */
export type ProductStatus = 'enabled' | 'available'

type CatalogBase = {
  /** Stable id and base path segment, e.g. 'providers'. */
  id: string
  /** Display label. */
  label: string
  /** Display icon. */
  icon: ProductIcon
  /** One-line description for the catalog + nav. */
  description: string
  /** Category grouping. */
  category: ProductCategory
  /** Enablement state — drives Open vs Get started. */
  status: ProductStatus
  /** Admin-gated surface (shown with a lock hint; access enforced server-side). */
  admin?: boolean
}

/**
 * A catalog entry is EITHER an in-console module (owns routes) OR an external
 * surface (owned by another service, opened in a new tab). Discriminated on
 * `kind` so consumers branch exhaustively.
 */
export type CatalogEntry =
  | (CatalogBase & { kind: 'module'; routes: ProductRoute[] })
  | (CatalogBase & { kind: 'external'; href: string })

/** Canonical external product surfaces (public product domains, not secrets). */
const ext = {
  search: 'https://search.hanzo.ai',
  bot: 'https://hanzo.bot',
  analytics: 'https://analytics.hanzo.ai',
  flow: 'https://flow.hanzo.ai',
  sign: 'https://sign.hanzo.ai',
  iam: config.iamUrl,
  kms: 'https://kms.hanzo.ai',
  platform: 'https://platform.hanzo.ai',
  billing: config.billingUrl,
} as const

/**
 * The Hanzo product catalog. In-console modules render here; external surfaces
 * open in a tab. Billing is the ONE money surface for every product
 * (hanzoai/billing over the commerce backend) — never reimplemented here.
 */
export const catalog: CatalogEntry[] = [
  // ── AI ───────────────────────────────────────────────────────────────
  {
    id: 'providers',
    label: 'Providers',
    icon: Server,
    description: 'Model, storage, and embedding providers.',
    category: 'AI',
    status: 'enabled',
    kind: 'module',
    routes: [
      { path: '', component: ProvidersModule },
      { path: ':name', component: ProvidersModule },
    ],
  },
  {
    id: 'models',
    label: 'Models',
    icon: RouteIcon,
    description: 'Model routes and routing policy.',
    category: 'AI',
    status: 'enabled',
    kind: 'module',
    routes: [
      { path: '', component: ModelsModule },
      { path: ':name', component: ModelsModule },
    ],
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: MessageSquare,
    description: 'Chat sessions and history.',
    category: 'AI',
    status: 'enabled',
    kind: 'module',
    routes: [
      { path: '', component: ChatModule },
      { path: ':name', component: ChatModule },
    ],
  },
  {
    id: 'search',
    label: 'Search',
    icon: Search,
    description: 'AI-powered search with generative answers.',
    category: 'AI',
    status: 'available',
    kind: 'external',
    href: ext.search,
  },
  {
    id: 'bot',
    label: 'Bot',
    icon: Bot,
    description: 'Bot framework, skills, and plugins.',
    category: 'AI',
    status: 'available',
    kind: 'external',
    href: ext.bot,
  },

  // ── Data ─────────────────────────────────────────────────────────────
  {
    id: 'stores',
    label: 'Stores',
    icon: Database,
    description: 'Knowledge stores and vector indexes.',
    category: 'Data',
    status: 'enabled',
    kind: 'module',
    routes: [
      { path: '', component: StoresModule },
      { path: ':name', component: StoresModule },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: BarChart3,
    description: 'Product analytics, events, and sessions.',
    category: 'Data',
    status: 'available',
    kind: 'external',
    href: ext.analytics,
  },

  // ── Apps ─────────────────────────────────────────────────────────────
  {
    id: 'applications',
    label: 'Applications',
    icon: Boxes,
    description: 'Deployed applications.',
    category: 'Apps',
    status: 'enabled',
    kind: 'module',
    routes: [
      { path: '', component: ApplicationsModule },
      { path: ':name', component: ApplicationsModule },
    ],
  },
  {
    id: 'flow',
    label: 'Flow',
    icon: Workflow,
    description: 'Visual workflow and automation builder.',
    category: 'Apps',
    status: 'available',
    kind: 'external',
    href: ext.flow,
  },
  {
    id: 'sign',
    label: 'Sign',
    icon: FileSignature,
    description: 'eSignatures and document workflows.',
    category: 'Apps',
    status: 'available',
    kind: 'external',
    href: ext.sign,
  },

  // ── Identity ─────────────────────────────────────────────────────────
  {
    id: 'iam',
    label: 'Identity',
    icon: Shield,
    description: 'Identity, access, OAuth, and SSO.',
    category: 'Identity',
    status: 'available',
    admin: true,
    kind: 'external',
    href: ext.iam,
  },
  {
    id: 'kms',
    label: 'Secrets',
    icon: Key,
    description: 'Secrets management and encryption (KMS).',
    category: 'Identity',
    status: 'available',
    admin: true,
    kind: 'external',
    href: ext.kms,
  },

  // ── Infrastructure ───────────────────────────────────────────────────
  {
    id: 'platform',
    label: 'Platform',
    icon: Cloud,
    description: 'PaaS deployments, domains, and builds.',
    category: 'Infrastructure',
    status: 'available',
    admin: true,
    kind: 'external',
    href: ext.platform,
  },

  // ── Commerce ─────────────────────────────────────────────────────────
  {
    id: 'billing',
    label: 'Billing',
    icon: CreditCard,
    description: 'Balance, usage, and invoices for every product.',
    category: 'Commerce',
    status: 'enabled',
    kind: 'external',
    href: ext.billing,
  },
]

/** In-console module (router/match) shape — derived from the catalog. */
export type ProductModule = {
  id: string
  label: string
  icon: ProductIcon
  description: string
  routes: ProductRoute[]
}

/** The in-console subset, in catalog order. The router/match layer reads this. */
export const productModules: ProductModule[] = catalog
  .filter((e): e is Extract<CatalogEntry, { kind: 'module' }> => e.kind === 'module')
  .map(({ id, label, icon, description, routes }) => ({ id, label, icon, description, routes }))

/** Look up an in-console module by id (base path segment). */
export const findModule = (id: string): ProductModule | undefined =>
  productModules.find((m) => m.id === id)

/** Look up any catalog entry by id. */
export const findEntry = (id: string): CatalogEntry | undefined =>
  catalog.find((e) => e.id === id)

/** The catalog grouped by category, in display order, skipping empty groups. */
export const catalogByCategory = (): { category: ProductCategory; entries: CatalogEntry[] }[] =>
  categoryOrder
    .map((category) => ({ category, entries: catalog.filter((e) => e.category === category) }))
    .filter((g) => g.entries.length > 0)
