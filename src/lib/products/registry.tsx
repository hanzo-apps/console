/**
 * Product catalog — the single source of truth for the unified console.
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
 * Taxonomy: the SAME ten categories — exact labels and order — as the canonical
 * "Open AI Cloud" menu, presented as the open-source equivalent of Google Cloud.
 * Each entry names the Google Cloud product it stands in for (`gcp`), and carries
 * an honest enablement `status`: an in-console module that works (`enabled`), a
 * live external Hanzo surface (`external`), or a primitive that ships but has no
 * console surface yet (`soon`). No fabricated states.
 */
import type { ComponentType } from 'react'
import {
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
  Repeat,
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
import { ObservabilityModule } from '~/components/products/ObservabilityModule'
import { StatusModule } from '~/components/products/StatusModule'
import { PlaygroundModule } from '~/components/products/PlaygroundModule'
import { PromptsModule } from '~/components/products/PromptsModule'
import { EvalsModule } from '~/components/products/EvalsModule'
import { DatasetsModule } from '~/components/products/DatasetsModule'
import { resourceRoutes } from '~/components/products/ResourceModule'
import { ComingSoon } from '~/components/products/ComingSoon'

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
 * The ten canonical "Open AI Cloud" categories — exact labels and order. The
 * marketing site, the console nav, the catalog overview, and the discover
 * screens all read this one taxonomy. `catalogByCategory` skips empty groups.
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
  console: 'https://console.hanzo.ai',
  projects: config.platformUrl,
  cost: config.billingUrl,
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
  // ── AI ───────────────────────────────────────────────────────────────
  {
    id: 'models',
    label: 'Models',
    icon: Brain,
    description: 'Model catalog and routing policy across providers.',
    gcp: 'Model Garden',
    category: 'AI',
    status: 'enabled',
    repo: 'hanzoai/ai',
    kind: 'module',
    routes: [
      { path: '', component: ModelsModule },
      { path: ':name', component: ModelsModule },
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
    status: 'soon',
    repo: 'hanzoai/agent',
    docs: `${DOCS}/agents`,
    kind: 'module',
    routes: soonRoutes,
  },
  {
    id: 'inference',
    label: 'Inference',
    icon: Zap,
    description: 'Online and batch inference for deployed models.',
    gcp: 'Vertex AI Prediction',
    category: 'AI',
    status: 'soon',
    kind: 'module',
    routes: soonRoutes,
  },
  {
    id: 'finetuning',
    label: 'Fine-tuning',
    icon: Sparkles,
    description: 'Fine-tune and train models on your own data.',
    gcp: 'Vertex AI Training',
    category: 'AI',
    status: 'soon',
    kind: 'module',
    routes: soonRoutes,
  },
  {
    id: 'embeddings',
    label: 'Embeddings',
    icon: Boxes,
    description: 'Knowledge stores and vector indexes for retrieval.',
    category: 'AI',
    status: 'enabled',
    kind: 'module',
    routes: [
      { path: '', component: StoresModule },
      { path: ':name', component: StoresModule },
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
    description: 'On-demand GPU compute for training and inference.',
    category: 'Compute',
    status: 'soon',
    kind: 'module',
    routes: soonRoutes,
  },
  {
    id: 'machines',
    label: 'Machines',
    icon: Server,
    description: 'Virtual machines and bare-metal compute.',
    category: 'Compute',
    status: 'soon',
    docs: `${DOCS}/machines`,
    kind: 'module',
    routes: soonRoutes,
  },
  {
    id: 'containers',
    label: 'Containers',
    icon: Container,
    description: 'Run containers as managed, autoscaling services.',
    gcp: 'Cloud Run',
    category: 'Compute',
    status: 'soon',
    kind: 'module',
    routes: soonRoutes,
  },
  {
    id: 'functions',
    label: 'Functions',
    icon: FunctionSquare,
    description: 'Event-driven serverless functions.',
    category: 'Compute',
    status: 'soon',
    repo: 'hanzoai/functions',
    docs: `${DOCS}/functions`,
    kind: 'module',
    routes: soonRoutes,
  },
  {
    id: 'edge',
    label: 'Edge',
    icon: Radio,
    description: 'Compute at the edge, close to your users.',
    category: 'Compute',
    status: 'soon',
    repo: 'hanzoai/edge',
    docs: `${DOCS}/edge`,
    kind: 'module',
    routes: soonRoutes,
  },
  {
    id: 'jobs',
    label: 'Jobs',
    icon: Repeat,
    description: 'Scheduled and batch jobs that run to completion.',
    category: 'Compute',
    status: 'soon',
    kind: 'module',
    routes: soonRoutes,
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
    status: 'soon',
    kind: 'module',
    routes: soonRoutes,
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
    status: 'soon',
    kind: 'module',
    routes: soonRoutes,
  },
  {
    id: 'service-mesh',
    label: 'Service Mesh',
    icon: Waypoints,
    description: 'Service-to-service routing, mTLS, and policy.',
    category: 'Network',
    status: 'soon',
    kind: 'module',
    routes: soonRoutes,
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
    status: 'soon',
    repo: 'hanzoai/authz',
    docs: `${DOCS}/authz`,
    kind: 'module',
    routes: soonRoutes,
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
    status: 'soon',
    repo: 'hanzoai/hsm',
    kind: 'module',
    routes: soonRoutes,
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
    description: 'Projects and resource organization — Hanzo PaaS.',
    gcp: 'Resource Manager',
    category: 'Deploy',
    status: 'external',
    repo: 'hanzoai/platform',
    kind: 'external',
    href: ext.projects,
  },
  {
    id: 'environments',
    label: 'Environments',
    icon: Layers,
    description: 'Promote builds across dev, staging, and prod.',
    category: 'Deploy',
    status: 'soon',
    kind: 'module',
    routes: soonRoutes,
  },
  {
    id: 'builds',
    label: 'Builds',
    icon: Hammer,
    description: 'Build images and artifacts from source.',
    category: 'Deploy',
    status: 'soon',
    kind: 'module',
    routes: soonRoutes,
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
    status: 'soon',
    kind: 'module',
    routes: soonRoutes,
  },
  {
    id: 'pipelines',
    label: 'Pipelines',
    icon: GitBranch,
    description: 'CI/CD pipelines from commit to deploy.',
    category: 'Deploy',
    status: 'soon',
    docs: `${DOCS}/pipelines`,
    kind: 'module',
    routes: soonRoutes,
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
    // Real, enabled — browse workloads + operator custom resources per cluster,
    // via the PaaS control plane (/paas → platform). Honest states if not live.
    id: 'kubernetes',
    label: 'Kubernetes',
    icon: Boxes,
    description: 'Workloads and operator custom resources, per cluster.',
    category: 'Deploy',
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
    status: 'soon',
    repo: 'hanzoai/o11y',
    docs: `${DOCS}/logs`,
    kind: 'module',
    routes: soonRoutes,
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
    // Console-native observability — probes the real /v1/o11y runtime and links
    // to the full surface for traces/evals/prompts. Honest 503 if uninitialized.
    id: 'o11y',
    label: 'Traces',
    icon: Activity,
    description: 'Traces, evals, and prompts for your AI workloads.',
    category: 'Observe',
    status: 'enabled',
    repo: 'hanzoai/o11y',
    docs: `${DOCS}/traces`,
    kind: 'module',
    routes: [{ path: '', component: ObservabilityModule }],
  },
  {
    id: 'dashboards',
    label: 'Dashboards',
    icon: LineChart,
    description: 'Product analytics and observability dashboards.',
    category: 'Observe',
    status: 'external',
    repo: 'hanzoai/analytics',
    docs: `${DOCS}/dashboards`,
    kind: 'external',
    href: ext.dashboards,
  },
  {
    id: 'alerts',
    label: 'Alerts',
    icon: Bell,
    description: 'Alerting rules and notification policies.',
    category: 'Observe',
    status: 'soon',
    repo: 'hanzoai/o11y',
    kind: 'module',
    routes: soonRoutes,
  },
  {
    id: 'cost',
    label: 'Cost',
    icon: CreditCard,
    description: 'Balance, usage, and invoices for every product.',
    gcp: 'Cloud Billing',
    category: 'Observe',
    status: 'external',
    repo: 'hanzoai/billing',
    docs: `${DOCS}/billing`,
    kind: 'external',
    href: ext.cost,
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
    status: 'soon',
    repo: 'hanzoai/ledger',
    docs: `${DOCS}/blockchain`,
    kind: 'module',
    routes: soonRoutes,
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
    id: 'tokens',
    label: 'Tokens',
    icon: Coins,
    description: 'Issue and manage tokens and balances.',
    category: 'Web3',
    status: 'soon',
    repo: 'hanzoai/treasury',
    kind: 'module',
    routes: soonRoutes,
  },
  {
    id: 'indexer',
    label: 'Indexer',
    icon: Database,
    description: 'Index and query on-chain data.',
    category: 'Web3',
    status: 'soon',
    kind: 'module',
    routes: soonRoutes,
  },
  {
    id: 'oracles',
    label: 'Oracles',
    icon: Radio,
    description: 'Bring off-chain data on-chain.',
    category: 'Web3',
    status: 'soon',
    kind: 'module',
    routes: soonRoutes,
  },
  {
    id: 'attestations',
    label: 'Attestations',
    icon: ShieldCheck,
    description: 'Verifiable attestations and proofs.',
    category: 'Web3',
    status: 'soon',
    kind: 'module',
    routes: soonRoutes,
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

  // ── Ported from the old console (Langfuse-fork) eval engine. Appended (not
  //    reordered); grouped by `category` like every other entry. Prompts has no
  //    /v1 read route yet (honest probe + deep-link); Datasets writes are real.
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
    routes: [{ path: '', component: PromptsModule }],
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
    routes: [{ path: '', component: DatasetsModule }],
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
