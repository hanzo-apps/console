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
  HardDrive,
  FileText,
  Layers,
  Network,
  Tag,
  Users,
  Wallet,
  ScrollText,
} from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { ProvidersModule } from '~/components/products/ProvidersModule'
import { ModelsModule } from '~/components/products/ModelsModule'
import { ApplicationsModule } from '~/components/products/ApplicationsModule'
import { StoresModule } from '~/components/products/StoresModule'
import { ChatModule } from '~/components/products/ChatModule'
import { BotModule } from '~/components/products/BotModule'
import { PlansModule } from '~/components/products/PlansModule'
import { WalletModule } from '~/components/products/WalletModule'
import { IamModule, AuditModule } from '~/components/products/AdminModule'
import { KmsModule } from '~/components/products/KmsModule'
import { ClustersModule } from '~/components/products/ClustersModule'
import { KubernetesModule } from '~/components/products/KubernetesModule'
import { resourceRoutes } from '~/components/products/ResourceModule'
import { comingSoon } from '~/components/products/ComingSoonModule'

/** A Hanzo GUI icon component (e.g. `Server` from `@hanzogui/lucide-icons-2`). */
export type ProductIcon = typeof Server

/** One screen inside an in-console product module. */
export type ProductRoute = {
  /** Path segment under the product, '' for the index. */
  path: string
  /** Rendered surface. Receives the matched route params. */
  component: ComponentType<{ params: Record<string, string> }>
}

/**
 * Category grouping for the nav + catalog. These are the SAME nine categories,
 * exact labels and order, as the hanzo.ai marketing site product dropdown
 * (lib/constants/navigation-data.ts → productsNav) — one taxonomy across every
 * surface. `catalogByCategory` skips empty groups, so a category with no console
 * module yet (e.g. Developer, Compute, Web3) simply doesn't render.
 */
export type ProductCategory =
  | 'AI & Agents'
  | 'Developer'
  | 'Apps'
  | 'Compute'
  | 'Data'
  | 'Async'
  | 'Platform'
  | 'Observability'
  | 'Web3'

export const categoryOrder: ProductCategory[] = [
  'AI & Agents',
  'Developer',
  'Apps',
  'Compute',
  'Data',
  'Async',
  'Platform',
  'Observability',
  'Web3',
]

/**
 * Enablement state — drives the nav badge + Open vs Get started.
 * `enabled` opens straight into its surface; `available` is offered with a
 * "Get started" onboarding affordance; `soon` = the product exists (its repo
 * ships) but its console module isn't wired here yet; `waitlist` = gauging
 * demand before building it.
 */
export type ProductStatus = 'enabled' | 'available' | 'soon' | 'waitlist'

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
  /** Enablement state — drives the nav badge + Open vs Get started. */
  status: ProductStatus
  /** Source repo for the product, e.g. 'hanzoai/vector'. */
  repo?: string
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
  analytics: 'https://analytics.hanzo.ai',
  flow: 'https://flow.hanzo.ai',
  sign: 'https://sign.hanzo.ai',
  team: 'https://team.hanzo.ai',
  platform: 'https://platform.hanzo.ai',
  billing: config.billingUrl,
} as const

/**
 * The Hanzo product catalog. In-console modules render here; external surfaces
 * open in a tab. Billing is the ONE money surface for every product
 * (hanzoai/billing over the commerce backend) — never reimplemented here.
 */
export const catalog: CatalogEntry[] = [
  // ── AI & Agents ──────────────────────────────────────────────────────
  {
    id: 'providers',
    label: 'Providers',
    icon: Server,
    description: 'Model, storage, and embedding providers.',
    category: 'AI & Agents',
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
    category: 'AI & Agents',
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
    category: 'AI & Agents',
    status: 'enabled',
    kind: 'module',
    routes: [
      { path: '', component: ChatModule },
      { path: ':name', component: ChatModule },
    ],
  },
  {
    // External AI search surface (search.hanzo.ai). Distinct from the managed
    // Search data product below (id 'search'), which provisions search infra.
    id: 'ai-search',
    label: 'AI Search',
    icon: Search,
    description: 'AI-powered search with generative answers.',
    category: 'AI & Agents',
    status: 'available',
    kind: 'external',
    href: ext.search,
  },
  {
    // In-console Bot surface — live status from /v1/bot/health (bot-gateway) plus
    // operator deep-links. The bot backend (hanzoai/bot) is a routed service at
    // /v1/bot/*; its own UI is IAM-gated to its origins, so we link, not iframe.
    id: 'bot',
    label: 'Bot',
    icon: Bot,
    description: 'Bot framework, skills, and plugins.',
    category: 'AI & Agents',
    status: 'enabled',
    repo: 'hanzoai/bot',
    kind: 'module',
    routes: [{ path: '', component: BotModule }],
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
    category: 'Observability',
    status: 'available',
    kind: 'external',
    href: ext.analytics,
  },

  // ── Data & storage — Hanzo Cloud as an OSS Google Cloud. Each is a ZAP-native
  //    Hanzo fork (NOT vanilla OSS), provisioned through the shared `resourceModule`
  //    factory over the provisioning contract (POST/GET/DELETE /v1/<kind>). The
  //    per-product `kind` is the only thing that varies. Base has no single
  //    logical-resource concept yet, so it stays a 'soon' placeholder.
  {
    id: 'vector',
    label: 'Vector',
    icon: Boxes,
    description: 'Managed vector database — embeddings & semantic search.',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/vector',
    kind: 'module',
    routes: resourceRoutes({ kind: 'vector', productLabel: 'Hanzo Vector', connectionHint: 'Point a Vector client at host:port using the connection string.' }),
  },
  {
    id: 'sql',
    label: 'SQL',
    icon: Database,
    description: 'Managed SQL — databases, branches, replicas.',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/sql',
    kind: 'module',
    routes: resourceRoutes({ kind: 'sql', productLabel: 'Hanzo SQL', connectionHint: 'Connect any SQL client with the connection string.' }),
  },
  {
    id: 'datastore',
    label: 'Datastore',
    icon: Server,
    description: 'Managed columnar analytics (OLAP).',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/datastore',
    kind: 'module',
    routes: resourceRoutes({ kind: 'datastore', productLabel: 'Hanzo Datastore', connectionHint: 'Connect over the Datastore HTTP/native protocol using the connection string.' }),
  },
  {
    id: 'kv',
    label: 'KV',
    icon: Key,
    description: 'Managed key-value store — cache & queues.',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/kv',
    kind: 'module',
    routes: resourceRoutes({ kind: 'kv', productLabel: 'Hanzo KV', connectionHint: 'Connect with any KV client using the connection string.' }),
  },
  {
    id: 'search',
    label: 'Search',
    icon: Search,
    description: 'Managed search — full-text & hybrid indexes.',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/search',
    kind: 'module',
    routes: resourceRoutes({ kind: 'search', productLabel: 'Hanzo Search', connectionHint: 'Use the Search host + key from the connection string.' }),
  },
  {
    id: 's3',
    label: 'S3',
    icon: HardDrive,
    description: 'Managed object storage — S3 buckets.',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/s3',
    kind: 'module',
    routes: resourceRoutes({ kind: 's3', productLabel: 'Hanzo S3', connectionHint: 'Use as an S3 endpoint with the access key/secret in the connection string.' }),
  },
  {
    id: 'docdb',
    label: 'DocDB',
    icon: FileText,
    description: 'Managed document database.',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/docdb',
    kind: 'module',
    routes: resourceRoutes({ kind: 'docdb', productLabel: 'Hanzo DocDB', connectionHint: 'Connect with any DocDB driver using the connection string.' }),
  },
  {
    id: 'base',
    label: 'Base',
    icon: Layers,
    description: 'Managed app backend — embedded DB + auth + realtime.',
    category: 'Apps',
    status: 'soon',
    repo: 'hanzoai/base',
    kind: 'module',
    routes: [{ path: '', component: comingSoon({ label: 'Hanzo Base', repo: 'hanzoai/base', status: 'soon', blurb: 'Managed application backend — Hanzo Base. Embedded SQL + auth + realtime + file storage in one deploy, IAM-native.' }) }],
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
    category: 'Async',
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
  {
    // hanzo.team — Slack/Jira/agentic-human playground. Runs standalone
    // (team.hanzo.ai, its own deploy + IAM app hanzo-team); the console launches it.
    id: 'team',
    label: 'Team',
    icon: Users,
    description: 'Team workspace — chat, issues, and agentic playground.',
    category: 'Apps',
    status: 'available',
    repo: 'hanzoai/team',
    kind: 'external',
    href: ext.team,
  },

  // ── Platform — identity, secrets, infra, and billing all live under the
  //    single "Platform" category (mirrors the marketing-site taxonomy, which
  //    has no Identity/Infrastructure/Commerce split).
  {
    // Identity & access admin — Organizations / Users / Roles (RBAC) over Hanzo
    // IAM (/v1/iam/*). In-console module (tabs via the route param), with a
    // deep-link to the full IAM app for OAuth/SSO/app config.
    id: 'iam',
    label: 'Identity',
    icon: Shield,
    description: 'Organizations, users, and roles (RBAC) — Hanzo IAM.',
    category: 'Platform',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/iam',
    kind: 'module',
    routes: [
      { path: '', component: IamModule },
      { path: ':tab', component: IamModule },
    ],
  },
  {
    // Secrets (KMS) — zero-knowledge, so the console states the model + probes
    // the real /v1/kms surface and deep-links out; it never lists secret values.
    id: 'kms',
    label: 'Secrets',
    icon: Key,
    description: 'Secrets and encryption — Hanzo KMS.',
    category: 'Platform',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/kms',
    kind: 'module',
    routes: [{ path: '', component: KmsModule }],
  },
  {
    // Audit — identity & access event log (/v1/iam/get-records).
    id: 'audit',
    label: 'Audit',
    icon: ScrollText,
    description: 'Audit log of identity and access events.',
    category: 'Platform',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/iam',
    kind: 'module',
    routes: [{ path: '', component: AuditModule }],
  },

  // Platform — clusters & PaaS
  {
    id: 'platform',
    label: 'Platform',
    icon: Cloud,
    description: 'PaaS deployments, domains, and builds.',
    category: 'Platform',
    status: 'available',
    admin: true,
    kind: 'external',
    href: ext.platform,
  },
  {
    // Clusters — the one new control-plane surface: pick *where* workloads run —
    // shared Hanzo Cloud (zero-ops, multi-tenant) or your own / Hanzo-provisioned
    // DOKS cluster, reconciled by the same operator. One control plane, many targets.
    id: 'clusters',
    label: 'Clusters',
    icon: Network,
    description: 'Your Kubernetes — shared Hanzo Cloud or your own DOKS.',
    category: 'Platform',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/operator',
    kind: 'module',
    routes: [{ path: '', component: ClustersModule }],
  },
  {
    // Kubernetes — browse workloads + operator custom resources for a cluster,
    // via the PaaS control plane (/paas → platform). Honest states if the
    // platform k8s endpoints aren't live yet.
    id: 'kubernetes',
    label: 'Kubernetes',
    icon: Boxes,
    description: 'Workloads and operator custom resources, per cluster.',
    category: 'Platform',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/operator',
    kind: 'module',
    routes: [
      { path: '', component: KubernetesModule },
      { path: ':tab', component: KubernetesModule },
    ],
  },

  // Platform — billing, wallet & plans (the money surfaces)
  {
    // Discovery: compare what every tier offers and costs (live /v1/pricing).
    // Paying happens in Billing (the one money surface) — this never charges.
    id: 'plans',
    label: 'Plans & Pricing',
    icon: Tag,
    description: 'Compare plans and pricing for every cloud service.',
    category: 'Platform',
    status: 'enabled',
    kind: 'module',
    routes: [{ path: '', component: PlansModule }],
  },
  {
    // Wallet & HUSD top-up — connect a wallet on Hanzo Mainnet, view HUSD + cloud
    // credit balances, and fund credit with HUSD. The send→verify→credit seam is
    // a same-origin server route (`/billing/topup/wallet`); the credit lands in
    // the same balance Billing shows. In-console because billing.hanzo.ai is a
    // static export and can't host the verify-and-record endpoint.
    id: 'wallet',
    label: 'Wallet',
    icon: Wallet,
    description: 'Connect a wallet and top up cloud credit with HUSD.',
    category: 'Platform',
    status: 'enabled',
    repo: 'hanzoai/billing',
    kind: 'module',
    routes: [{ path: '', component: WalletModule }],
  },
  {
    id: 'billing',
    label: 'Billing',
    icon: CreditCard,
    description: 'Balance, usage, and invoices for every product.',
    category: 'Platform',
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
