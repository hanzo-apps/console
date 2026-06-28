/**
 * Platform API — the Hanzo PaaS control plane (platform.hanzo.ai).
 *
 * ONE transport: every call goes through console2's own same-origin `/paas/*`
 * proxy (app/paas/[...path]/route.ts), which injects the service token from
 * server-only env (sourced via KMS) and forwards to `platform.hanzo.ai/v1/*`. So
 * the token never reaches the browser, there is no CORS, and when the token is
 * unset the proxy returns an honest 501 the UI renders as "not configured" — it
 * never fabricates data.
 *
 * Two REAL surfaces the platform serves (verified against the live control
 * plane, both service-token gated):
 *   - GET /v1/apps                 → the apps inventory: every (org, app, env)
 *     with declared/running/latest tag, drift, health, cluster, namespace. This
 *     is the canonical "what is running" board (docs/APPS_LIFECYCLE.md). It is
 *     the single source the Status and Kubernetes (workloads) modules read.
 *   - GET|POST /v1/org/{org}/cluster → the org's DEDICATED Hanzo K8S (DOKS)
 *     clusters: list, and provision a new one. Honest empty when the org has no
 *     dedicated cluster (the shared Hanzo Cloud is the default target, not a row).
 */
import { restGet, restPost } from './client'

/** Where a cluster lives: shared multi-tenant Hanzo Cloud, or a BYO/managed DOKS. */
export type ClusterKind = 'shared' | 'byo' | (string & {})

/** A dedicated Kubernetes cluster as the platform lists it. */
export type Cluster = {
  id?: string
  name: string
  status: string
  /** Platform lifecycle phase (requested→provisioning→installing→ready/error). */
  phase?: string
  kind?: ClusterKind
  region?: string
  nodeSize?: string
  nodeCount?: number
  version?: string
  endpoint?: string
  createdAt?: string
}

/** Provision a fresh dedicated DOKS cluster (the DO token is read from KMS server-side). */
export type ProvisionClusterInput = {
  region: string
  nodeSize: string
  nodeCount: number
  ha?: boolean
}

/** Health of an app/workload as the inventory reports it. */
export type AppHealth = 'green' | 'yellow' | 'red' | (string & {})

/** One drift flag on an app (declared/running/release mismatch). */
export type AppDriftFlag = { kind: string; severity: string; message: string }

/**
 * One row of the apps inventory (`GET /v1/apps`) — an operator-managed service
 * (a `Service` CR + its Deployment) observed on a cluster. Fields the platform
 * may omit are optional; the UI renders what is present and never invents the rest.
 */
export type PlatformApp = {
  id: string
  org: string
  app: string
  env: string
  repo?: string
  registry?: string
  declaredTag?: string | null
  runningTag?: string | null
  latestTag?: string | null
  releaseUrl?: string | null
  health: AppHealth
  cluster: string
  namespace?: string
  lastObserved?: string
  updatedAt?: string
  drift?: { severity?: string; flags?: AppDriftFlag[] }
}

/** Optional filters for the apps inventory (mirrors the platform's query params). */
export type AppsQuery = {
  org?: string
  env?: 'dev' | 'test' | 'main'
  health?: 'green' | 'yellow' | 'red'
  /** Only rows the reconciler considers drifting. */
  drift?: boolean
}

/** Same-origin PaaS proxy path. The proxy prefixes `/v1/` and attaches the token. */
const url = (path: string) => `/paas/${path.replace(/^\/+/, '')}`
const enc = encodeURIComponent

const qs = (q: AppsQuery): string => {
  const p = new URLSearchParams()
  if (q.org) p.set('org', q.org)
  if (q.env) p.set('env', q.env)
  if (q.health) p.set('health', q.health)
  if (q.drift) p.set('drift', 'true')
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const PlatformApi = {
  /** The apps inventory — the real "what is running" board across all clusters. */
  apps: async (query: AppsQuery = {}): Promise<PlatformApp[]> => {
    const r = await restGet<{ apps?: PlatformApp[] }>(url(`apps${qs(query)}`))
    return r?.apps ?? []
  },

  /** The org's dedicated DOKS clusters (honest empty when none provisioned). */
  listClusters: async (org: string): Promise<Cluster[]> => {
    const r = await restGet<{ clusters?: Cluster[] }>(url(`org/${enc(org)}/cluster`))
    return r?.clusters ?? []
  },

  /** Provision a fresh dedicated DOKS cluster for the org. */
  provisionCluster: async (org: string, input: ProvisionClusterInput): Promise<Cluster> => {
    const r = await restPost<{ cluster: Cluster }>(url(`org/${enc(org)}/cluster`), input)
    return r.cluster
  },
}

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

/** Clusters that actually appear in the apps inventory, in stable order. */
export const clustersFromApps = (apps: PlatformApp[]): string[] =>
  Array.from(new Set(apps.map((a) => a.cluster).filter(Boolean))).sort()
