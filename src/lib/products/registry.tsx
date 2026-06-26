/**
 * Product-module registry — the extensibility backbone of the console.
 *
 * "All cloud products" are admin modules. Each module declares its nav label,
 * icon, and routes once, here. The nav shell and router render from this list,
 * so adding a product = adding one `ProductModule` entry — no shell edits.
 *
 * A module is orthogonal: it owns its routes and components, knows nothing about
 * siblings. The registry only composes them.
 */
import type { ComponentType } from 'react'
import {
  Server,
  Route as RouteIcon,
  Boxes,
  Database,
  MessageSquare,
  CreditCard,
  Key,
  Search,
  HardDrive,
  FileText,
  Layers,
  Network,
} from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { ProvidersModule } from '~/components/products/ProvidersModule'
import { ModelsModule } from '~/components/products/ModelsModule'
import { ApplicationsModule } from '~/components/products/ApplicationsModule'
import { StoresModule } from '~/components/products/StoresModule'
import { ChatModule } from '~/components/products/ChatModule'
import { resourceModule } from '~/components/products/ResourceModule'
import { comingSoon, type ProductStatus } from '~/components/products/ComingSoonModule'

/** A Hanzo GUI icon component (e.g. `Server` from `@hanzogui/lucide-icons-2`). */
export type ProductIcon = typeof Server

/** One screen inside a product module. */
export type ProductRoute = {
  /** Path segment under the product, '' for the index. */
  path: string
  /** Rendered surface. Receives the matched route params. */
  component: ComponentType<{ params: Record<string, string> }>
}

/** A cloud product, surfaced as an admin module in the console. */
export type ProductModule = {
  /** Stable id and base path segment, e.g. 'providers'. */
  id: string
  /** Nav label. */
  label: string
  /** Nav icon. */
  icon: ProductIcon
  /** One-line description for the dashboard. */
  description: string
  /**
   * Enablement state — drives the nav badge + landing. Omitted means 'enabled'.
   * 'soon' = the product exists (its repo ships) but its console module isn't
   * wired here yet; 'waitlist' = gauging demand before building it.
   */
  status?: ProductStatus
  /** Source repo for the product, e.g. 'hanzoai/vector'. */
  repo?: string
  /** Screens. The first route ('') is the module landing. */
  routes: ProductRoute[]
}

/**
 * The registered cloud products. Order here is nav order.
 *
 * To add a product: implement its module component(s) and append an entry.
 */
export const productModules: ProductModule[] = [
  {
    id: 'providers',
    label: 'Providers',
    icon: Server,
    description: 'Model, storage, and embedding providers.',
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
    routes: [
      { path: '', component: ModelsModule },
      { path: ':name', component: ModelsModule },
    ],
  },
  {
    id: 'applications',
    label: 'Applications',
    icon: Boxes,
    description: 'Deployed applications.',
    routes: [
      { path: '', component: ApplicationsModule },
      { path: ':name', component: ApplicationsModule },
    ],
  },
  {
    id: 'stores',
    label: 'Stores',
    icon: Database,
    description: 'Knowledge stores and vectors.',
    routes: [
      { path: '', component: StoresModule },
      { path: ':name', component: StoresModule },
    ],
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: MessageSquare,
    description: 'Chat sessions and history.',
    routes: [
      { path: '', component: ChatModule },
      { path: ':name', component: ChatModule },
    ],
  },

  // ── Data & storage — Hanzo Cloud as an OSS Google Cloud. Each is a ZAP-native
  //    Hanzo fork (NOT vanilla OSS), provisioned through the shared `resourceModule`
  //    factory over the provisioning contract (POST/GET/DELETE /v1/<kind>). The
  //    per-product `kind` is the only thing that varies. Base has no single
  //    logical-resource concept yet, so it stays a 'soon' placeholder.
  {
    id: 'vector', label: 'Vector', icon: Boxes, repo: 'hanzoai/vector',
    description: 'Managed vector database — embeddings & semantic search.',
    routes: [{ path: '', component: resourceModule({ kind: 'vector', productLabel: 'Hanzo Vector', connectionHint: 'Point a Vector client at host:port using the connection string.' }) }],
  },
  {
    id: 'sql', label: 'SQL', icon: Database, repo: 'hanzoai/sql',
    description: 'Managed SQL — databases, branches, replicas.',
    routes: [{ path: '', component: resourceModule({ kind: 'sql', productLabel: 'Hanzo SQL', connectionHint: 'Connect any SQL client with the connection string.' }) }],
  },
  {
    id: 'datastore', label: 'Datastore', icon: Server, repo: 'hanzoai/datastore',
    description: 'Managed columnar analytics (OLAP).',
    routes: [{ path: '', component: resourceModule({ kind: 'datastore', productLabel: 'Hanzo Datastore', connectionHint: 'Connect over the Datastore HTTP/native protocol using the connection string.' }) }],
  },
  {
    id: 'kv', label: 'KV', icon: Key, repo: 'hanzoai/kv',
    description: 'Managed key-value store — cache & queues.',
    routes: [{ path: '', component: resourceModule({ kind: 'kv', productLabel: 'Hanzo KV', connectionHint: 'Connect with any KV client using the connection string.' }) }],
  },
  {
    id: 'search', label: 'Search', icon: Search, repo: 'hanzoai/search',
    description: 'Managed search — full-text & hybrid indexes.',
    routes: [{ path: '', component: resourceModule({ kind: 'search', productLabel: 'Hanzo Search', connectionHint: 'Use the Search host + key from the connection string.' }) }],
  },
  {
    id: 's3', label: 'S3', icon: HardDrive, repo: 'hanzoai/s3',
    description: 'Managed object storage — S3 buckets.',
    routes: [{ path: '', component: resourceModule({ kind: 's3', productLabel: 'Hanzo S3', connectionHint: 'Use as an S3 endpoint with the access key/secret in the connection string.' }) }],
  },
  {
    id: 'base', label: 'Base', icon: Layers, status: 'soon', repo: 'hanzoai/base',
    description: 'Managed app backend — embedded DB + auth + realtime.',
    routes: [{ path: '', component: comingSoon({ label: 'Hanzo Base', repo: 'hanzoai/base', status: 'soon', blurb: 'Managed application backend — Hanzo Base. Embedded SQL + auth + realtime + file storage in one deploy, IAM-native.' }) }],
  },
  {
    id: 'docdb', label: 'DocDB', icon: FileText, repo: 'hanzoai/docdb',
    description: 'Managed document database.',
    routes: [{ path: '', component: resourceModule({ kind: 'docdb', productLabel: 'Hanzo DocDB', connectionHint: 'Connect with any DocDB driver using the connection string.' }) }],
  },

  // ── Infrastructure — where workloads run. Deploying any repo is the role of
  //    the Applications module above (connect → build → deploy). Clusters is the
  //    one new control-plane surface: pick *where* — shared Hanzo Cloud (zero-ops,
  //    multi-tenant) or your own / Hanzo-provisioned DOKS cluster, reconciled by
  //    the same operator. One control plane, many targets.
  {
    id: 'clusters', label: 'Clusters', icon: Network, status: 'soon', repo: 'hanzoai/operator',
    description: 'Your Kubernetes — shared Hanzo Cloud or your own DOKS.',
    routes: [{ path: '', component: comingSoon({ label: 'Hanzo Clusters', repo: 'hanzoai/operator', status: 'soon', blurb: 'One control plane for where your workloads run — choose zero-ops shared Hanzo Cloud or bring your own DOKS cluster, both reconciled by the Hanzo operator.' }) }],
  },
]

/** Look up a module by id (base path segment). */
export const findModule = (id: string): ProductModule | undefined =>
  productModules.find((m) => m.id === id)

/** A nav item that opens an external Hanzo surface (not an in-console route). */
export type ExternalNavLink = {
  id: string
  label: string
  icon: ProductIcon
  href: string
}

/**
 * External products surfaced in the nav but owned by other services — opened in
 * a new tab, never reimplemented here. Billing is hanzoai/commerce (backend) +
 * hanzoai/billing (portal); the console links to it.
 */
export const externalLinks: ExternalNavLink[] = [
  { id: 'billing', label: 'Billing', icon: CreditCard, href: config.billingUrl },
]
