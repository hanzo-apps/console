/**
 * Platform API — the Hanzo PaaS control plane (platform.hanzo.ai), covering both
 * the cluster fleet and in-cluster Kubernetes workloads.
 *
 * ONE transport: every call goes through console2's own same-origin `/paas/*`
 * proxy (app/paas/[...path]/route.ts), which injects the service token from
 * server-only env (sourced via KMS) and forwards to `platform.hanzo.ai/v1/*`. So
 * the token never reaches the browser, there is no CORS, and when the token is
 * unset the proxy returns an honest 501 the UI renders as "not configured" — it
 * never fabricates data.
 *
 * PATHS: the platform's DOKS/k8s endpoints are not yet pinned in a shared
 * contract doc, so every path the console depends on is centralized in
 * `CLUSTER_ROUTES` / `k8sPath` below — the SINGLE place to re-point when the
 * platform team confirms the surface.
 */
import { restGet, restPost, restDelete } from './client'

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

/**
 * Platform routes, relative to the `/paas/` proxy (→ `platform.hanzo.ai/v1/`).
 * Centralized so a single edit re-points the console if the platform surface
 * differs from this assumed shape.
 */
export const CLUSTER_ROUTES = {
  list: 'clusters',
  provision: 'clusters',
  attach: 'clusters/attach',
  remove: (name: string) => `clusters/${encodeURIComponent(name)}`,
} as const

/** Same-origin PaaS proxy path. The proxy prefixes `/v1/` and attaches the token. */
const url = (path: string) => `/paas/${path.replace(/^\/+/, '')}`

export const PlatformApi = {
  listClusters: () => restGet<Cluster[]>(url(CLUSTER_ROUTES.list)),

  provisionCluster: (input: ProvisionClusterInput) =>
    restPost<Cluster>(url(CLUSTER_ROUTES.provision), input),

  attachCluster: (input: AttachClusterInput) =>
    restPost<Cluster>(url(CLUSTER_ROUTES.attach), input),

  removeCluster: (name: string) => restDelete(url(CLUSTER_ROUTES.remove(name))),
}

// ── In-cluster Kubernetes ─────────────────────────────────────────────────────
// Browse workloads and operator-managed custom resources for ONE cluster, scoped
// by org in the path (`/v1/org/{org}/cluster/{id}/k8s/*`). The platform backend
// ships separately; until it serves these, the calls 404 and the module shows an
// honest "backend not yet available" state.

/** The workload/CR kinds the console browses, in display order. */
export type K8sResource = 'deployments' | 'pods' | 'services' | 'ingresses' | 'events' | 'crs'

export const K8S_RESOURCES: { id: K8sResource; label: string }[] = [
  { id: 'deployments', label: 'Deployments' },
  { id: 'pods', label: 'Pods' },
  { id: 'services', label: 'Services' },
  { id: 'ingresses', label: 'Ingresses' },
  { id: 'events', label: 'Events' },
  { id: 'crs', label: 'Custom Resources' },
]

/**
 * One Kubernetes object as the platform reports it. Fields are optional because
 * each kind differs and the upstream shape evolves — the UI renders what is
 * present and never fabricates the rest.
 */
export type K8sObject = {
  name?: string
  namespace?: string
  kind?: string
  status?: string
  phase?: string
  ready?: string
  type?: string
  age?: string
  createdAt?: string
  reason?: string
  message?: string
  object?: string
  host?: string
  hosts?: string[]
  [key: string]: unknown
}

const k8sPath = (org: string, cluster: string, kind: K8sResource): string =>
  `org/${encodeURIComponent(org)}/cluster/${encodeURIComponent(cluster)}/k8s/${kind}`

/** Normalize a k8s list payload (array, or `{items|data|<kind>: [...]}`). */
function asItems(raw: unknown): K8sObject[] {
  if (Array.isArray(raw)) return raw as K8sObject[]
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    for (const key of ['items', 'data', 'deployments', 'pods', 'services', 'ingresses', 'events', 'resources']) {
      if (Array.isArray(o[key])) return o[key] as K8sObject[]
    }
  }
  return []
}

export const KubernetesApi = {
  listResource: async (org: string, cluster: string, kind: K8sResource): Promise<K8sObject[]> =>
    asItems(await restGet<unknown>(url(k8sPath(org, cluster, kind)))),
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
