/**
 *   {
      id: 'observations',
      label: 'Observations',
      icon: Activity,
      description: 'Spans, generations, and events inside traces.',
      category: 'Observe',
      status: 'enabled',
      repo: 'hanzoai/o11y',
      kind: 'module',
      routes: [{ path: '', component: ObservationsModule }],
    },
  {
      id: 'users',
      label: 'Users',
      icon: Users,
      description: 'Per-user analytics — trace volume, tokens, and cost.',
      category: 'Observe',
      status: 'enabled',
      repo: 'hanzoai/o11y',
      kind: 'module',
      routes: [{ path: '', component: UsersModule }],
    },
Product catalog — the single source of truth for the unified console.
 *
 * ONE list (`catalog`) describes every Hanzo product, whether it is an
 * in-console admin module (owns routes, rendered here) or an external surface
 * (owned by another service, opened in a tab). The nav shell, the catalog
 * overview, the discover interstitials, the favorites system, and the router all
 * render from this list, so surfacing a product = adding ONE `CatalogEntry` — no
 * shell/route/page edits.
 *
 * Orthogonal: an entry owns its identity + how it opens and knows nothing about
 * siblings. The catalog only composes them. `productModules` (the in-console
 * subset) is derived, so the router/match layer is unchanged.
 *
 * Taxonomy: the ten canonical "Open AI Cloud" categories — exact labels and
 * order — as the open-source equivalent of Google Cloud, plus an appended
 * `Async` category for durable orchestration (Tasks/Temporal; GCP Cloud
 * Tasks/Workflows). The first ten keep their exact order; `Async` is appended so
 * nothing is reordered. Each entry names the Google Cloud product it stands in
 * for (`gcp`), and carries
 * an honest enablement `status`: an in-console module that works (`enabled`), a
 * live external Hanzo surface (`external`), or a primitive that ships but has no
 * console surface yet (`soon`). No fabricated states.
 */
import type { ComponentType } from 'react'
import { Users,
  Building2,
  AppWindow,
  Accessibility,
  LifeBuoy,
  Brain,
  Server,
  Bot,
  Zap,
  Sparkles,
  Boxes,
  ListChecks,
  Cpu,
  Container,
  FunctionSquare,
  Radio,
  Box,
  Database,
  Key,
  HardDrive,
  FileText,
  Network,
  Waypoints,
  Globe,
  Cable,
  Spline,
  Shield,
  ShieldCheck,
  KeyRound,
  Fingerprint,
  Lock,
  ScrollText,
  Terminal,
  Package,
  Code2,
  Play,
  Code,
  Monitor,
  FolderGit2,
  Layers,
  Hammer,
  Rocket,
  GitBranch,
  BarChart3,
  Activity,
  LineChart,
  Bell,
  CreditCard,
  TrendingUp,
  Gauge,
  Tag,
  ArrowLeftRight,
  Wallet,
  Coins,
  MessageSquare,
  Search,
  KeySquare,
  SlidersHorizontal,
  Ruler,
  ClipboardList,
  Workflow,
  NotebookPen,
  IdCard,
  Blocks,
  Store,
  Compass,
  Droplet,
} from '@hanzogui/lucide-icons-2'

import { config, type BrandId } from '~/config'
import { type ProductCategory, categoryOrder, categoriesForBrand, categoryInBrand } from './brand-scope'
import { ProvidersModule } from '~/components/products/ProvidersModule'
import { ModelsModule } from '~/components/products/ModelsModule'
import { ApplicationsModule } from '~/components/products/ApplicationsModule'
import { EmbeddingsModule } from '~/components/products/EmbeddingsModule'
import { ChatModule } from '~/components/products/ChatModule'
import { BotModule } from '~/components/products/BotModule'
import { MarketplaceModule } from '~/components/products/MarketplaceModule'
import { SearchModule } from '~/components/products/SearchModule'
import { TemplatesModule } from '~/components/products/TemplatesModule'
import { PlansModule } from '~/components/products/PlansModule'
import { BillingModule } from '~/components/products/BillingModule'
import { WalletModule } from '~/components/products/WalletModule'
import { IamModule, AuditModule } from '~/components/products/AdminModule'
import { KmsModule } from '~/components/products/KmsModule'
import { StorageModule } from '~/components/products/StorageModule'
import { BaseModule } from '~/components/products/BaseModule'
import { RecordsModule } from '~/components/products/RecordsModule'
import { ClustersModule } from '~/components/products/ClustersModule'
import { KubernetesModule } from '~/components/products/KubernetesModule'
import { TracesModule } from '~/components/products/TracesModule'
import { ObservationsModule } from '~/components/products/ObservationsModule'
import { UsersModule } from '~/components/products/UsersModule'
import { SessionsModule } from '~/components/products/SessionsModule'
import { ScoresModule } from '~/components/products/ScoresModule'
import { StatusModule } from '~/components/products/StatusModule'
import { MetricsModule } from '~/components/products/MetricsModule'
import { DnsModule } from '~/components/products/DnsModule'
import { PlaygroundModule } from '~/components/products/PlaygroundModule'
import { PromptCreateModule, PromptMetricsModule, PromptsModule } from '~/components/products/PromptsModule'
import { EvalsModule } from '~/components/products/EvalsModule'
import { DatasetItemsModule, DatasetRunsModule, DatasetsModule } from '~/components/products/DatasetsModule'
import { resourceRoutes } from '~/components/products/ResourceModule'
import { ComingSoon } from '~/components/products/ComingSoon'
import { overviewFor } from '~/components/products/overview/NativeOverview'
import { CategoryOverview } from '~/components/products/overview/CategoryOverview'
import {
  StoreProductsModule,
  StoreOrdersModule,
  StoreCustomersModule,
  StoreInventoryModule,
  StorePromotionsModule,
  StoreSettingsModule,
} from '~/components/products/commerce'
import { ApiKeysModule } from '~/components/products/ApiKeysModule'
import { SettingsModule } from '~/components/products/SettingsModule'
import { ScoreConfigsModule } from '~/components/products/ScoreConfigsModule'
import { AnnotationQueuesModule } from '~/components/products/AnnotationQueuesModule'
import { MemoryModule } from '~/components/products/MemoryModule'
import { TasksModule } from '~/components/products/TasksModule'
import { AttestationsModule } from '~/components/products/AttestationsModule'
import { ProjectsModule } from '~/components/products/ProjectsModule'
import { AppsModule } from '~/components/products/AppsModule'
import { OraclesModule } from '~/components/products/OraclesModule'
import { IndexerModule } from '~/components/products/IndexerModule'
import { NetworksModule } from '~/components/products/NetworksModule'
import { NodesModule } from '~/components/products/NodesModule'
import { TokensModule } from '~/components/products/TokensModule'
import { SettlementModule } from '~/components/products/SettlementModule'
import { AlertsModule } from '~/components/products/AlertsModule'
// Admin operator compute boards (cross-tenant, admin-only) — kind='bot'|'machine'
// lenses over the datastore. Aliased to avoid the clash with the per-org customer
// `MachinesModule` (Compute › Machines, over visor `/vm/v1/machines`).
import { BotsModule, MachinesModule as AdminMachinesModule, ClustersModule as AdminClustersModule, FunctionsModule as AdminFunctionsModule } from '~/components/products/ComputeModule'
import { AnalyticsModule } from '~/components/products/AnalyticsModule'
import { LogsModule } from '~/components/products/LogsModule'
import { PipelinesModule } from '~/components/products/PipelinesModule'
import { ReleasesModule } from '~/components/products/ReleasesModule'
import { BuildsModule } from '~/components/products/BuildsModule'
import { EnvironmentsModule } from '~/components/products/EnvironmentsModule'
import { HsmModule } from '~/components/products/HsmModule'
import { AuthzModule } from '~/components/products/AuthzModule'
import { ServiceMeshModule } from '~/components/products/ServiceMeshModule'
import { ServiceMapModule } from '~/components/products/ServiceMapModule'
import { LoadBalancerModule } from '~/components/products/LoadBalancerModule'
import { VpcModule } from '~/components/products/VpcModule'
import { EdgeModule } from '~/components/products/EdgeModule'
import { FunctionsModule } from '~/components/products/FunctionsModule'
import { ContainersModule } from '~/components/products/ContainersModule'
import { MachinesModule } from '~/components/products/MachinesModule'
import { GpusModule, GpusOverview } from '~/components/products/GpusModule'
import { FinetuningModule } from '~/components/products/FinetuningModule'
import { KubeflowModule } from '~/components/products/KubeflowModule'
import { InferenceModule } from '~/components/products/InferenceModule'
import { AgentsModule } from '~/components/products/AgentsModule'
import { CrmModule } from '~/components/products/CrmModule'
import { CmsModule } from '~/components/products/CmsModule'
import { ErpModule } from '~/components/products/ErpModule'
import { HelpModule } from '~/components/products/HelpModule'
import { AccessibilityModule } from '~/components/products/AccessibilityModule'
import { TeamModule } from '~/components/products/TeamModule'
import { ProfileModule } from '~/components/products/ProfileModule'
import { livingOverviewModule } from '~/components/products/overview/living/LivingOverviewModule'
import {
  DashboardsModule,
  ExperimentsModule,
  IntegrationsModule,
  ReferralsModule,
  ScoreAnalyticsModule,
} from '~/components/products/ConsoleFeatureModule'

/**
 * Living overviews — the reusable, videogame-like overview (count-up KPIs, live
 * sparklines, streaming activity, throttled polling) declared as one config per
 * product in `overview/living/registry.ts`. `livingOverviewModule(id)` resolves the
 * config and renders the ONE `LivingOverview`. The platform overview + these product
 * overviews all render from that single component — adding one is a config, not UI.
 */
const OverviewDashboard = livingOverviewModule('overview')
// admin.hanzo.ai OVERLORD board — the god-view of EVERYTHING (platform-wide product
// health + tenants + usage across ALL orgs). GLOBAL-ADMIN ONLY (`admin: true` hides
// it from every customer; its loader is an all-orgs god view and `/v1/admin/overview`
// is server-gated). The operational god-view — distinct from Business (P&L).
const OverlordDashboard = livingOverviewModule('overlord')
// admin.hanzo.ai business board — the SaaS control surface. GLOBAL-ADMIN ONLY
// (the catalog entry is `admin: true`; its loader is an all-orgs god view and the
// `/v1/admin/overview` aggregate is itself server-gated).
const BusinessDashboard = livingOverviewModule('admin-business')
// admin.hanzo.ai finance board — the SaaS profitability hero (DO credit burn-down,
// spend, MRR, revenue, gross margin, runway). GLOBAL-ADMIN ONLY (`admin: true`; the
// `/v1/admin/finance` aggregate is server-gated by getAdminGate). Financial data is
// Hanzo-internal and must never reach a customer.
const FinanceDashboard = livingOverviewModule('finance')
const AiMetricsLiving = livingOverviewModule('ai-metrics')
const OpenEditionLiving = livingOverviewModule('open-edition')
const FunctionsLiving = livingOverviewModule('functions')
// GPUs Overview is role-aware (admin → living overview, customer → visor catalog);
// the living-overview construction lives in GpusModule (GpusOverview) so this route
// is a plain component reference like every other.
import { ZeroTrustModule } from '~/components/products/ZeroTrustModule'

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
 * A declared sub-page in a product's level-2 nav (the Linear-style slide-in).
 *
 * A product declares its SPECIFIC sub-pages here (the meaningful tabs beyond the
 * index/Overview); the uniform base set — Overview · Settings · Status · Logs ·
 * Metrics — is auto-added by `productSubpages` so no product is a snowflake. The
 * Overview ('' index) is implicit and never declared. A declared sub-page whose
 * `slug` has no backing route (the module/route isn't merged yet) renders an
 * honest placeholder and is still a ⌘K jump target — never a 404, never a fake.
 */
export type ProductSubpage = {
  /** Path segment under the product (e.g. 'routing', 'queues'). Never '' — the
   *  index Overview is implicit. */
  slug: string
  /** Display label in the level-2 nav and the command palette. */
  label: string
  /** Optional icon (defaults per well-known base slug in `productSubpages`). */
  icon?: ProductIcon
  /**
   * Admin-only (global / Hanzo-managed) sub-page — hidden from a customer's
   * level-2 nav and the command palette, and rendered as an honest "managed by
   * Hanzo" notice if reached directly. Access is enforced server-side too. Used
   * for the shared-gateway config (e.g. Models › Routing) that customers read but
   * do not administer.
   */
  admin?: boolean
}

/**
 * The canonical Hanzo Cloud category axis — the top-level nav sections, in exact
 * order. The console nav, catalog overview, app launcher, and discover screens all
 * read this one taxonomy; `catalogByCategory` skips empty groups.
 *
 * Canonical axis (2-level nav, category → product → sub-pages):
 *   AI · Compute · Training · Data · Network · Security · Observe · Platform ·
 *   Dev · Web3 · Apps · Settings
 *
 * Decisions:
 *   - `Deploy` was renamed `Platform` (the ship-and-run pipeline: Projects,
 *     Environments, Builds, Registry, Releases, Pipelines).
 *   - `Training` is a new group (Fine-tuning + ML Pipelines/Kubeflow), split out
 *     of AI so model *building* is its own axis.
 *   - `Compute` is the infra axis: Kubernetes, Containers, Tasks, Functions,
 *     GPUs, Machines, Edge, Clusters, Applications. `Tasks` (durable workflows)
 *     REPLACES the retired `Jobs` entry; the `Async` group is gone.
 *   - `Settings` is a new group for org/account administration (Team, Settings,
 *     Profile).
 *   - `Dev` and `Web3` are retained (they hold real developer + on-chain
 *     products); the axis above lists the primary groups, not an exclusive set.
 */
// ProductCategory + categoryOrder + the pure per-brand scope live in
// ./brand-scope (dependency-free, unit-tested in registry-brand.test.ts).
// Re-exported here so existing importers of the registry are unchanged.
export type { ProductCategory } from './brand-scope'
export {
  categoryOrder,
  BRAND_CATEGORIES,
  categoriesForBrand,
  categoryInBrand,
  entryInBrandScope,
  categorySlug,
  categoryFromSlug,
  CATEGORY_SUMMARY,
} from './brand-scope'
import { entryInBrandScope } from './brand-scope'

/**
 * Enablement state — honest, two values only:
 *  - `enabled`  : an in-console module that works now (opens straight in, whether
 *                 a bespoke admin surface or a native product overview).
 *  - `soon`     : the primitive ships but has no console surface yet; the entry
 *                 opens an honest "coming soon" page pointing at the API/CLI.
 *
 * `external` is NOT a status — it is a `kind` (the shape discriminant on
 * `CatalogEntry`), orthogonal to enablement: a launch tile for a deployed external
 * app (the Lux/Zoo chain-app suite) is `status: 'enabled'` (it's live) with
 * `kind: 'external'` (it opens in a new tab). Enablement stays two honest values;
 * how a live entry OPENS (native route vs. external launch) is the kind, not this.
 */
export type ProductStatus = 'enabled' | 'soon'

type CatalogBase = {
  /** Stable id and base path segment, e.g. 'vector'. */
  id: string
  /** Display label (the canonical menu name). */
  label: string
  /** Display icon. */
  icon: ProductIcon
  /** One-line description for the catalog + nav. */
  description: string
  /** The Google Cloud product this is the open equivalent of, shown as a subtitle. */
  gcp?: string
  /** Category grouping. */
  category: ProductCategory
  /** Enablement state — drives the nav badge + Open vs coming soon. */
  status: ProductStatus
  /** Source repo for the product, e.g. 'hanzoai/vector'. Only set where it exists. */
  repo?: string
  /** Canonical docs deep link (docs.hanzo.ai/<slug>); falls back to the docs root. */
  docs?: string
  /** Admin-gated surface (shown with a lock hint; access enforced server-side). */
  admin?: boolean
  /**
   * Per-brand scope — the brands whose console shows this entry (`entryInBrandScope`).
   * OMIT for a brand-agnostic entry (the default: shown on every brand its category
   * admits — every in-console product). SET it only for a brand-specific entry that
   * must not cross-leak inside a shared category — e.g. the Lux chain-app launch
   * tiles are `['hanzo', 'lux']` and the Zoo ones `['hanzo', 'zoo']`, so both sit in
   * the shared Web3 category yet lux.cloud shows only Lux and zoo.cloud only Zoo
   * (hanzo, the umbrella, shows the full suite).
   */
  brands?: BrandId[]
  /**
   * The product's SPECIFIC level-2 sub-pages (beyond Overview + the uniform base
   * set, which `productSubpages` auto-adds). Only meaningful for `module` kinds.
   * Omit for a single-screen product — it still gets Overview + the base set.
   */
  subpages?: ProductSubpage[]
}

/**
 * A catalog entry is one of two honest shapes, discriminated on `kind`:
 *
 *  - `module`   : an in-console surface that OWNS its routes. Every Hanzo Cloud
 *                 product is this — a bespoke admin surface OR a native overview
 *                 (`routes: overviewRoutes(id)`). A Hanzo product the console
 *                 doesn't yet deep-manage still opens IN the console (a real page
 *                 with live health + inline docs), never a bounce to another
 *                 domain. This is the ONLY shape for anything Hanzo runs.
 *
 *  - `external` : a LAUNCH TILE for a standalone app that genuinely lives at its
 *                 own domain and is owned by another product — the deployed Lux /
 *                 Zoo chain-app suite (Explorer, Exchange, Bridge, Faucet, Safe,
 *                 DEX, Wallet). These are NOT Hanzo control-plane products and are
 *                 NOT rebuilt here; the tile opens `href` in a new tab. It owns no
 *                 route, no sub-pages, and no overview — `openProduct` launches it,
 *                 and every `kind !== 'module'` guard (productSubpages,
 *                 resolveProductView, destinationsFor, isAdminView, productModules)
 *                 fails closed so it never manufactures a dead in-console route.
 *
 * Both share `CatalogBase`, so the nav / launcher / ⌘K / category pages render and
 * open either uniformly. The discriminant keeps consumers exhaustive.
 */
export type CatalogEntry =
  | (CatalogBase & { kind: 'module'; routes: ProductRoute[] })
  | (CatalogBase & { kind: 'external'; href: string })

// docs.hanzo.ai serves the Fumadocs site under the /docs base path
// (docs.hanzo.ai/docs/<slug>), so product deep links must include it — a bare
// docs.hanzo.ai/<slug> 404s.
const DOCS = 'https://docs.hanzo.ai/docs'

/**
 * Docs deep links for products whose `docs` slug differs from `${DOCS}/<id>`.
 * These feed the `docs` FIELD (the small secondary "Full docs" reference on the
 * native overview) — NOT an external product link-out; every product opens IN
 * the console. Products whose docs slug matches their id use `${DOCS}/<id>` inline.
 */
const ext = {
  dns: `${DOCS}/dns`,
  cdn: `${DOCS}/cdn`,
  cli: `${DOCS}/cli`,
  sdk: `${DOCS}/sdk`,
  api: `${DOCS}/api`,
  ide: `${DOCS}/code`,
  desktop: `${DOCS}/desktop`,
} as const

/**
 * The shared "coming soon" surface for a `soon` entry — an honest page that
 * resolves itself from the path and points at the API/CLI. ONE component for
 * every `soon` leaf (DRY), so a soon entry is just `routes: soonRoutes`.
 */
const soonRoutes: ProductRoute[] = [{ path: '', component: ComingSoon }]

/**
 * The native product overview for a product that has no bespoke admin surface yet.
 * ONE component (`NativeOverview`, driven by a pure `OverviewSpec` in overview/
 * spec.ts) renders a real in-console page — header, live health from the platform
 * apps inventory, key facts, native actions, and INLINE docs — so the console has
 * ZERO external link-outs (a product opens IN the console, never in another tab).
 * DRY twin of `soonRoutes`: a native-overview leaf is just `routes: overviewRoutes(id)`.
 */
const overviewRoutes = (id: string): ProductRoute[] => [{ path: '', component: overviewFor(id) }]

/**
 * The Hanzo product catalog — the open-source Google Cloud, ten categories.
 * In-console modules render here; external surfaces open in a tab. Every real
 * working module is preserved; everything else is an honest `external` or `soon`.
 */
export const catalog: CatalogEntry[] = [
  // ── Observe — the usage/spend dashboard home (also rendered at '/') ───
  {
    id: 'overview',
    label: 'Overview',
    icon: Gauge,
    description: 'Real-time usage, performance, and spend across your AI workloads.',
    gcp: 'Cloud overview',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/console',
    kind: 'module',
    routes: [{ path: '', component: OverviewDashboard }],
  },
  {
    // admin.hanzo.ai OVERLORD board — the top-level god-view of EVERYTHING: every
    // Hanzo product's live health across the WHOLE platform (all orgs), tenant count,
    // and platform-wide usage/spend/top-models. GLOBAL-ADMIN ONLY (`admin: true` hides
    // it from every customer's nav/launcher/palette; the loader is an all-orgs god view
    // over the operator inventory + the server-gated `/v1/admin/overview` aggregate,
    // with an honest fallback to the real usage ledger — never blank, never fabricated).
    // The operational god-view; Business/Finance are the P&L lenses. Reuses the ONE
    // LivingOverview — this entry is a config, not a new surface.
    id: 'overlord',
    label: 'Overlord',
    icon: Radio,
    description: 'God-view of the whole platform — every product’s health, tenants, and usage across all orgs.',
    gcp: 'Cloud console (org-wide)',
    category: 'Observe',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/console',
    kind: 'module',
    routes: [{ path: '', component: OverlordDashboard }],
  },
  {
    // admin.hanzo.ai BUSINESS board — the SaaS control surface for running the
    // business (MRR/revenue, usage & cost, active orgs/customers, top agents/bots
    // by cost, plan mix, fleet health). GLOBAL-ADMIN ONLY (`admin: true` hides it
    // from every customer's nav/launcher/palette; the loader is an all-orgs god
    // view and `/v1/admin/overview` is server-gated). Reuses the ONE LivingOverview.
    id: 'business',
    label: 'Business',
    icon: TrendingUp,
    description: 'MRR, revenue, usage & cost, customers, and top agents across the whole platform.',
    gcp: 'Cloud Billing overview',
    category: 'Observe',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/console',
    kind: 'module',
    routes: [{ path: '', component: BusinessDashboard }],
  },
  {
    // admin.hanzo.ai FINANCE board — the SaaS profitability hero: DigitalOcean
    // credit burn-down (our primary ~$40k venue), month-to-date spend, MRR, total
    // revenue, gross margin %, runway, and a health verdict. GLOBAL-ADMIN ONLY
    // (`admin: true` hides it from every customer's nav/launcher/palette + the
    // catch-all renders a managed notice for a non-admin; the `/v1/admin/finance`
    // aggregate is server-gated by `getAdminGate`, so financial data never reaches a
    // customer). Reuses the ONE LivingOverview — this is a config, not a new surface.
    id: 'finance',
    label: 'Finance',
    icon: Coins,
    description: 'DigitalOcean credit burn-down, spend, revenue, gross margin, and runway across the platform.',
    gcp: 'Cloud Billing / FinOps',
    category: 'Observe',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/console',
    kind: 'module',
    routes: [{ path: '', component: FinanceDashboard }],
  },
  {
    // admin.hanzo.ai BOTS board — the SaaS operator view of every @hanzo/bot agent
    // booted across the platform (kind='bot'), and its spend, grouped
    // org → app → project. GLOBAL-ADMIN ONLY (`admin: true` hides it from every
    // customer's nav/launcher/palette; the `/v1/admin/compute` datastore aggregate is
    // server-gated by `getAdminGate`). Reads ONLY the unified datastore (ClickHouse) —
    // one cross-tenant GROUP BY, never a per-tenant fan-out (the tenant-data-hierarchy
    // invariant). Honest-empty until the compute-events emitter lands.
    id: 'bots',
    label: 'Bots',
    icon: Bot,
    description: 'Every @hanzo/bot agent booted across the platform, and its spend — grouped org → app → project.',
    gcp: 'Fleet analytics · bots',
    category: 'Observe',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/console',
    kind: 'module',
    routes: [{ path: '', component: BotsModule }],
  },
  {
    // admin.hanzo.ai MACHINES board — the operator view of raw compute (kind='machine')
    // visor opens across EVERY org, and its spend, grouped org → app → project. The
    // CROSS-TENANT operator lens (id `vms` — the per-org customer `machines` entry is a
    // different, non-admin surface over visor `/vm/v1/machines`). GLOBAL-ADMIN ONLY,
    // same datastore aggregate as Bots (`?kind=machine`). Honest-empty until wired.
    id: 'vms',
    label: 'Machines',
    icon: Boxes,
    description: 'Raw compute machines visor opens across every org, and their spend — grouped org → app → project.',
    gcp: 'Fleet analytics · machines',
    category: 'Observe',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/console',
    kind: 'module',
    routes: [{ path: '', component: AdminMachinesModule }],
  },
  {
    // admin.hanzo.ai CLUSTERS board — the operator view of every DOKS cluster visor
    // manages across EVERY org (kind='cluster'), grouped org → app → project. Node
    // pools (kind='nodepool') carry the compute cost and nest here as the emitter
    // lands. Distinct from the customer `clusters` product (per-org DOKS ops). GLOBAL-
    // ADMIN ONLY, same datastore aggregate (`?kind=cluster`). Honest-empty until
    // visor's cluster/nodepool emitters + the cloud read land.
    id: 'cluster-fleet',
    label: 'Clusters',
    icon: Network,
    description: 'Every DOKS cluster visor manages across every org — grouped org → app → project.',
    gcp: 'Fleet analytics · clusters',
    category: 'Observe',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/console',
    kind: 'module',
    routes: [{ path: '', component: AdminClustersModule }],
  },
  {
    // admin.hanzo.ai FUNCTIONS board — the operator view of serverless functions
    // across EVERY org (kind='function'), grouped org → app → project. Distinct from
    // the customer `functions` product. GLOBAL-ADMIN ONLY, same datastore aggregate
    // (`?kind=function`). Honest-empty until a functions runtime emits compute events
    // (hanzo/functions is upstream Fission with no tenant attribution today).
    id: 'function-fleet',
    label: 'Functions',
    icon: FunctionSquare,
    description: 'Every serverless function invoked across every org — grouped org → app → project.',
    gcp: 'Fleet analytics · functions',
    category: 'Observe',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/console',
    kind: 'module',
    routes: [{ path: '', component: AdminFunctionsModule }],
  },
  // ── AI ───────────────────────────────────────────────────────────────
  {
    // Catalog-first: the default tab is the LIVE model list (the ~49 Zen models),
    // routing policy is the secondary "Routing" tab. Retires the old empty-by-default
    // trap (the separate "Model Catalog" entry is gone — this IS it).
    id: 'models',
    label: 'Models',
    icon: Brain,
    description: 'Browse the live model catalog and configure routing policy.',
    gcp: 'Model Garden',
    category: 'AI',
    status: 'enabled',
    repo: 'hanzoai/ai',
    kind: 'module',
    routes: [
      { path: '', component: ModelsModule },
      { path: ':tab', component: ModelsModule },
      { path: 'routing/:name', component: ModelsModule },
    ],
    // Models is a CUSTOMER surface — everyone browses the live catalog. The
    // routing POLICY, though, is admin-only shared-gateway config (hidden from a
    // customer's sub-nav; graceful notice if reached directly).
    subpages: [{ slug: 'routing', label: 'Routing', admin: true }],
  },
  {
    // Admin-only: providers + credentials are shared-gateway config managed by
    // Hanzo (the cloud `get/add/update-provider` endpoints require a platform
    // admin — a customer org gets 403). Hidden from a customer's nav; reaching it
    // directly shows an honest "managed by Hanzo" notice, never a red error.
    id: 'providers',
    label: 'Providers',
    icon: Server,
    description: 'Model, storage, and embedding providers and credentials.',
    category: 'AI',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/ai',
    kind: 'module',
    routes: [
      { path: '', component: ProvidersModule },
      { path: ':name', component: ProvidersModule },
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: Bot,
    description: 'Build, deploy, and run autonomous agents.',
    gcp: 'Agent Builder',
    category: 'AI',
    status: 'enabled',
    repo: 'hanzoai/agent',
    docs: `${DOCS}/agents`,
    kind: 'module',
    routes: [{ path: '', component: AgentsModule }],
  },
  {
    id: 'inference',
    label: 'Inference',
    icon: Zap,
    description: 'Online and batch inference for deployed models.',
    gcp: 'Vertex AI Prediction',
    category: 'AI',
    status: 'enabled',
    repo: 'hanzoai/cloud',
    kind: 'module',
    // Inference OWNS its Status + Logs as rich, endpoint-oriented views (the `:tab`
    // route) — declaring them as SPECIFIC sub-pages makes the router render THESE
    // instead of the generic shared sub-page for those slugs. Metrics + Settings stay
    // on the shared per-product system (Metrics = the rich per-product LivingOverview).
    routes: [
      { path: '', component: InferenceModule },
      { path: ':tab', component: InferenceModule },
    ],
    subpages: [
      { slug: 'status', label: 'Status' },
      { slug: 'logs', label: 'Logs' },
    ],
  },
  {
    id: 'finetuning',
    label: 'Fine-tuning',
    icon: Sparkles,
    description: 'Fine-tune and train models on your own data.',
    gcp: 'Vertex AI Training',
    category: 'Training',
    status: 'enabled',
    kind: 'module',
    routes: [{ path: '', component: FinetuningModule }],
  },
  {
    // ML Pipelines (Kubeflow) — the read-only orchestration + control-plane view
    // over the live cloud mlsvc bridge (hanzoai/cloud clients/ml), which fronts the
    // Kubeflow-family CRDs as REST: Katib Experiments are the pipelines, trainer
    // TrainJobs are the runs, and /v1/train/health is a real operator/CRD probe.
    // Grouped with Fine-tuning under Training (the model-building axis); honest
    // states until the Kubeflow control plane reports.
    id: 'kubeflow',
    label: 'ML Pipelines',
    icon: Blocks,
    description: 'Orchestrated training and evaluation pipelines (Kubeflow).',
    gcp: 'Vertex AI Pipelines',
    category: 'Training',
    status: 'enabled',
    docs: `${DOCS}/pipelines`,
    kind: 'module',
    routes: [{ path: '', component: KubeflowModule }],
  },
  {
    // The embeddings product — generate, store, and search vector embeddings.
    // Collections ARE the per-org knowledge stores (get-stores), each mapping to
    // the Qdrant/Search index {owner}-{store}-docs; Models/generate use the
    // gateway (/v1/models, /v1/embeddings); Explore is /v1/search. The old
    // Stores admin (StoresModule) is SUPERSEDED by this — one surface, not two.
    id: 'embeddings',
    label: 'Embeddings',
    icon: Boxes,
    description: 'Generate, store, and search vector embeddings at scale.',
    gcp: 'Vertex AI Vector Search',
    category: 'AI',
    status: 'enabled',
    repo: 'hanzoai/ai',
    docs: `${DOCS}/embeddings`,
    kind: 'module',
    routes: [
      { path: '', component: EmbeddingsModule },
      { path: ':tab', component: EmbeddingsModule },
      { path: 'collections/:name', component: EmbeddingsModule },
    ],
    subpages: [
      { slug: 'explore', label: 'Explore' },
      { slug: 'collections', label: 'Collections' },
      { slug: 'jobs', label: 'Jobs' },
      { slug: 'models', label: 'Models' },
      { slug: 'settings', label: 'Settings' },
    ],
  },
  {
    // Native console evals — REAL run (POST /v1/evals/runs) + scores
    // (GET /v1/evals/scores) over the cloud evals facade. Grouped under Observe
    // per the taxonomy; the entry stays in array position (no reorder).
    id: 'evals',
    label: 'Evals',
    icon: ListChecks,
    description: 'Evaluate model and agent outputs with scored runs.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/o11y',
    kind: 'module',
    routes: [
      { path: '', component: EvalsModule },
      { path: ':tab', component: EvalsModule },
    ],
  },

  // ── Compute ──────────────────────────────────────────────────────────
  {
    id: 'gpus',
    label: 'GPUs',
    icon: Cpu,
    description: 'GPU clusters, utilization, and cost — on-demand H100/A100 compute.',
    gcp: 'Compute Engine GPUs',
    category: 'Compute',
    status: 'enabled',
    repo: 'hanzoai/operator',
    docs: `${DOCS}/gpus`,
    kind: 'module',
    // Overview ('') is role-aware (GpusOverview: admin → LivingOverview of the real
    // operator inventory + health; customer → the visor GPU catalog + their machines);
    // the product tabs stay on GpusModule via `:tab` (also role-routed), reachable from
    // the sidebar's level-2 sub-nav (declared below) so the overview is never a dead-end.
    routes: [
      { path: '', component: GpusOverview },
      { path: ':tab', component: GpusModule },
    ],
    subpages: [
      { slug: 'gpus', label: 'GPUs' },
      { slug: 'clusters', label: 'Clusters' },
      { slug: 'pools', label: 'Pools' },
      { slug: 'pricing', label: 'Pricing' },
      { slug: 'alerts', label: 'Alerts' },
    ],
  },
  {
    id: 'machines',
    label: 'Machines',
    icon: Server,
    description: 'Compute machines and capacity across regions (your cluster nodes).',
    category: 'Compute',
    status: 'enabled',
    docs: `${DOCS}/machines`,
    kind: 'module',
    routes: [{ path: '', component: MachinesModule }],
  },
  {
    id: 'containers',
    label: 'Containers',
    icon: Container,
    description: 'Run containers as managed, autoscaling services.',
    gcp: 'Cloud Run',
    category: 'Compute',
    status: 'enabled',
    kind: 'module',
    routes: [{ path: '', component: ContainersModule }],
  },
  {
    id: 'functions',
    label: 'Functions',
    icon: FunctionSquare,
    description: 'Event-driven serverless functions.',
    category: 'Compute',
    status: 'enabled',
    repo: 'hanzoai/functions',
    docs: `${DOCS}/functions`,
    kind: 'module',
    // Overview ('') is the reusable LivingOverview (real inventory + metrics); the
    // product tabs (Functions/Deployments/Triggers/Secrets/Settings) render via the
    // `:tab` route the module already targets (`/functions/:tab`).
    routes: [
      { path: '', component: FunctionsLiving },
      { path: ':tab', component: FunctionsModule },
    ],
    subpages: [
      { slug: 'functions', label: 'Functions' },
      { slug: 'deployments', label: 'Deployments' },
      { slug: 'triggers', label: 'Triggers' },
      { slug: 'secrets', label: 'Secrets' },
    ],
  },
  {
    id: 'edge',
    label: 'Edge',
    icon: Radio,
    description: 'Compute at the edge, close to your users.',
    category: 'Compute',
    status: 'enabled',
    repo: 'hanzoai/edge',
    docs: `${DOCS}/edge`,
    kind: 'module',
    routes: [{ path: '', component: EdgeModule }],
  },
  {
    // Real, enabled deploy surface — kept under Compute as the running-app
    // primitive (deployed application services). The canonical Cloud-Run-style
    // "Containers" product is separate and still on the roadmap (soon, above).
    id: 'applications',
    label: 'Applications',
    icon: Box,
    description: 'Deployed application services.',
    category: 'Compute',
    status: 'enabled',
    kind: 'module',
    routes: [
      { path: '', component: ApplicationsModule },
      { path: ':name', component: ApplicationsModule },
    ],
  },

  // ── Data — Hanzo Cloud as an open Google Cloud. Each is a ZAP-native Hanzo
  //    fork (NOT vanilla OSS), provisioned through the shared `resourceModule`
  //    factory over the provisioning contract (POST/GET/DELETE /v1/<kind>).
  {
    id: 'vector',
    label: 'Vector',
    icon: Boxes,
    description: 'Managed vector database — embeddings & semantic search.',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/vector',
    docs: `${DOCS}/vector`,
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
    docs: `${DOCS}/sql`,
    kind: 'module',
    routes: resourceRoutes({ kind: 'sql', productLabel: 'Hanzo SQL', connectionHint: 'Connect any SQL client with the connection string.' }),
  },
  {
    id: 'kv',
    label: 'KV',
    icon: Key,
    description: 'Managed key-value store — cache & queues.',
    gcp: 'Memorystore',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/kv',
    docs: `${DOCS}/kv`,
    kind: 'module',
    routes: resourceRoutes({ kind: 'kv', productLabel: 'Hanzo KV', connectionHint: 'Connect with any KV client using the connection string.' }),
  },
  {
    // A REAL S3 file manager (buckets + objects, folder navigation, upload/
    // download/delete) over the org-scoped `/v1/s3` control plane in the unified
    // cloud binary — NOT the generic provisioning resource card. It complements
    // the provisioning surface (which allocates the s3 RESOURCE): a bucket
    // created here or there is browsable here, same org namespace.
    id: 's3',
    label: 'S3',
    icon: HardDrive,
    description: 'Managed S3-compatible object storage — buckets and objects, scoped to your org.',
    gcp: 'Cloud Storage',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/s3',
    docs: `${DOCS}/storage`,
    kind: 'module',
    routes: [{ path: '', component: StorageModule }],
  },
  {
    id: 'datastore',
    label: 'Datastore',
    icon: Server,
    description: 'Managed wide-column analytics store.',
    gcp: 'Bigtable',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/datastore',
    docs: `${DOCS}/datastore`,
    kind: 'module',
    routes: resourceRoutes({ kind: 'datastore', productLabel: 'Hanzo Datastore', connectionHint: 'Connect over the Datastore HTTP/native protocol using the connection string.' }),
  },
  {
    // Manage the org's Hanzo Base instances ("Bases"). Each Base is a row in the
    // SuperBase orchestrator's `tenants` collection — its own realtime backend on
    // `<slug>.base.hanzo.ai`. All calls go through console2's `/superbase/*` proxy
    // (per-user IAM bearer minted server-side, org stamped from the JWT owner).
    id: 'base',
    label: 'Base',
    icon: Boxes,
    description: 'Realtime backends for your org — spin up a Base with content types, records, and auth.',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/base',
    docs: `${DOCS}/base`,
    kind: 'module',
    // Bases manager: `''` lists your Bases, `new` creates one, `:base` configures
    // one (`:base` = its record id). `new` precedes `:base` so `/base/new` is the
    // create flow, not a Base whose id is "new" (that slug is reserved). A Base's
    // own data — collections + records — is the sibling `Records` product.
    routes: [
      { path: '', component: BaseModule },
      { path: 'new', component: BaseModule },
      { path: ':base', component: BaseModule },
    ],
  },
  {
    // Records — browse + edit any Base collection's data BY CLICKING (the CRM/CMS
    // surface). Renders each collection's rows/detail from its own field schema
    // through @hanzo/data (DataTable + RecordDetail/RecordForm) over the same
    // per-user /superbase proxy. Base is the backend; this is the app on top.
    id: 'records',
    label: 'Records',
    icon: Boxes,
    description: 'Browse and edit any Base collection as a CRM/CMS — from its own schema.',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/base',
    docs: `${DOCS}/base`,
    kind: 'module',
    routes: [
      { path: '', component: RecordsModule },
      { path: ':collection', component: RecordsModule },
      { path: ':collection/:id', component: RecordsModule },
    ],
  },
  {
    id: 'docdb',
    label: 'DocDB',
    icon: FileText,
    description: 'Managed document database.',
    gcp: 'Firestore',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/docdb',
    docs: `${DOCS}/docdb`,
    kind: 'module',
    routes: resourceRoutes({ kind: 'docdb', productLabel: 'Hanzo DocDB', connectionHint: 'Connect with any DocDB driver using the connection string.' }),
  },

  // ── Network ──────────────────────────────────────────────────────────
  {
    id: 'gateway',
    label: 'Gateway',
    icon: Network,
    description: 'The unified, gated, priced API gateway — api.hanzo.ai.',
    gcp: 'API Gateway',
    category: 'Network',
    status: 'enabled',
    repo: 'hanzoai/gateway',
    docs: `${DOCS}/gateway`,
    kind: 'module',
    routes: overviewRoutes('gateway'),
  },
  {
    // Per-node blockchain infrastructure — validators (P-chain) + peers (info
    // API) across the REAL luxd primary networks. In `Network`, so it surfaces on
    // hanzo (all-networks super-admin/infra view) AND lux/zoo/pars (each scoped to
    // its own chain — see `nodeNetworksForBrand`). Reads live luxd RPC via the
    // /nodes proxy; honest "not reporting" per unreachable network.
    id: 'nodes',
    label: 'Nodes',
    icon: Server,
    description: 'Blockchain node infrastructure — validators and peers across networks.',
    category: 'Network',
    status: 'enabled',
    repo: 'luxfi/node',
    docs: `${DOCS}/nodes`,
    kind: 'module',
    routes: [{ path: '', component: NodesModule }],
  },
  {
    id: 'vpc',
    label: 'VPC',
    icon: Waypoints,
    description: 'Private networks, subnets, and peering.',
    category: 'Network',
    status: 'enabled',
    kind: 'module',
    routes: [{ path: '', component: VpcModule }],
  },
  {
    id: 'dns',
    label: 'DNS',
    icon: Globe,
    description: 'Managed authoritative DNS.',
    gcp: 'Cloud DNS',
    category: 'Network',
    status: 'enabled',
    repo: 'hanzoai/dns',
    docs: ext.dns,
    kind: 'module',
    // Real per-org managed DNS via hanzodns (zones + records → CoreDNS + Cloudflare
    // sync) on the unified /v1/dns surface; honest states until the route is bound.
    routes: [{ path: '', component: DnsModule }],
  },
  {
    id: 'cdn',
    label: 'CDN',
    icon: Cable,
    description: 'Global content delivery and edge caching.',
    category: 'Network',
    status: 'enabled',
    docs: ext.cdn,
    kind: 'module',
    routes: overviewRoutes('cdn'),
  },
  {
    id: 'load-balancer',
    label: 'Load Balancer',
    icon: Spline,
    description: 'Layer 4/7 load balancing across services.',
    category: 'Network',
    status: 'enabled',
    kind: 'module',
    routes: [{ path: '', component: LoadBalancerModule }],
  },
  {
    id: 'service-mesh',
    label: 'Service Mesh',
    icon: Waypoints,
    description: 'Service-to-service routing, mTLS, and policy.',
    category: 'Network',
    status: 'enabled',
    kind: 'module',
    routes: [{ path: '', component: ServiceMeshModule }],
  },

  // ── Security ─────────────────────────────────────────────────────────
  {
    id: 'iam',
    label: 'IAM',
    icon: Shield,
    description: 'Organizations, users, and roles (RBAC) — Hanzo IAM.',
    category: 'Security',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/iam',
    docs: `${DOCS}/iam`,
    kind: 'module',
    routes: [
      { path: '', component: IamModule },
      { path: ':tab', component: IamModule },
    ],
    subpages: [
      { slug: 'users', label: 'Users' },
      { slug: 'roles', label: 'Roles' },
    ],
  },
  {
    id: 'authz',
    label: 'Authz',
    icon: ShieldCheck,
    description: 'Fine-grained authorization policies and checks.',
    category: 'Security',
    status: 'enabled',
    repo: 'hanzoai/authz',
    docs: `${DOCS}/authz`,
    kind: 'module',
    routes: [{ path: '', component: AuthzModule }],
  },
  {
    id: 'kms',
    label: 'KMS',
    icon: KeyRound,
    description: 'Encryption keys and cryptographic operations — Hanzo KMS.',
    category: 'Security',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/kms',
    docs: `${DOCS}/kms`,
    kind: 'module',
    routes: [{ path: '', component: KmsModule }],
  },
  {
    id: 'hsm',
    label: 'HSM',
    icon: Fingerprint,
    description: 'Hardware-backed key protection.',
    category: 'Security',
    status: 'enabled',
    repo: 'hanzoai/hsm',
    kind: 'module',
    routes: [{ path: '', component: HsmModule }],
  },
  {
    // Secret Manager facet of the same zero-knowledge KMS backend.
    id: 'secrets',
    label: 'Secrets',
    icon: Lock,
    description: 'Store and rotate secrets — zero-knowledge, on Hanzo KMS.',
    gcp: 'Secret Manager',
    category: 'Security',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/kms',
    docs: `${DOCS}/kms`,
    kind: 'module',
    routes: [{ path: '', component: KmsModule }],
  },
  {
    id: 'mpc',
    label: 'MPC',
    icon: Network,
    description: 'Threshold signing & multi-party computation — Hanzo MPC.',
    category: 'Security',
    status: 'enabled',
    repo: 'hanzoai/mpc',
    docs: `${DOCS}/mpc`,
    kind: 'module',
    routes: overviewRoutes('mpc'),
  },
  {
    id: 'audit',
    label: 'Audit',
    icon: ScrollText,
    description: 'Audit log of identity and access events.',
    category: 'Security',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/iam',
    kind: 'module',
    routes: [{ path: '', component: AuditModule }],
  },
  {
    id: 'zero-trust',
    label: 'Zero Trust',
    icon: ShieldCheck,
    description: 'Private service access: routers, identities, policies, and sessions.',
    category: 'Security',
    status: 'enabled',
    repo: 'hanzoai/zt',
    docs: `${DOCS}/zero-trust`,
    kind: 'module',
    routes: [
      { path: '', component: ZeroTrustModule },
      { path: ':tab', component: ZeroTrustModule },
    ],
  },

  // ── Dev ──────────────────────────────────────────────────────────────
  {
    id: 'cli',
    label: 'CLI',
    icon: Terminal,
    description: 'The hanzo command-line interface.',
    category: 'Dev',
    status: 'enabled',
    repo: 'hanzoai/cli',
    docs: ext.cli,
    kind: 'module',
    routes: overviewRoutes('cli'),
  },
  {
    id: 'sdks',
    label: 'SDKs',
    icon: Package,
    description: 'Python, TypeScript, Go, and Rust SDKs.',
    category: 'Dev',
    status: 'enabled',
    docs: ext.sdk,
    kind: 'module',
    routes: overviewRoutes('sdks'),
  },
  {
    id: 'api',
    label: 'API',
    icon: Code2,
    description: 'The REST API reference for every service.',
    category: 'Dev',
    status: 'enabled',
    repo: 'hanzoai/ai',
    docs: ext.api,
    kind: 'module',
    routes: overviewRoutes('api'),
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: Cable,
    description: 'Blob storage, Slack, Mixpanel, and Insights connections.',
    category: 'Dev',
    status: 'enabled',
    repo: 'hanzoai/console',
    docs: `${DOCS}/integrations`,
    kind: 'module',
    routes: [
      { path: '', component: IntegrationsModule },
      { path: ':tab', component: IntegrationsModule },
    ],
  },
  {
    // Native console playground — REAL model run over the OpenAI-compatible
    // gateway (GET /v1/models + POST /v1/chat/completions). Grouped under AI per
    // the taxonomy; the entry stays in array position (no reorder).
    id: 'playground',
    label: 'Playground',
    icon: Play,
    description: 'Try models and prompts interactively.',
    category: 'AI',
    status: 'enabled',
    repo: 'hanzoai/ai',
    kind: 'module',
    routes: [{ path: '', component: PlaygroundModule }],
  },
  {
    id: 'ide',
    label: 'IDE',
    icon: Code,
    description: 'The Hanzo AI development environment.',
    category: 'Dev',
    status: 'enabled',
    repo: 'hanzoai/code',
    docs: ext.ide,
    kind: 'module',
    routes: overviewRoutes('ide'),
  },
  {
    id: 'desktop',
    label: 'Desktop',
    icon: Monitor,
    description: 'The Hanzo desktop app.',
    category: 'Dev',
    status: 'enabled',
    repo: 'hanzoai/desktop',
    docs: ext.desktop,
    kind: 'module',
    routes: overviewRoutes('desktop'),
  },

  // ── Deploy — the PaaS control plane (platform.hanzo.ai) over the /paas
  //    proxy. Clusters and Kubernetes are the real, wired surfaces; the rest of
  //    the CI/CD pipeline ships incrementally.
  {
    id: 'projects',
    label: 'Projects',
    icon: FolderGit2,
    description: 'Projects organize resources under your org — the scope for o11y, API keys, datasets, and deploys.',
    gcp: 'Resource Manager',
    category: 'Platform',
    status: 'enabled',
    repo: 'hanzoai/console',
    kind: 'module',
    routes: [{ path: '', component: ProjectsModule }],
  },
  {
    // Apps — the org's BUILDABLE SITES (cloud clients/projectsvc, /v1/projects): the
    // projects hanzo.app publishes when a user ships a site from the conversational
    // builder. Closes the console→app round-trip — every published site lists here
    // with its live URL + deploy history, and each row deep-links back into hanzo.app
    // (`/dev?project=<slug>`) for more editing. DISTINCT from the IAM `projects` entry
    // above (the org's resource SCOPE for o11y/keys/datasets) and from Compute
    // `Applications` (PaaS container apps) — this is the hanzo.app sites store only.
    id: 'apps',
    label: 'Apps',
    icon: AppWindow,
    description: 'The sites you build and publish in hanzo.app — live URL, deploy history, and one-click editing.',
    gcp: 'Firebase Hosting',
    category: 'Platform',
    status: 'enabled',
    repo: 'hanzoai/cloud',
    docs: `${DOCS}/apps`,
    kind: 'module',
    // Overview ('') lists the org's sites; the `:slug` route opens a site's detail
    // rail (real deployment history) — the same routed-detail shape Chat uses.
    routes: [
      { path: '', component: AppsModule },
      { path: ':slug', component: AppsModule },
    ],
  },
  {
    id: 'environments',
    label: 'Environments',
    icon: Layers,
    description: 'Promote builds across dev, staging, and prod.',
    category: 'Platform',
    status: 'enabled',
    kind: 'module',
    routes: [{ path: '', component: EnvironmentsModule }],
  },
  {
    id: 'builds',
    label: 'Builds',
    icon: Hammer,
    description: 'Build images and artifacts from source.',
    category: 'Platform',
    status: 'enabled',
    kind: 'module',
    routes: [{ path: '', component: BuildsModule }],
  },
  {
    id: 'registry',
    label: 'Registry',
    icon: Package,
    description: 'Container images and artifacts — ghcr.io/hanzoai.',
    gcp: 'Artifact Registry',
    category: 'Platform',
    status: 'enabled',
    repo: 'hanzoai/registry',
    docs: `${DOCS}/registry`,
    kind: 'module',
    routes: overviewRoutes('registry'),
  },
  {
    id: 'releases',
    label: 'Releases',
    icon: Rocket,
    description: 'Versioned releases and rollbacks.',
    category: 'Platform',
    status: 'enabled',
    kind: 'module',
    routes: [{ path: '', component: ReleasesModule }],
  },
  {
    id: 'pipelines',
    label: 'Pipelines',
    icon: GitBranch,
    description: 'CI/CD pipelines from commit to deploy.',
    category: 'Platform',
    status: 'enabled',
    docs: `${DOCS}/pipelines`,
    kind: 'module',
    routes: [{ path: '', component: PipelinesModule }],
  },
  {
    // Real, enabled — pick WHERE workloads run: shared Hanzo Cloud or your own
    // DOKS, reconciled by the same operator. One control plane, many targets.
    id: 'clusters',
    label: 'Clusters',
    icon: Network,
    description: 'Your Kubernetes — shared Hanzo Cloud or your own DOKS.',
    category: 'Compute',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/operator',
    kind: 'module',
    routes: [{ path: '', component: ClustersModule }],
  },
  {
    // Real, enabled — browse workloads + operator custom resources per cluster,
    // via the PaaS control plane (/paas → platform). Honest states if not live.
    id: 'kubernetes',
    label: 'Kubernetes',
    icon: Boxes,
    description: 'Workloads and operator custom resources, per cluster.',
    category: 'Compute',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/operator',
    kind: 'module',
    routes: [
      { path: '', component: KubernetesModule },
      { path: ':tab', component: KubernetesModule },
    ],
  },

  // ── Observe ──────────────────────────────────────────────────────────
  {
    id: 'logs',
    label: 'Logs',
    icon: ScrollText,
    description: 'Structured logs across all services.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/o11y',
    docs: `${DOCS}/logs`,
    kind: 'module',
    routes: [{ path: '', component: LogsModule }],
  },
  {
    id: 'metrics',
    label: 'Metrics',
    icon: BarChart3,
    description: 'Live platform service health and infrastructure metrics.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/o11y',
    docs: `${DOCS}/metrics`,
    kind: 'module',
    routes: [{ path: '', component: MetricsModule }],
  },
  {
    // Console-native traces — list + detail (observations, scores, I/O) on the
    // REAL /v1/o11y/traces surface. Honest RuntimeNotice when the runtime is not
    // initialized (503) or unrouted (404); never fabricated spans or costs.
    id: 'o11y',
    label: 'Traces',
    icon: Activity,
    description: 'End-to-end LLM and agent traces.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/o11y',
    docs: `${DOCS}/traces`,
    kind: 'module',
    routes: [
      { path: '', component: TracesModule },
      { path: ':id', component: TracesModule },
    ],
  },
  {
    id: 'service-map',
    label: 'Service Map',
    icon: Waypoints,
    description: 'Per-service RED metrics and the live dependency graph.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/o11y',
    docs: `${DOCS}/apm`,
    kind: 'module',
    routes: [{ path: '', component: ServiceMapModule }],
  },
  {
    // Native — the org's AI usage at a glance: requests, tokens, spend, and
    // balance over a 24h/7d/30d window, a per-day chart, a per-model breakdown,
    // and recent activity. REAL per-org data from the commerce usage ledger
    // (GET /v1/billing/usage via the per-tenant /billing proxy), joined to the
    // model catalog for display names + pricing. The o11y RuntimeNotice links
    // here when traces aren't initialized, since THIS page has data today.
    id: 'ai-metrics',
    label: 'AI Metrics',
    icon: BarChart3,
    description: 'Requests, tokens, spend, and per-model usage for your org.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/commerce',
    docs: `${DOCS}/billing`,
    kind: 'module',
    // The reusable LivingOverview over the SAME real commerce usage ledger the old
    // AiMetricsModule read — now with count-up KPIs, live sparklines, and streaming.
    routes: [{ path: '', component: AiMetricsLiving }],
  },
  {
    // Open Edition (run-for-pay): the customer's view of their open-source
    // workload spend, over the SAME real commerce usage ledger scoped to the
    // run-for-pay product tag. Spend billed = cost + 25% (the served revenue R).
    // Canonical: docs/architecture/run-for-pay-pricing.md.
    id: 'open-edition',
    label: 'Open Edition',
    icon: TrendingUp,
    description: 'Run open-source workloads for pay — spend billed at cost + 25%, tokens, and per-model usage.',
    gcp: 'Marketplace / pay-as-you-go',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/cloud',
    docs: `${DOCS}/billing`,
    kind: 'module',
    routes: [{ path: '', component: OpenEditionLiving }],
  },
  {
    // Native Analytics — per-org LLM + web + commerce analytics over the unified
    // ClickHouse warehouse (datastore), read through cloud-api /v1/analytics/* via
    // the /cloud bearer proxy (the FOUR real routes: overview/timeseries/top/health).
    // Overview (LLM lens REAL from hanzo.cloud_usage; web/commerce honest-empty until
    // the events collector emits) + LLM (top models) — every metric a real query,
    // never fabricated. See universe/docs/architecture/unified-analytics.md.
    id: 'analytics',
    label: 'Analytics',
    icon: BarChart3,
    description: 'Per-org web, commerce, and LLM analytics over the unified warehouse.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/analytics',
    docs: `${DOCS}/analytics`,
    kind: 'module',
    routes: [
      { path: '', component: AnalyticsModule },
      { path: ':tab', component: AnalyticsModule },
    ],
    subpages: [{ slug: 'llm', label: 'LLM' }],
  },
  {
    id: 'dashboards',
    label: 'Dashboards',
    icon: LineChart,
    description: 'Product analytics and observability dashboards.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/analytics',
    docs: `${DOCS}/dashboards`,
    kind: 'module',
    routes: [
      { path: '', component: DashboardsModule },
      { path: ':tab', component: DashboardsModule },
    ],
  },
  {
    id: 'alerts',
    label: 'Alerts',
    icon: Bell,
    description: 'Alerting rules and notification policies.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/o11y',
    kind: 'module',
    routes: [{ path: '', component: AlertsModule }],
  },
  {
    // The unified Billing Center — the ONE GCP-Cloud-Billing-style money surface.
    // A tabbed product (Overview · Reports · Budgets · Invoices · Subscriptions ·
    // Payment methods · Credits) over the per-tenant `/billing/*` commerce proxy.
    // SUPERSEDES the old scattered Cost / Subscriptions / Payment-methods entries
    // (folded in as tabs — one center, zero duplication). It is ALSO the whole
    // surface shown in billing-only shell mode at billing.<brand> (SAME component,
    // filtered nav + default route), so console and billing.hanzo.ai are 1:1.
    id: 'billing',
    label: 'Billing',
    icon: CreditCard,
    description: 'Balance, spend, budgets, invoices, subscriptions, and payment methods.',
    gcp: 'Cloud Billing',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/commerce',
    docs: `${DOCS}/billing`,
    kind: 'module',
    routes: [
      { path: '', component: BillingModule },
      { path: ':tab', component: BillingModule },
    ],
    subpages: [
      { slug: 'reports', label: 'Reports' },
      { slug: 'budgets', label: 'Budgets' },
      { slug: 'invoices', label: 'Invoices' },
      { slug: 'subscriptions', label: 'Subscriptions' },
      { slug: 'payment-methods', label: 'Payment methods' },
      { slug: 'credits', label: 'Credits' },
    ],
  },
  {
    // Real, enabled — the all-services health view, from real cluster data.
    id: 'status',
    label: 'Status',
    icon: Gauge,
    description: 'Live health of every Hanzo service across your clusters.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/operator',
    kind: 'module',
    routes: [{ path: '', component: StatusModule }],
  },
  {
    // Real, enabled — compare plans and pricing (live /v1/pricing). Paying
    // happens in Cost/Billing (the one money surface); this never charges.
    id: 'plans',
    label: 'Plans & Pricing',
    icon: Tag,
    description: 'Compare plans and pricing for every cloud service.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/billing',
    kind: 'module',
    routes: [{ path: '', component: PlansModule }],
  },

  // ── Web3 ─────────────────────────────────────────────────────────────
  {
    id: 'settlement',
    label: 'Settlement',
    icon: ArrowLeftRight,
    description: 'On-chain settlement for compute and payouts.',
    category: 'Web3',
    status: 'enabled',
    repo: 'hanzoai/ledger',
    docs: `${DOCS}/blockchain`,
    kind: 'module',
    routes: [{ path: '', component: SettlementModule }],
  },
  {
    // Real, enabled — connect a wallet on Hanzo Mainnet, view HUSD + cloud
    // credit, and top up credit with HUSD (same-origin verify-and-record seam).
    id: 'wallet',
    label: 'Wallets',
    icon: Wallet,
    description: 'Connect a wallet and top up cloud credit with HUSD.',
    category: 'Web3',
    status: 'enabled',
    repo: 'hanzoai/billing',
    kind: 'module',
    routes: [{ path: '', component: WalletModule }],
  },
  {
    id: 'referrals',
    label: 'Referrals',
    icon: Coins,
    description: 'Referral link, invite history, and cloud-credit earnings.',
    category: 'Web3',
    status: 'enabled',
    repo: 'hanzoai/billing',
    docs: `${DOCS}/referrals`,
    kind: 'module',
    routes: [
      { path: '', component: ReferralsModule },
      { path: ':tab', component: ReferralsModule },
    ],
  },
  {
    id: 'tokens',
    label: 'Tokens',
    icon: Coins,
    description: 'Issue and manage tokens and balances.',
    category: 'Web3',
    status: 'enabled',
    repo: 'hanzoai/treasury',
    kind: 'module',
    routes: [{ path: '', component: TokensModule }],
  },
  {
    // Bootnode ("Web3 Backend in a Box") blockchain networks — the core web3
    // provisioning primitive, surfaced in the lux/zoo web3 consoles. Reads the
    // real bootnode control plane via console2's /bootnode proxy (honest states).
    id: 'networks',
    label: 'Networks',
    icon: Blocks,
    description: 'Blockchain networks — chain, nodes, status, and RPC.',
    category: 'Web3',
    status: 'enabled',
    repo: 'hanzoai/bootnode',
    docs: `${DOCS}/networks`,
    kind: 'module',
    routes: [{ path: '', component: NetworksModule }],
  },
  {
    id: 'indexer',
    label: 'Indexer',
    icon: Database,
    description: 'Index and query on-chain data.',
    category: 'Web3',
    status: 'enabled',
    kind: 'module',
    routes: [{ path: '', component: IndexerModule }],
  },
  {
    id: 'oracles',
    label: 'Oracles',
    icon: Radio,
    description: 'Bring off-chain data on-chain.',
    category: 'Web3',
    status: 'enabled',
    kind: 'module',
    routes: [{ path: '', component: OraclesModule }],
  },
  {
    id: 'attestations',
    label: 'Attestations',
    icon: ShieldCheck,
    description: 'Verifiable attestations and proofs.',
    category: 'Web3',
    status: 'enabled',
    kind: 'module',
    routes: [{ path: '', component: AttestationsModule }],
  },

  // ── Web3 · Chain apps — launch tiles for the DEPLOYED Lux / Zoo dApp suite.
  //    These are standalone web3 apps that live at their OWN domains (owned by
  //    the Lux / Zoo products, not Hanzo control planes), so they are `external`
  //    launch tiles — `openProduct` opens `href` in a new tab, never a rebuilt
  //    in-console surface. Per-brand `brands` keeps them from cross-leaking: the
  //    Lux tiles show only on lux.cloud, the Zoo tiles only on zoo.cloud.
  //    Every href is a real, verified deployment — no fabricated URLs.
  {
    id: 'lux-explorer',
    label: 'Explorer',
    icon: Compass,
    description: 'Lux Network block explorer — search transactions, addresses, and contracts.',
    category: 'Web3',
    status: 'enabled',
    brands: ['lux'],
    kind: 'external',
    href: 'https://explore.lux.network',
  },
  {
    id: 'lux-exchange',
    label: 'Exchange',
    icon: ArrowLeftRight,
    description: 'Trade digital assets on the Lux exchange.',
    category: 'Web3',
    status: 'enabled',
    brands: ['lux'],
    kind: 'external',
    href: 'https://lux.exchange',
  },
  {
    id: 'lux-bridge',
    label: 'Bridge',
    icon: Waypoints,
    description: 'Bridge assets across chains on the Lux Network.',
    category: 'Web3',
    status: 'enabled',
    brands: ['lux'],
    kind: 'external',
    href: 'https://bridge.lux.network',
  },
  {
    id: 'lux-faucet',
    label: 'Faucet',
    icon: Droplet,
    description: 'Claim testnet tokens for building on Lux.',
    category: 'Web3',
    status: 'enabled',
    brands: ['lux'],
    kind: 'external',
    href: 'https://faucet.lux.network',
  },
  {
    id: 'lux-safe',
    label: 'Safe',
    icon: Shield,
    description: 'Multisig smart-contract wallet on Lux (Safe).',
    category: 'Web3',
    status: 'enabled',
    brands: ['lux'],
    kind: 'external',
    href: 'https://safe.lux.finance',
  },
  {
    id: 'lux-dex',
    label: 'DEX',
    icon: Coins,
    description: 'Swap tokens on the Lux on-chain decentralized exchange.',
    category: 'Web3',
    status: 'enabled',
    brands: ['lux'],
    kind: 'external',
    href: 'https://dex.lux.network',
  },
  {
    id: 'lux-wallet',
    label: 'Wallet',
    icon: Wallet,
    description: 'Manage your assets across the Lux C, P, and X chains.',
    category: 'Web3',
    status: 'enabled',
    brands: ['lux'],
    kind: 'external',
    href: 'https://wallet.lux.network',
  },
  {
    id: 'zoo-explorer',
    label: 'Explorer',
    icon: Compass,
    description: 'Zoo Network block explorer — search transactions, addresses, and contracts.',
    category: 'Web3',
    status: 'enabled',
    brands: ['zoo'],
    kind: 'external',
    href: 'https://explore.zoo.network',
  },
  {
    id: 'zoo-exchange',
    label: 'Exchange',
    icon: ArrowLeftRight,
    description: 'Trade digital assets on the Zoo exchange.',
    category: 'Web3',
    status: 'enabled',
    brands: ['zoo'],
    kind: 'external',
    href: 'https://zoo.exchange',
  },
  {
    id: 'zoo-bridge',
    label: 'Bridge',
    icon: Waypoints,
    description: 'Bridge assets across chains on the Zoo Network.',
    category: 'Web3',
    status: 'enabled',
    brands: ['zoo'],
    kind: 'external',
    href: 'https://bridge.zoo.ngo',
  },

  // ── Apps ─────────────────────────────────────────────────────────────
  {
    id: 'chat',
    label: 'Chat',
    icon: MessageSquare,
    description: 'AI chat with Zen models, third-party models, and MCP tools.',
    category: 'Apps',
    status: 'enabled',
    repo: 'hanzoai/chat',
    docs: `${DOCS}/chat`,
    kind: 'module',
    routes: [
      { path: '', component: ChatModule },
      { path: ':name', component: ChatModule },
    ],
  },
  {
    id: 'bot',
    label: 'Bot',
    icon: Bot,
    description: 'Agent gateway — channels, skills, and an OpenAI-compatible API.',
    category: 'Apps',
    status: 'enabled',
    repo: 'hanzoai/bot',
    kind: 'module',
    routes: [{ path: '', component: BotModule }],
  },
  {
    // CRM — the first Hanzo Business-OS brick, over the native-Go cloud `/v1/crm`
    // surface (cloud clients/crm on Base/SQLite: companies/contacts/opportunities,
    // a port of Twenty's core model). Per-org through the user-bearer /cloud proxy.
    id: 'crm',
    label: 'CRM',
    icon: Building2,
    description: 'Companies, contacts, and opportunities — your Business-OS CRM, per org.',
    category: 'Apps',
    status: 'enabled',
    repo: 'hanzoai/cloud',
    docs: `${DOCS}/crm`,
    kind: 'module',
    // Overview ('') defaults to Companies; the three collections render via the
    // `:tab` route the module targets (`/crm/{companies,contacts,opportunities}`).
    routes: [
      { path: '', component: CrmModule },
      { path: ':tab', component: CrmModule },
    ],
    subpages: [
      { slug: 'companies', label: 'Companies' },
      { slug: 'contacts', label: 'Contacts' },
      { slug: 'opportunities', label: 'Opportunities' },
    ],
  },
  {
    // Content — the Payload headless CMS (cms.<brand>, live at cms.hanzo.ai/admin)
    // surfaced NATIVELY: Collections + Media/DAM are read live over Payload's REST API
    // via the /cms user-bearer proxy (per-org, tenant-isolated by the owner claim), and
    // the Studio tab EMBEDS the real admin (SSO iframe) for the owning brand org. No
    // fabricated rows — real per-org content, honest-empty, or the shared state card.
    id: 'cms',
    label: 'Content',
    icon: FileText,
    description: 'Headless CMS — pages, media, and the full Studio, per org, with IAM SSO.',
    category: 'Apps',
    status: 'enabled',
    repo: 'hanzoai/cms',
    docs: `${DOCS}/cms`,
    kind: 'module',
    routes: [
      { path: '', component: CmsModule },
      { path: ':tab', component: CmsModule },
    ],
    subpages: [
      { slug: 'media', label: 'Media' },
      { slug: 'studio', label: 'Studio' },
    ],
  },
  {
    // ERP — the canonical ERPNext (Frappe) suite surfaced IN the console (ErpModule),
    // entitlement-gated to the owning brand org (Frappe is single-tenant). Overview
    // drives a REAL /v1/platform deploy with live status; Accounting/Items/Sales are
    // NATIVE summary views over Frappe REST (honest "deploy ERP" until an instance is
    // live); Desk embeds the real desk once erp.<brand> is reachable. Never fabricated.
    id: 'erp',
    label: 'ERP',
    icon: Boxes,
    description: 'Accounting, inventory, sales, and HR — your Business-OS ERP on ERPNext.',
    category: 'Apps',
    status: 'enabled',
    repo: 'hanzoai/erp',
    docs: `${DOCS}/erp`,
    kind: 'module',
    routes: [
      { path: '', component: ErpModule },
      { path: ':tab', component: ErpModule },
    ],
    subpages: [
      { slug: 'accounting', label: 'Accounting' },
      { slug: 'items', label: 'Items' },
      { slug: 'sales', label: 'Sales Orders' },
      { slug: 'desk', label: 'Desk' },
    ],
  },
  {
    // Help Center — the live Hanzo Help Center (Frappe Helpdesk at help.<brand>,
    // confirmed live at help.hanzo.ai), EMBEDDED in the console (HelpModule) over
    // the brand IAM SSO ("Login with hanzo"). A shared brand support desk — the
    // Helpdesk scopes each caller to their own tickets — so it's embedded for every
    // signed-in user; honest "not available" if the host isn't reachable.
    id: 'helpdesk',
    label: 'Help Center',
    icon: LifeBuoy,
    description: 'Customer support — tickets and a knowledge base for your users.',
    category: 'Apps',
    status: 'enabled',
    repo: 'hanzoai/helpdesk',
    docs: `${DOCS}/helpdesk`,
    kind: 'module',
    routes: [{ path: '', component: HelpModule }],
  },
  {
    // Accessibility — a Wix-style WCAG checker for the site Dave is building. Runs
    // Deque's axe-core against the current page 100% client-side (engine lazy-loaded
    // into its own chunk); pure sort/summarize logic lives in ~/lib/a11y/scan.
    id: 'accessibility',
    label: 'Accessibility',
    icon: Accessibility,
    description: 'Scan the current page for WCAG accessibility issues — axe-core, in your browser.',
    category: 'Apps',
    status: 'enabled',
    repo: 'hanzoai/console',
    docs: `${DOCS}/accessibility`,
    kind: 'module',
    routes: [{ path: '', component: AccessibilityModule }],
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    icon: Store,
    description: 'Browse and deploy AI models & providers — real pricing, live availability.',
    gcp: 'Marketplace',
    category: 'Apps',
    status: 'enabled',
    repo: 'hanzoai/console',
    docs: `${DOCS}/marketplace`,
    kind: 'module',
    routes: [{ path: '', component: MarketplaceModule }],
  },
  {
    id: 'search',
    label: 'Search',
    icon: Search,
    description: 'Managed search — full-text & hybrid indexes.',
    category: 'Apps',
    status: 'enabled',
    repo: 'hanzoai/search',
    docs: `${DOCS}/search`,
    kind: 'module',
    routes: resourceRoutes({ kind: 'search', productLabel: 'Hanzo Search', connectionHint: 'Use the Search host + key from the connection string.' }),
  },
  {
    // Web Search — the LIVE self-hosted web-search product (SearXNG meta-search +
    // Crawl4AI scrape), served by cloud at `/v1/websearch/*`. A tabbed control panel:
    // live health (a real search probe — no health endpoint), a live Try-Search box
    // over `/v1/websearch/search`, the API reference (both endpoints + curl + how to
    // use it in Chat), the deployed engine set (read-only), and the honest deployed
    // config. Self-hosted, no third-party keys; usage is honestly "not metered yet".
    id: 'websearch',
    label: 'Web Search',
    icon: Search,
    description: 'Search and crawl the web for your agents — self-hosted, no third-party keys.',
    gcp: 'Programmable Search / Vertex AI Search',
    category: 'Apps',
    status: 'enabled',
    repo: 'hanzoai/cloud',
    docs: `${DOCS}/crawl`,
    kind: 'module',
    // `:tab` sub-routes (Overview/Try Search/API/Engines/Config) resolve inside the
    // module, exactly like Functions/GPUs/Models — one route entry, tabbed content.
    // The declared specifics are NON-base slugs so they never collide with the shared
    // Settings/Status/Logs/Metrics base sub-pages (which render real deployment facts).
    routes: [
      { path: '', component: SearchModule },
      { path: ':tab', component: SearchModule },
    ],
    subpages: [
      { slug: 'search', label: 'Try Search' },
      { slug: 'api', label: 'API' },
      { slug: 'engines', label: 'Engines' },
      { slug: 'config', label: 'Config' },
    ],
  },
  {
    // Crawl — the web-to-markdown extraction half of the self-hosted web-search
    // product (Crawl4AI). It is served by the SAME `/v1/websearch/*` subsystem as Web
    // Search, so the Crawl entry renders the SAME `SearchModule` (its API tab documents
    // the scrape endpoint) — one module for the one product, cross-linked, never a
    // duplicate surface. (Was a native-overview stub; upgraded to the real panel.)
    id: 'crawl',
    label: 'Crawl',
    icon: Globe,
    description: 'Crawl and extract the web to clean markdown for your agents — self-hosted (Crawl4AI).',
    gcp: 'Web crawl',
    category: 'Apps',
    status: 'enabled',
    repo: 'hanzoai/cloud',
    docs: `${DOCS}/crawl`,
    kind: 'module',
    routes: [
      { path: '', component: SearchModule },
      { path: ':tab', component: SearchModule },
    ],
    subpages: [
      { slug: 'search', label: 'Try Search' },
      { slug: 'api', label: 'API' },
      { slug: 'engines', label: 'Engines' },
      { slug: 'config', label: 'Config' },
    ],
  },
  {
    id: 'studio',
    label: 'Studio',
    icon: Sparkles,
    description: 'Build AI apps and pipelines visually.',
    category: 'Apps',
    status: 'enabled',
    repo: 'hanzoai/studio',
    docs: `${DOCS}/ai-studio`,
    kind: 'module',
    routes: overviewRoutes('studio'),
  },
  {
    id: 'templates',
    label: 'Templates',
    icon: Blocks,
    description: 'Production-ready starter kits — fork a template and deploy.',
    category: 'Apps',
    status: 'enabled',
    repo: 'hanzoai/gallery',
    docs: `${DOCS}/templates`,
    kind: 'module',
    routes: [{ path: '', component: TemplatesModule }],
  },
  {
    id: 'console',
    label: 'Console',
    icon: Boxes,
    description: 'The unified cloud console — this app.',
    category: 'Apps',
    status: 'enabled',
    repo: 'hanzoai/console',
    docs: `${DOCS}/console`,
    kind: 'module',
    routes: overviewRoutes('console'),
  },

  // ── Commerce — the merchant store dashboard over hanzoai/commerce, per org ────
  //    Products/orders/customers/inventory/promotions read through console2's own
  //    user-bearer `/commerce` proxy (org-scoped server-side); payments (Square)
  //    stay in Billing. Each page is a native in-console module — no subdomain.
  {
    id: 'products',
    label: 'Products',
    icon: Package,
    description: 'Your store catalog — items customers can buy.',
    gcp: 'Commerce',
    category: 'Commerce',
    status: 'enabled',
    repo: 'hanzoai/commerce',
    docs: `${DOCS}/commerce`,
    kind: 'module',
    routes: [{ path: '', component: StoreProductsModule }],
  },
  {
    id: 'orders',
    label: 'Orders',
    icon: ClipboardList,
    description: 'Purchases placed in your store — status, customer, and total.',
    category: 'Commerce',
    status: 'enabled',
    repo: 'hanzoai/commerce',
    docs: `${DOCS}/commerce`,
    kind: 'module',
    routes: [{ path: '', component: StoreOrdersModule }],
  },
  {
    id: 'customers',
    label: 'Customers',
    icon: Users,
    description: 'People who order from or have an account with your store.',
    category: 'Commerce',
    status: 'enabled',
    repo: 'hanzoai/commerce',
    docs: `${DOCS}/commerce`,
    kind: 'module',
    routes: [{ path: '', component: StoreCustomersModule }],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: Boxes,
    description: 'Stock on hand per SKU across your catalog.',
    category: 'Commerce',
    status: 'enabled',
    repo: 'hanzoai/commerce',
    docs: `${DOCS}/commerce`,
    kind: 'module',
    routes: [{ path: '', component: StoreInventoryModule }],
  },
  {
    id: 'promotions',
    label: 'Promotions',
    icon: Tag,
    description: 'Discount codes and promotions customers apply at checkout.',
    category: 'Commerce',
    status: 'enabled',
    repo: 'hanzoai/commerce',
    docs: `${DOCS}/commerce`,
    kind: 'module',
    routes: [{ path: '', component: StorePromotionsModule }],
  },
  {
    id: 'storefront',
    label: 'Store settings',
    icon: Store,
    description: 'Storefront configuration and how payments are processed.',
    category: 'Commerce',
    status: 'enabled',
    repo: 'hanzoai/commerce',
    docs: `${DOCS}/commerce`,
    kind: 'module',
    routes: [{ path: '', component: StoreSettingsModule }],
  },

  // ── Appended modules — ported from hanzoai/console (settings/models + eval engine).
  //    Grouped by `category` (not array position); no entry above is reordered.
  {
    id: 'api-keys',
    label: 'API Keys',
    icon: KeySquare,
    description: 'The cloud API credential for your account — SDKs, CLI, gateway.',
    category: 'Dev',
    status: 'enabled',
    repo: 'hanzoai/iam',
    docs: `${DOCS}/api`,
    kind: 'module',
    routes: [{ path: '', component: ApiKeysModule }],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: SlidersHorizontal,
    description: 'Organization and account settings — name, defaults, and branding.',
    category: 'Settings',
    status: 'enabled',
    repo: 'hanzoai/iam',
    kind: 'module',
    routes: [
      { path: '', component: SettingsModule },
      { path: ':tab', component: SettingsModule },
    ],
    subpages: [{ slug: 'branding', label: 'Branding' }],
  },
  {
    id: 'prompts',
    label: 'Prompts',
    icon: FileText,
    description: 'Versioned prompts with labels and history.',
    category: 'AI',
    status: 'enabled',
    repo: 'hanzoai/o11y',
    docs: `${DOCS}/prompts`,
    kind: 'module',
    routes: [
      { path: '', component: PromptsModule },
      { path: 'new', component: PromptCreateModule },
      { path: 'metrics', component: PromptMetricsModule },
      { path: ':name', component: PromptsModule },
    ],
    subpages: [{ slug: 'metrics', label: 'Metrics' }],
  },
  {
    id: 'datasets',
    label: 'Datasets',
    icon: Database,
    description: 'Curate evaluation datasets and items.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/o11y',
    docs: `${DOCS}/datasets`,
    kind: 'module',
    routes: [
      { path: '', component: DatasetsModule },
      { path: 'items', component: DatasetItemsModule },
      { path: 'runs', component: DatasetRunsModule },
    ],
    subpages: [
      { slug: 'items', label: 'Items' },
      { slug: 'runs', label: 'Runs' },
    ],
  },
  {
    id: 'experiments',
    label: 'Experiments',
    icon: Workflow,
    description: 'Dataset runs, comparisons, and experiment analytics.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/o11y',
    docs: `${DOCS}/experiments`,
    kind: 'module',
    routes: [
      { path: '', component: ExperimentsModule },
      { path: ':tab', component: ExperimentsModule },
    ],
  },
  // ── Observe (appended — grouped by `category`, not array position, so these
  //    render under Observe without reordering existing entries). Native trace
  //    siblings on the REAL /v1/o11y surface: sessions group traces; scores are
  //    evaluation results. Both render honest states when the runtime is 503.
  {
    id: 'sessions',
    label: 'Sessions',
    icon: MessageSquare,
    description: 'Traces grouped into multi-turn sessions.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/o11y',
    docs: `${DOCS}/sessions`,
    kind: 'module',
    routes: [
      { path: '', component: SessionsModule },
      { path: ':id', component: SessionsModule },
    ],
  },
  {
    id: 'scores',
    label: 'Scores',
    icon: ListChecks,
    description: 'Evaluation scores from feedback, graders, and review.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/o11y',
    docs: `${DOCS}/scores`,
    kind: 'module',
    routes: [
      { path: '', component: ScoresModule },
      { path: 'analytics', component: ScoreAnalyticsModule },
    ],
    subpages: [{ slug: 'analytics', label: 'Analytics' }],
  },
  {
    // Native — score DEFINITIONS (data type + valid range/categories) on the REAL
    // /v1/o11y/score-configs surface. Read-only list; honest RuntimeNotice on 503.
    id: 'score-configs',
    label: 'Score Configs',
    icon: Ruler,
    description: 'Score definitions — data types, ranges, and categories.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/o11y',
    docs: `${DOCS}/score-configs`,
    kind: 'module',
    routes: [{ path: '', component: ScoreConfigsModule }],
  },
  {
    // Native — human-review queues on the REAL /v1/o11y/annotation-queues surface.
    // Read-only list; honest RuntimeNotice when the runtime is not initialized.
    id: 'annotation-queues',
    label: 'Annotation Queues',
    icon: ClipboardList,
    description: 'Review queues for scoring traces and observations.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/o11y',
    docs: `${DOCS}/annotation-queues`,
    kind: 'module',
    routes: [
      { path: '', component: AnnotationQueuesModule },
      { path: ':id', component: AnnotationQueuesModule },
    ],
  },
  // ── Appended modules (grouped by `category`, not array position — no entry
  //    above is reordered). Memory + Tasks unify the user's memory and durable
  //    work into the one console, on real /v1 backends with honest states.
  {
    // The user's personal memory — what they've asked the assistant to remember.
    // Per-user, on the /v1/memory backend (hanzoai/ai). `enabled`: the module
    // renders now and shows an honest "initializing" card until the backend is
    // deployed — never fabricated memories.
    id: 'memory',
    label: 'Memory',
    icon: NotebookPen,
    description: 'Your personal memory — searchable, editable, in one place.',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/ai',
    docs: `${DOCS}/memory`,
    kind: 'module',
    routes: [
      { path: '', component: MemoryModule },
      { path: ':id', component: MemoryModule },
    ],
  },
  {
    // Durable workflows + schedules — the user's tasks across all their work.
    // REAL /v1/tasks engine (hanzoai/tasks), org-scoped server-side. The
    // canonical home is the Async category (Tasks/Temporal); maps to GCP Cloud
    // Tasks/Workflows.
    id: 'tasks',
    label: 'Tasks',
    icon: Workflow,
    description: 'Durable workflows and schedules — every running and finished task.',
    gcp: 'Cloud Tasks',
    category: 'Compute',
    status: 'enabled',
    repo: 'hanzoai/tasks',
    docs: `${DOCS}/tasks`,
    kind: 'module',
    routes: [
      { path: '', component: TasksModule },
      { path: ':ns/:wid', component: TasksModule },
    ],
    subpages: [{ slug: 'queues', label: 'Queues' }],
  },

  // ── Settings — org & account administration. Team (members + roles), org
  //    Settings (name/defaults/branding), and the per-user Profile. Member
  //    management runs over the org-scoped `/org/iam` proxy so an ORG admin can
  //    manage their OWN org (not only a global admin), tenant-isolated server-side.
  {
    id: 'team',
    label: 'Team',
    icon: Users,
    description: 'Organization members and roles — invite, assign roles, remove.',
    gcp: 'IAM & Admin',
    category: 'Settings',
    status: 'enabled',
    repo: 'hanzoai/iam',
    docs: `${DOCS}/iam`,
    kind: 'module',
    routes: [
      { path: '', component: TeamModule },
      { path: ':tab', component: TeamModule },
    ],
    subpages: [{ slug: 'roles', label: 'Roles' }],
  },
  {
    id: 'profile',
    label: 'Profile',
    icon: IdCard,
    description: 'Your account — identity, security, and personal API keys.',
    category: 'Settings',
    status: 'enabled',
    repo: 'hanzoai/iam',
    kind: 'module',
    routes: [
      { path: '', component: ProfileModule },
      { path: ':tab', component: ProfileModule },
    ],
    subpages: [
      { slug: 'security', label: 'Security' },
      { slug: 'keys', label: 'API Keys' },
    ],
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

/**
 * Category landing pages resolve at `/category/<slug>` through the SAME router as
 * products — one `ProductModule` with one `:slug` `ProductRoute`, matched by the
 * same `resolveRoute` and rendered by the same catch-all. It is deliberately NOT a
 * `catalog` entry: a category is a GROUPING of products, not a product, so it
 * never shows up as a card in the nav / home / launcher. `CategoryOverview`
 * derives its whole content from the catalog (`visibleCatalogByCategory`).
 */
export const CATEGORY_ROUTE_ID = 'category'
const categoryRouteModule: ProductModule = {
  id: CATEGORY_ROUTE_ID,
  label: 'Category',
  icon: Boxes,
  description: 'Category overview',
  routes: [{ path: ':slug', component: CategoryOverview }],
}

/** The in-console subset, in catalog order, plus the category-landing router. */
export const productModules: ProductModule[] = [
  ...catalog
    .filter((e): e is Extract<CatalogEntry, { kind: 'module' }> => e.kind === 'module')
    .map(({ id, label, icon, description, routes }) => ({ id, label, icon, description, routes })),
  categoryRouteModule,
]

/** Look up an in-console module by id (base path segment). */
export const findModule = (id: string): ProductModule | undefined =>
  productModules.find((m) => m.id === id)

/** Look up any catalog entry by id. */
export const findEntry = (id: string): CatalogEntry | undefined =>
  catalog.find((e) => e.id === id)

/** The catalog grouped by category, in display order, skipping empty groups. */
export const catalogByCategory = (): { category: ProductCategory; entries: CatalogEntry[] }[] =>
  brandCategoryOrder()
    .map((category) => ({ category, entries: catalog.filter((e) => inBrand(e) && e.category === category) }))
    .filter((g) => g.entries.length > 0)

/** An admin-only (global / Hanzo-managed) entry — hidden from a customer's nav. */
export const isAdminEntry = (e: CatalogEntry): boolean => e.admin === true

/**
 * Per-brand category scope — the ONE knob that makes each brand's console show
 * the right surfaces. `hanzo` is the full AI cloud. The sovereign-chain brands
 * (`lux`, `zoo`, `pars`) are **web3 / bootnode admin** consoles: on-chain
 * (Web3), the networks/nodes/peering plane (Network), key + HSM + authz
 * (Security), developer keys/CLI (Dev), and org/account (Settings) — NOT the
 * AI-cloud surfaces (AI, Compute-for-AI, Training, Data, Observe, Apps,
 * Platform). `null` = every category. Adjust a brand by editing one row.
 */
// The pure scope (categoriesForBrand/categoryInBrand/BRAND_CATEGORIES) is
// re-exported above from ./brand-scope. These two wrappers bind it to the
// CURRENT brand (resolved from the request host).

/** Categories the CURRENT brand's console surfaces (all, for hanzo). */
export const brandCategoryOrder = (): ProductCategory[] => categoriesForBrand(config.brand)

/** True when an entry belongs to the CURRENT brand's console — its category is in
 *  the brand's scope AND the entry's own per-brand scope (if any) admits the brand. */
export const inBrand = (e: CatalogEntry): boolean =>
  categoryInBrand(config.brand, e.category) && entryInBrandScope(config.brand, e.brands)

/**
 * The catalog a given user may SEE. A global admin sees everything; a customer
 * (org owner / member) never sees the admin-only surfaces (cross-tenant IAM/KMS,
 * provider + routing config, cluster ops). Access is enforced server-side too —
 * this is the matching nav gate, so a customer never lands on a hostile 403.
 * Also scoped to the current BRAND (lux/zoo = web3/bootnode, hanzo = full).
 */
/** The unified Billing Center entry id — the ONE money surface + the billing-only shell root. */
export const BILLING_CENTER_ID = 'billing'

export const visibleCatalog = (showAdmin: boolean): CatalogEntry[] => {
  // Billing-only shell mode (billing.<brand> host / NEXT_PUBLIC_BILLING_ONLY): the
  // SAME console image, but every surface is filtered to the ONE Billing Center.
  // Bypass the brand-category scope so the center shows on EVERY brand's billing
  // host (Observe isn't in the web3 brands' normal category set). Zero duplication —
  // it's the same catalog entry the full console shows, just alone.
  if (config.billingOnly) {
    const billing = catalog.find((e) => e.id === BILLING_CENTER_ID)
    return billing ? [billing] : []
  }
  return (showAdmin ? catalog : catalog.filter((e) => !isAdminEntry(e))).filter(inBrand)
}

/** `catalogByCategory` scoped to what the user may see (admin surfaces gated). */
export const visibleCatalogByCategory = (
  showAdmin: boolean,
): { category: ProductCategory; entries: CatalogEntry[] }[] => {
  const visible = visibleCatalog(showAdmin)
  // In billing-only mode the Billing Center is the whole catalog — surface it as a
  // single group regardless of the brand's category order (its category may be
  // outside the brand's normal set).
  if (config.billingOnly) {
    return visible.length ? [{ category: visible[0].category, entries: visible }] : []
  }
  return brandCategoryOrder()
    .map((category) => ({ category, entries: visible.filter((e) => e.category === category) }))
    .filter((g) => g.entries.length > 0)
}
