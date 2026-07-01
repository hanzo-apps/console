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
 * order — as the open-source equivalent of Google Cloud. Each entry names the
 * Google Cloud product it stands in
 * for (`gcp`), and carries
 * an honest enablement `status`: an in-console module that works (`enabled`), a
 * live external Hanzo surface (`external`), or a primitive that ships but has no
 * console surface yet (`soon`). No fabricated states.
 */
import type { ComponentType } from 'react'
import { Users,
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
} from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { ProvidersModule } from '~/components/products/ProvidersModule'
import { ModelsModule } from '~/components/products/ModelsModule'
import { ApplicationsModule } from '~/components/products/ApplicationsModule'
import { EmbeddingsModule } from '~/components/products/EmbeddingsModule'
import { ChatModule } from '~/components/products/ChatModule'
import { BotModule } from '~/components/products/BotModule'
import { PlansModule } from '~/components/products/PlansModule'
import { CostModule } from '~/components/products/CostModule'
import { WalletModule } from '~/components/products/WalletModule'
import { IamModule, AuditModule } from '~/components/products/AdminModule'
import { KmsModule } from '~/components/products/KmsModule'
import { BaseModule } from '~/components/products/BaseModule'
import { ClustersModule } from '~/components/products/ClustersModule'
import { KubernetesModule } from '~/components/products/KubernetesModule'
import { TracesModule } from '~/components/products/TracesModule'
import { AiMetricsModule } from '~/components/products/AiMetricsModule'
import { ObservationsModule } from '~/components/products/ObservationsModule'
import { UsersModule } from '~/components/products/UsersModule'
import { SessionsModule } from '~/components/products/SessionsModule'
import { ScoresModule } from '~/components/products/ScoresModule'
import { StatusModule } from '~/components/products/StatusModule'
import { PlaygroundModule } from '~/components/products/PlaygroundModule'
import { PromptCreateModule, PromptMetricsModule, PromptsModule } from '~/components/products/PromptsModule'
import { EvalsModule } from '~/components/products/EvalsModule'
import { DatasetItemsModule, DatasetRunsModule, DatasetsModule } from '~/components/products/DatasetsModule'
import { resourceRoutes } from '~/components/products/ResourceModule'
import { ComingSoon } from '~/components/products/ComingSoon'
import { ApiKeysModule } from '~/components/products/ApiKeysModule'
import { SettingsModule } from '~/components/products/SettingsModule'
import { ScoreConfigsModule } from '~/components/products/ScoreConfigsModule'
import { AnnotationQueuesModule } from '~/components/products/AnnotationQueuesModule'
import { MemoryModule } from '~/components/products/MemoryModule'
import { TasksModule } from '~/components/products/TasksModule'
import { AttestationsModule } from '~/components/products/AttestationsModule'
import { ProjectsModule } from '~/components/products/ProjectsModule'
import { OraclesModule } from '~/components/products/OraclesModule'
import { IndexerModule } from '~/components/products/IndexerModule'
import { TokensModule } from '~/components/products/TokensModule'
import { SettlementModule } from '~/components/products/SettlementModule'
import { AlertsModule } from '~/components/products/AlertsModule'
import { LogsModule } from '~/components/products/LogsModule'
import { PipelinesModule } from '~/components/products/PipelinesModule'
import { ReleasesModule } from '~/components/products/ReleasesModule'
import { BuildsModule } from '~/components/products/BuildsModule'
import { EnvironmentsModule } from '~/components/products/EnvironmentsModule'
import { HsmModule } from '~/components/products/HsmModule'
import { AuthzModule } from '~/components/products/AuthzModule'
import { ServiceMeshModule } from '~/components/products/ServiceMeshModule'
import { LoadBalancerModule } from '~/components/products/LoadBalancerModule'
import { VpcModule } from '~/components/products/VpcModule'
import { EdgeModule } from '~/components/products/EdgeModule'
import { FunctionsModule } from '~/components/products/FunctionsModule'
import { ContainersModule } from '~/components/products/ContainersModule'
import { MachinesModule } from '~/components/products/MachinesModule'
import { GpusModule } from '~/components/products/GpusModule'
import { FinetuningModule } from '~/components/products/FinetuningModule'
import { InferenceModule } from '~/components/products/InferenceModule'
import { AgentsModule } from '~/components/products/AgentsModule'
import OverviewDashboard from '~/components/products/OverviewModule'
import {
  DashboardsModule,
  ExperimentsModule,
  IntegrationsModule,
  ReferralsModule,
  ScoreAnalyticsModule,
} from '~/components/products/ConsoleFeatureModule'
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
 * The canonical "Open AI Cloud" categories — the ten GCP-equivalent groups in
 * exact label + order. The marketing site, the console nav, the catalog overview,
 * and the discover screens all read this one taxonomy. `catalogByCategory` skips
 * empty groups.
 */
export type ProductCategory =
  | 'AI'
  | 'Compute'
  | 'Data'
  | 'Network'
  | 'Security'
  | 'Dev'
  | 'Deploy'
  | 'Observe'
  | 'Web3'
  | 'Apps'

export const categoryOrder: ProductCategory[] = [
  'AI',
  'Compute',
  'Data',
  'Network',
  'Security',
  'Dev',
  'Deploy',
  'Observe',
  'Web3',
  'Apps',
]

/**
 * Enablement state — honest, three values only:
 *  - `enabled`  : an in-console module that works now (opens straight in).
 *  - `external` : a live external Hanzo surface (opens in a new tab).
 *  - `soon`     : the primitive ships but has no console surface yet; the entry
 *                 opens an honest "coming soon" page pointing at the API/CLI.
 */
export type ProductStatus = 'enabled' | 'external' | 'soon'

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
}

/**
 * A catalog entry is EITHER an in-console module (owns routes) OR an external
 * surface (owned by another service, opened in a new tab). Discriminated on
 * `kind` so consumers branch exhaustively. `enabled`/`soon` are modules;
 * `external` opens a tab.
 */
export type CatalogEntry =
  | (CatalogBase & { kind: 'module'; routes: ProductRoute[] })
  | (CatalogBase & { kind: 'external'; href: string })

const DOCS = 'https://docs.hanzo.ai'

/** Canonical external product surfaces (public product domains, not secrets). */
const ext = {
  gateway: 'https://api.hanzo.ai',
  dns: `${DOCS}/dns`,
  cdn: `${DOCS}/cdn`,
  cli: `${DOCS}/cli`,
  sdk: `${DOCS}/sdk`,
  api: `${DOCS}/api`,
  ide: `${DOCS}/code`,
  desktop: `${DOCS}/desktop`,
  registry: 'https://github.com/orgs/hanzoai/packages',
  metrics: 'https://insights.hanzo.ai',
  dashboards: 'https://analytics.hanzo.ai',
  crawl: 'https://crawl.hanzo.ai',
  studio: 'https://studio.hanzo.ai',
  console: 'https://cloud.hanzo.ai',
  projects: config.platformUrl,
  cost: config.billingUrl,
  mpc: 'https://mpc.hanzo.ai',
} as const

/**
 * The shared "coming soon" surface for a `soon` entry — an honest page that
 * resolves itself from the path and points at the API/CLI. ONE component for
 * every `soon` leaf (DRY), so a soon entry is just `routes: soonRoutes`.
 */
const soonRoutes: ProductRoute[] = [{ path: '', component: ComingSoon }]

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
    repo: 'hanzoai/console2',
    kind: 'module',
    routes: [{ path: '', component: OverviewDashboard }],
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
  },
  {
    id: 'providers',
    label: 'Providers',
    icon: Server,
    description: 'Model, storage, and embedding providers and credentials.',
    category: 'AI',
    status: 'enabled',
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
    kind: 'module',
    routes: [{ path: '', component: InferenceModule }],
  },
  {
    id: 'finetuning',
    label: 'Fine-tuning',
    icon: Sparkles,
    description: 'Fine-tune and train models on your own data.',
    gcp: 'Vertex AI Training',
    category: 'AI',
    status: 'enabled',
    repo: 'hanzoai/ai',
    kind: 'module',
    routes: [
      { path: '', component: FinetuningModule },
      { path: ':tab', component: FinetuningModule },
    ],
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
    routes: [
      { path: '', component: GpusModule },
      { path: ':tab', component: GpusModule },
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
    description: 'Workloads, pods, images, and events across your clusters.',
    gcp: 'Cloud Run',
    category: 'Compute',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/operator',
    kind: 'module',
    routes: [
      { path: '', component: ContainersModule },
      { path: ':tab', component: ContainersModule },
    ],
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
    routes: [{ path: '', component: FunctionsModule }],
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
    id: 's3',
    label: 'Object Storage',
    icon: HardDrive,
    description: 'Managed object storage — S3-compatible buckets.',
    gcp: 'Cloud Storage',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/storage',
    docs: `${DOCS}/storage`,
    kind: 'module',
    routes: resourceRoutes({ kind: 's3', productLabel: 'Hanzo Object Storage', connectionHint: 'Use as an S3 endpoint with the access key/secret in the connection string.' }),
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
    // Embeds the @hanzo/superbase-dashboard screens (the SAME ones that run
    // standalone at base.hanzo.ai). `''` is the tenants list (+ detail drawer);
    // `new` is the create form. Data flows through console2's `/superbase/*`
    // proxy (per-user IAM bearer minted server-side).
    id: 'base',
    label: 'Base',
    icon: Boxes,
    description: 'Multi-tenant Hanzo Base — provision and manage tenant instances.',
    gcp: 'Firebase',
    category: 'Data',
    status: 'enabled',
    repo: 'hanzoai/superbase',
    docs: `${DOCS}/base`,
    kind: 'module',
    routes: [
      { path: '', component: BaseModule },
      { path: 'new', component: BaseModule },
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
    status: 'external',
    repo: 'hanzoai/gateway',
    kind: 'external',
    href: ext.gateway,
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
    status: 'external',
    repo: 'hanzoai/dns',
    docs: ext.dns,
    kind: 'external',
    href: ext.dns,
  },
  {
    id: 'cdn',
    label: 'CDN',
    icon: Cable,
    description: 'Global content delivery and edge caching.',
    category: 'Network',
    status: 'external',
    docs: ext.cdn,
    kind: 'external',
    href: ext.cdn,
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
    status: 'external',
    repo: 'hanzoai/mpc',
    docs: `${DOCS}/mpc`,
    kind: 'external',
    href: ext.mpc,
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
    status: 'external',
    repo: 'hanzoai/cli',
    docs: ext.cli,
    kind: 'external',
    href: ext.cli,
  },
  {
    id: 'sdks',
    label: 'SDKs',
    icon: Package,
    description: 'Python, TypeScript, Go, and Rust SDKs.',
    category: 'Dev',
    status: 'external',
    docs: ext.sdk,
    kind: 'external',
    href: ext.sdk,
  },
  {
    id: 'api',
    label: 'API',
    icon: Code2,
    description: 'The REST API reference for every service.',
    category: 'Dev',
    status: 'external',
    repo: 'hanzoai/ai',
    docs: ext.api,
    kind: 'external',
    href: ext.api,
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
    status: 'external',
    repo: 'hanzoai/code',
    docs: ext.ide,
    kind: 'external',
    href: ext.ide,
  },
  {
    id: 'desktop',
    label: 'Desktop',
    icon: Monitor,
    description: 'The Hanzo desktop app.',
    category: 'Dev',
    status: 'external',
    repo: 'hanzoai/desktop',
    docs: ext.desktop,
    kind: 'external',
    href: ext.desktop,
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
    category: 'Deploy',
    status: 'enabled',
    repo: 'hanzoai/console2',
    kind: 'module',
    routes: [{ path: '', component: ProjectsModule }],
  },
  {
    id: 'environments',
    label: 'Environments',
    icon: Layers,
    description: 'Promote builds across dev, staging, and prod.',
    category: 'Deploy',
    status: 'enabled',
    kind: 'module',
    routes: [{ path: '', component: EnvironmentsModule }],
  },
  {
    id: 'builds',
    label: 'Builds',
    icon: Hammer,
    description: 'Build images and artifacts from source.',
    category: 'Deploy',
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
    category: 'Deploy',
    status: 'external',
    repo: 'hanzoai/registry',
    docs: `${DOCS}/registry`,
    kind: 'external',
    href: ext.registry,
  },
  {
    id: 'releases',
    label: 'Releases',
    icon: Rocket,
    description: 'Versioned releases and rollbacks.',
    category: 'Deploy',
    status: 'enabled',
    kind: 'module',
    routes: [{ path: '', component: ReleasesModule }],
  },
  {
    id: 'pipelines',
    label: 'Pipelines',
    icon: GitBranch,
    description: 'CI/CD pipelines from commit to deploy.',
    category: 'Deploy',
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
    category: 'Deploy',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/operator',
    kind: 'module',
    routes: [{ path: '', component: ClustersModule }],
  },
  {
    // Real, enabled — the org's dedicated DOKS clusters (capacity, health) +
    // provisioning, via the PaaS control plane (/paas → platform). Honest states
    // when the service token isn't set or the caller isn't a brand admin.
    id: 'kubernetes',
    label: 'Kubernetes',
    icon: Boxes,
    description: 'Your Kubernetes clusters — capacity, health, and provisioning.',
    category: 'Compute',
    status: 'enabled',
    admin: true,
    repo: 'hanzoai/operator',
    kind: 'module',
    routes: [{ path: '', component: KubernetesModule }],
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
    description: 'Product metrics, events, and sessions.',
    category: 'Observe',
    status: 'external',
    repo: 'hanzoai/insights',
    docs: `${DOCS}/metrics`,
    kind: 'external',
    href: ext.metrics,
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
    routes: [{ path: '', component: AiMetricsModule }],
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
    // Native — the tenant's balance, metered usage by product/model, and invoice
    // history over the per-tenant `/billing/*` commerce proxy. Read-only; paying +
    // payment methods stay in the brand billing portal (the "Add credits" CTA).
    id: 'cost',
    label: 'Cost',
    icon: CreditCard,
    description: 'Balance, usage, and invoices for every product.',
    gcp: 'Cloud Billing',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/billing',
    docs: `${DOCS}/billing`,
    kind: 'module',
    routes: [{ path: '', component: CostModule }],
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
    id: 'crawl',
    label: 'Crawl',
    icon: Globe,
    description: 'Crawl and extract the web for your agents.',
    category: 'Apps',
    status: 'external',
    kind: 'external',
    href: ext.crawl,
  },
  {
    id: 'studio',
    label: 'Studio',
    icon: Sparkles,
    description: 'Build AI apps and pipelines visually.',
    category: 'Apps',
    status: 'external',
    repo: 'hanzoai/studio',
    docs: `${DOCS}/ai-studio`,
    kind: 'external',
    href: ext.studio,
  },
  {
    id: 'console',
    label: 'Console',
    icon: Boxes,
    description: 'The unified cloud console — this app.',
    category: 'Apps',
    status: 'external',
    repo: 'hanzoai/console',
    docs: `${DOCS}/console`,
    kind: 'external',
    href: ext.console,
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
    description: 'Account, organization, API keys, and branding.',
    category: 'Security',
    status: 'enabled',
    repo: 'hanzoai/iam',
    kind: 'module',
    routes: [
      { path: '', component: SettingsModule },
      { path: ':tab', component: SettingsModule },
    ],
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
    // Durable workflows, schedules, queues, workers, activities — a Temporal-style
    // console over the REAL tasks engine (hanzoai/tasks), org-scoped server-side.
    // Under Compute; maps to GCP Cloud Tasks/Workflows. Tabs are `:tab` sub-routes.
    id: 'tasks',
    label: 'Tasks',
    icon: Workflow,
    description: 'Orchestrate, monitor, and debug durable workflows powered by Temporal.',
    gcp: 'Cloud Tasks',
    category: 'Compute',
    status: 'enabled',
    repo: 'hanzoai/tasks',
    docs: `${DOCS}/tasks`,
    kind: 'module',
    routes: [
      { path: '', component: TasksModule },
      { path: ':tab', component: TasksModule },
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
