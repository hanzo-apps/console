/**
 * Platform API — the Hanzo PaaS control plane (platform.hanzo.ai/v1), the source
 * of LIVE deploy data for the Clusters, Kubernetes and Status modules.
 *
 * ONE transport: every call goes through console2's own same-origin `/paas/*`
 * proxy (app/paas/[...path]/route.ts), which injects the service token from
 * server-only env (KMS-sourced, never NEXT_PUBLIC) and forwards to
 * `platform.hanzo.ai/v1/*`. The token never reaches the browser, there is no
 * CORS, and an unset token yields an honest 501 ("not configured") — never
 * fabricated data.
 *
 * Two real platform surfaces back these modules (confirmed against the live
 * /v1 REST handlers, all guarded by the shared service bearer token):
 *   - GET /v1/org/{org}/cluster  → the org's dedicated DOKS clusters.
 *   - GET /v1/apps               → the live workload / drift board: one row per
 *                                  running (org, app, env) with its cluster,
 *                                  namespace, image tags and computed health.
 * Both return `{ <key>: [...] }`; `asList` unwraps to a plain array.
 */
import { config } from '~/config'
import { restGet, restPost, restDelete } from './client'

/** Same-origin PaaS proxy path. The proxy prefixes `/v1/` and attaches the token. */
const url = (path: string) => `/paas/${path.replace(/^\/+/, '')}`

/** Unwrap a platform list payload (`[...]` or `{ <key>: [...] }`) to an array. */
function asList<T>(raw: unknown, key: string): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (raw && typeof raw === 'object') {
    const v = (raw as Record<string, unknown>)[key]
    if (Array.isArray(v)) return v as T[]
  }
  return []
}

// ── Clusters — dedicated DOKS per org (/v1/org/{org}/cluster) ──────────────────

/** Where a cluster lives: shared multi-tenant Hanzo Cloud, or a BYO/managed DOKS. */
export type ClusterKind = 'shared' | 'byo' | (string & {})

/** A Kubernetes cluster surfaced in the console. */
export type Cluster = {
  id?: string
  name: string
  status: string
  kind?: ClusterKind
  region?: string
  nodeSize?: string
  nodeCount?: number
  version?: string
  endpoint?: string
  createdAt?: string
}

/** Provision a fresh DOKS cluster. */
export type ProvisionClusterInput = {
  name: string
  region: string
  nodeSize: string
  nodeCount: number
}

/** Attach an existing cluster the operator should reconcile into. */
export type AttachClusterInput = {
  name: string
  kubeconfig: string
}

/** Platform scopes dedicated clusters by org: /v1/org/{org}/cluster. */
const clusterBase = (): string => `org/${encodeURIComponent(config.iamOrgName)}/cluster`

export const PlatformApi = {
  listClusters: async (): Promise<Cluster[]> =>
    asList<Cluster>(await restGet(url(clusterBase())), 'clusters'),

  provisionCluster: (input: ProvisionClusterInput) =>
    restPost<Cluster>(url(clusterBase()), input),

  attachCluster: (input: AttachClusterInput) =>
    restPost<Cluster>(url(`${clusterBase()}/attach`), input),

  removeCluster: (id: string) => restDelete(url(`${clusterBase()}/${encodeURIComponent(id)}`)),
}

// ── Apps — the live workload / drift board (/v1/apps) ─────────────────────────
// One row per running (org, app, env): its cluster, namespace, declared vs
// running image tag, and computed health. This is the real deploy data the
// Kubernetes and Status modules render — no fabrication. `org` here is the
// upstream GitHub org the image is built from (e.g. hanzoai, luxfi), not the IAM
// org slug, so the board spans every workload the platform observes.

export type AppHealth = 'green' | 'yellow' | 'red' | (string & {})

export type App = {
  id: string
  org: string
  app: string
  env: string
  repo?: string
  registry?: string
  declaredTag?: string
  runningTag?: string
  latestTag?: string | null
  health?: AppHealth
  cluster?: string
  namespace?: string
  lastObserved?: string
  updatedAt?: string
  drift?: { severity?: string; flags?: string[] }
}

export const AppsApi = {
  listApps: async (): Promise<App[]> => asList<App>(await restGet(url('apps')), 'apps'),
}

/** Human label + StatusTag tone for a drift-board health value. */
export const healthLabel = (h?: string): string =>
  h === 'green' ? 'healthy' : h === 'yellow' ? 'warning' : h === 'red' ? 'down' : (h ?? 'unknown')

/** DOKS regions offered for provisioning (DigitalOcean Kubernetes). */
export const DOKS_REGIONS = [
  'nyc1',
  'nyc3',
  'sfo3',
  'ams3',
  'fra1',
  'lon1',
  'tor1',
  'blr1',
  'sgp1',
  'syd1',
] as const

/** DOKS node sizes (slug — vCPU/RAM). Curated subset of DigitalOcean droplets. */
export const DOKS_NODE_SIZES = [
  's-2vcpu-2gb',
  's-2vcpu-4gb',
  's-4vcpu-8gb',
  's-8vcpu-16gb',
  'c-2-4gb',
  'c-4-8gb',
] as const
