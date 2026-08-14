/**
 * Kubernetes / unified fleet — PURE logic (no I/O), unit-tested directly.
 *
 * The fleet is the org's compute in ONE place: managed clusters + attached BYO
 * clusters (both from `GET /v1/clusters`) and dialed-in BYO machines (from
 * `GET /v1/machines`, folded in by the backend with `provider:"byo"`). Every helper
 * here derives a display value from a REAL field — a missing field degrades to 0 /
 * "—" in the caller, never a fabricated number.
 */
import type { Cluster } from '~/lib/api'
import { ApiError } from '~/lib/api'
import type { VisorMachine } from '~/lib/api/visor'

/** A cluster's kind. Managed clusters (Visor-provisioned pools) omit `kind`; an
 *  attached bring-your-own cluster reports `"byo"`. */
export function clusterKind(c: Cluster): 'byo' | 'managed' {
  return (c.kind ?? '').toLowerCase() === 'byo' ? 'byo' : 'managed'
}

/** True iff the cluster is an attached BYO cluster (not a managed one). */
export const isByoCluster = (c: Cluster): boolean => clusterKind(c) === 'byo'

/** Total accelerators a cluster reports (nvidia + amd); 0 when it reports none. */
export const clusterGpuTotal = (c: Cluster): number => (c.nvidiaGpu ?? 0) + (c.amdGpu ?? 0)

/**
 * Real node count of a cluster. A managed cluster carries its nodes in `nodePools`
 * (sum of pool counts); an attached BYO cluster carries them in `nodeCount` (it has
 * no pools). Falls back to `nodeCount` then 0 — never guessed.
 */
export function clusterNodeTotal(c: Cluster): number {
  if (c.nodePools && c.nodePools.length) return c.nodePools.reduce((n, p) => n + (p.count ?? 0), 0)
  if (typeof c.nodeCount === 'number' && Number.isFinite(c.nodeCount)) return c.nodeCount
  return 0
}

/** Lifecycle strings that read as an online/running cluster across BOTH kinds — a
 *  managed cluster is `running/ready/…`, an attached BYO cluster is `attached`. */
const ONLINE = new Set(['running', 'ready', 'active', 'provisioned', 'attached', 'connected', 'online'])

/** Whether a cluster's status/phase reads as online (REAL, PURE). */
export const isClusterOnline = (c: Cluster): boolean =>
  ONLINE.has((c.phase || c.status || '').toLowerCase())

/** The dialed-in BYO boxes among the org's machines (`provider === "byo"`). PURE. */
export const byoBoxes = (machines: VisorMachine[]): VisorMachine[] =>
  machines.filter((m) => (m.provider ?? '').toLowerCase() === 'byo')

/** The fleet at a glance — every field is a real count over the two live sources. */
export type FleetSummary = {
  /** Total clusters (managed + BYO). */
  clusters: number
  /** Attached BYO clusters (subset of `clusters`). */
  byoClusters: number
  /** Managed clusters (subset of `clusters`). */
  managedClusters: number
  /** Clusters reading online/running/attached. */
  online: number
  /** Total nodes across every cluster. */
  nodes: number
  /** Total accelerators across clusters (nvidia + amd). */
  gpus: number
  nvidia: number
  amd: number
  /** Dialed-in BYO machines/workers. */
  boxes: number
}

/** Summarize the fleet from the two live sources (clusters + machines). PURE. */
export function summarizeFleet(clusters: Cluster[], machines: VisorMachine[]): FleetSummary {
  const byoClusters = clusters.filter(isByoCluster).length
  const nvidia = clusters.reduce((n, c) => n + (c.nvidiaGpu ?? 0), 0)
  const amd = clusters.reduce((n, c) => n + (c.amdGpu ?? 0), 0)
  return {
    clusters: clusters.length,
    byoClusters,
    managedClusters: clusters.length - byoClusters,
    online: clusters.filter(isClusterOnline).length,
    nodes: clusters.reduce((n, c) => n + clusterNodeTotal(c), 0),
    gpus: nvidia + amd,
    nvidia,
    amd,
    boxes: byoBoxes(machines).length,
  }
}

/**
 * The honest cluster-attach failure, classified from the backend's status so the
 * form shows the RIGHT truth (never a generic error, never a fabricated success):
 *  - 503 → the deployment has no KMS, so BYO attach can't seal the kubeconfig yet.
 *  - 422 → the kubeconfig was unusable OR the cluster couldn't be reached to read
 *          its node/GPU inventory (the load-bearing validation the backend does).
 *  - 400 → a required field (name / kubeconfig) is missing.
 *  - 402 → the nominal management-fee billing gate (add credits).
 * The backend's own message is carried through as the detail (it is already
 * specific + human), with an honest fallback when a non-`ApiError` was thrown.
 */
export type AttachErrorKind = 'not-configured' | 'unreachable' | 'invalid' | 'billing' | 'error'

export function describeAttachError(e: unknown): { kind: AttachErrorKind; title: string; detail: string } {
  const status = e instanceof ApiError ? e.status : 0
  const message = e instanceof Error ? e.message : String(e)
  if (status === 503)
    return {
      kind: 'not-configured',
      title: 'Cluster attach isn’t configured on this deployment',
      detail: message || 'Bringing your own cluster needs KMS to seal the kubeconfig (CLOUD_KMS_NODES + CLOUD_KMS_PASSPHRASE). It isn’t set here yet.',
    }
  if (status === 422)
    return {
      kind: 'unreachable',
      title: 'Couldn’t reach that cluster',
      detail: message || 'The kubeconfig was unusable, or the cluster couldn’t be reached to read its node and GPU inventory. Check that it’s valid and reachable, then try again.',
    }
  if (status === 400)
    return {
      kind: 'invalid',
      title: 'A required field is missing',
      detail: message || 'A name and a kubeconfig are both required.',
    }
  if (status === 402)
    return {
      kind: 'billing',
      title: 'Add credits to attach a cluster',
      detail: message || 'Attaching a cluster carries a nominal management fee. Add credits to your balance and try again.',
    }
  return { kind: 'error', title: 'The cluster was not attached', detail: message || 'Try again in a moment. Your name and kubeconfig are still in the form.' }
}

/**
 * The copy-paste command that dials a GPU box / bare-metal machine into this org's
 * fleet. It is the REAL Hanzo CLI verb (`hanzo gpu connect`) the cloud fleet
 * subsystem reads from — the machine registers its presence and then appears in the
 * fleet + Machines + GPUs. No fabricated flags; the CLI resolves the org from the
 * signed-in session.
 */
export const CONNECT_SNIPPET = 'hanzo gpu connect'
