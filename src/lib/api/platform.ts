/**
 * Platform API — DOKS cluster control plane (the Hanzo PaaS, platform.hanzo.ai).
 *
 * The console reaches the platform on `config.platformUrl` with the same cookie
 * credentials + REST transport as the cloud backend (see client.ts). Tenancy is
 * server-side (X-Org-Id from the validated session).
 *
 * NOTE ON PATHS: the platform's DOKS endpoints are not yet pinned in a shared
 * contract doc, so every path the console depends on is centralized in
 * `CLUSTER_ROUTES` below — the SINGLE place to re-point when the platform team
 * confirms the surface. Override the base URL with NEXT_PUBLIC_PLATFORM_URL.
 */
import { restGet, restPost, restDelete, v1Url } from './client'
import { config } from '~/config'

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
 * Platform DOKS routes, relative to `${config.platformUrl}/v1/`. Centralized so
 * a single edit re-points the console if the platform surface differs from this
 * assumed shape. Each is a `/v1` REST path the platform serves.
 */
export const CLUSTER_ROUTES = {
  list: 'clusters',
  provision: 'clusters',
  attach: 'clusters/attach',
  remove: (name: string) => `clusters/${encodeURIComponent(name)}`,
} as const

const url = (path: string) => v1Url(path, config.platformUrl)

export const PlatformApi = {
  listClusters: () => restGet<Cluster[]>(url(CLUSTER_ROUTES.list)),

  provisionCluster: (input: ProvisionClusterInput) =>
    restPost<Cluster>(url(CLUSTER_ROUTES.provision), input),

  attachCluster: (input: AttachClusterInput) =>
    restPost<Cluster>(url(CLUSTER_ROUTES.attach), input),

  removeCluster: (name: string) => restDelete(url(CLUSTER_ROUTES.remove(name))),
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
