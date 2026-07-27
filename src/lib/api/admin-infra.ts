/**
 * admin.<brand> INFRASTRUCTURE — the DigitalOcean fleet read (droplets, block-storage
 * volumes, DOKS clusters, load balancers) behind the global-admin Infrastructure board.
 *
 * Transport: `originGet`/`originPost`/`originDelete` pin the request to the console's
 * OWN origin (`<origin>/v1/admin/infra`), never a split-origin `NEXT_PUBLIC_CLOUD_URL`,
 * so it terminates at `app/admin/aggregate/[...path]` → `getAdminGate` (fail-closed 403
 * for a non-global-admin) → a minted admin bearer to cloud. The head `infra` must be in
 * BOTH `ADMIN_AGGREGATE_HEADS` (admin-aggregate.ts) and `ADMIN_V1_HEADS`
 * (next.config.mjs) or every call 403s.
 *
 * Honest by construction: every field is defensively normalized (missing → 0 / '' / [],
 * snake_case AND camelCase tolerated), so a partial payload renders real zeros and empty
 * tables — never fabricated fleet numbers. Two invariants from the contract are carried
 * verbatim rather than re-derived here: `complete === false` ⇒ NO volume is deletable,
 * and `deletable` is the ONLY thing that may present a delete affordance.
 */
import { originDelete, originGet, originPost } from './client'

/** A volume's lifecycle: attached to a droplet, PV-bound, released, or referenced by nothing. */
export type VolumeState = 'attached' | 'bound' | 'released' | 'unreferenced'

export type InfraTotals = {
  clusters: number
  nodes: number
  volumes: number
  loadBalancers: number
  volumeGiB: number
  attachedVolumes: number
  attachedGiB: number
  detachedVolumes: number
  detachedGiB: number
  unreferencedVolumes: number
  unreferencedGiB: number
  idlePVCs: number
  /** Droplet-local disk. INCLUDED in the droplet price — never billed separately. */
  localDiskGiB: number
}

/** All money is integer CENTS PER MONTH. `reclaimableMonthly` = unreferenced only. */
export type InfraCost = {
  dropletsMonthly: number
  volumesMonthly: number
  loadBalancersMonthly: number
  totalMonthly: number
  reclaimableMonthly: number
}

export type InfraSource = { name: string; ok: boolean; rows: number; error: string; at: string }

export type InfraCluster = {
  id: string
  name: string
  region: string
  version: string
  status: string
  nodePools: number
  nodes: number
  pods: number
  pvs: number
  pvcs: number
  idlePVCs: number
  scanned: boolean
  scanError: string
  monthlyCents: number
}

/** A DO droplet — every droplet in this fleet is a k8s node. */
export type InfraNode = {
  id: number
  name: string
  cluster: string
  clusterId: string
  region: string
  status: string
  sizeSlug: string
  vcpus: number
  memoryMiB: number
  /** Included in the droplet price — NOT separately billed. */
  localDiskGiB: number
  monthlyCents: number
  createdAt: string
  privateIp: string
  publicIp: string
  tags: string[]
  ready: boolean
  schedulable: boolean
  pods: number
  volumes: number
}

export type InfraVolume = {
  id: string
  name: string
  region: string
  sizeGiB: number
  monthlyCents: number
  state: VolumeState
  dropletIds: number[]
  nodeName: string
  /** OWNING cluster, proven via the PV. '' when none. */
  cluster: string
  clusterId: string
  /** From the `k8s:<uuid>` tag — ADVISORY ONLY, never proof of ownership. */
  tagCluster: string
  pv: string
  pvPhase: string
  pvcNamespace: string
  pvcName: string
  /** Pods currently mounting it. */
  mountedBy: string[]
  /** Bound to a PVC but zero pods mount it. */
  idle: boolean
  createdAt: string
  /** `complete && state === 'unreferenced'` — the ONLY gate on a delete affordance. */
  deletable: boolean
  blockedReason: string
}

export type InfraLoadBalancer = {
  id: string
  name: string
  region: string
  status: string
  ip: string
  sizeUnit: number
  monthlyCents: number
  droplets: number
  cluster: string
}

export type FindingSeverity = 'critical' | 'warn' | 'info'

export type InfraFinding = {
  id: string
  severity: FindingSeverity
  kind: string
  title: string
  detail: string
  resource: string
  cluster: string
  monthlyCents: number
}

export type InfraSnapshot = {
  at: string
  /** TRUE only if EVERY known cluster scanned OK. False ⇒ no volume is deletable. */
  complete: boolean
  incompleteReason: string
  sources: InfraSource[]
  totals: InfraTotals
  cost: InfraCost
  clusters: InfraCluster[]
  nodes: InfraNode[]
  volumes: InfraVolume[]
  loadBalancers: InfraLoadBalancer[]
  findings: InfraFinding[]
}

/** What a volume-snapshot call reports back. */
export type VolumeSnapshotResult = { snapshotId: string; name: string; sizeGiB: number }
/** What a volume delete reports back — server-authoritative freed spend. */
export type VolumeDeleteResult = { deleted: boolean; snapshotId: string; name: string; sizeGiB: number; freedMonthlyCents: number }
/** What a cordon/drain reports back. */
export type CordonResult = { name: string; schedulable: boolean; evicted: number }

// ── defensive coercion (snake_case OR camelCase; missing/garbage → honest zero) ──
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true || v === 'true'
const strs = (v: unknown): string[] => arr(v).map(str).filter(Boolean)
const nums = (v: unknown): number[] => arr(v).map(num)
/** First present of the given keys (camel + snake variants). */
const g = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined) return o[k]
  return undefined
}

const STATES: VolumeState[] = ['attached', 'bound', 'released', 'unreferenced']
const SEVERITIES: FindingSeverity[] = ['critical', 'warn', 'info']

const normTotals = (v: unknown): InfraTotals => {
  const t = rec(v)
  return {
    clusters: num(g(t, 'clusters')),
    nodes: num(g(t, 'nodes')),
    volumes: num(g(t, 'volumes')),
    loadBalancers: num(g(t, 'loadBalancers', 'load_balancers')),
    volumeGiB: num(g(t, 'volumeGiB', 'volume_gib')),
    attachedVolumes: num(g(t, 'attachedVolumes', 'attached_volumes')),
    attachedGiB: num(g(t, 'attachedGiB', 'attached_gib')),
    detachedVolumes: num(g(t, 'detachedVolumes', 'detached_volumes')),
    detachedGiB: num(g(t, 'detachedGiB', 'detached_gib')),
    unreferencedVolumes: num(g(t, 'unreferencedVolumes', 'unreferenced_volumes')),
    unreferencedGiB: num(g(t, 'unreferencedGiB', 'unreferenced_gib')),
    idlePVCs: num(g(t, 'idlePVCs', 'idle_pvcs')),
    localDiskGiB: num(g(t, 'localDiskGiB', 'local_disk_gib')),
  }
}

const normCost = (v: unknown): InfraCost => {
  const c = rec(v)
  return {
    dropletsMonthly: num(g(c, 'dropletsMonthly', 'droplets_monthly')),
    volumesMonthly: num(g(c, 'volumesMonthly', 'volumes_monthly')),
    loadBalancersMonthly: num(g(c, 'loadBalancersMonthly', 'load_balancers_monthly')),
    totalMonthly: num(g(c, 'totalMonthly', 'total_monthly')),
    reclaimableMonthly: num(g(c, 'reclaimableMonthly', 'reclaimable_monthly')),
  }
}

const normSources = (v: unknown): InfraSource[] =>
  arr(v).map((r) => {
    const o = rec(r)
    return { name: str(g(o, 'name')), ok: bool(g(o, 'ok')), rows: num(g(o, 'rows')), error: str(g(o, 'error')), at: str(g(o, 'at')) }
  })

const normClusters = (v: unknown): InfraCluster[] =>
  arr(v).map((r) => {
    const o = rec(r)
    return {
      id: str(g(o, 'id')),
      name: str(g(o, 'name')),
      region: str(g(o, 'region')),
      version: str(g(o, 'version')),
      status: str(g(o, 'status')),
      nodePools: num(g(o, 'nodePools', 'node_pools')),
      nodes: num(g(o, 'nodes')),
      pods: num(g(o, 'pods')),
      pvs: num(g(o, 'pvs')),
      pvcs: num(g(o, 'pvcs')),
      idlePVCs: num(g(o, 'idlePVCs', 'idle_pvcs')),
      scanned: bool(g(o, 'scanned')),
      scanError: str(g(o, 'scanError', 'scan_error')),
      monthlyCents: num(g(o, 'monthlyCents', 'monthly_cents')),
    }
  })

const normNodes = (v: unknown): InfraNode[] =>
  arr(v).map((r) => {
    const o = rec(r)
    return {
      id: num(g(o, 'id')),
      name: str(g(o, 'name')),
      cluster: str(g(o, 'cluster')),
      clusterId: str(g(o, 'clusterId', 'cluster_id')),
      region: str(g(o, 'region')),
      status: str(g(o, 'status')),
      sizeSlug: str(g(o, 'sizeSlug', 'size_slug')),
      vcpus: num(g(o, 'vcpus')),
      memoryMiB: num(g(o, 'memoryMiB', 'memory_mib')),
      localDiskGiB: num(g(o, 'localDiskGiB', 'local_disk_gib')),
      monthlyCents: num(g(o, 'monthlyCents', 'monthly_cents')),
      createdAt: str(g(o, 'createdAt', 'created_at')),
      privateIp: str(g(o, 'privateIp', 'private_ip')),
      publicIp: str(g(o, 'publicIp', 'public_ip')),
      tags: strs(g(o, 'tags')),
      ready: bool(g(o, 'ready')),
      schedulable: bool(g(o, 'schedulable')),
      pods: num(g(o, 'pods')),
      volumes: num(g(o, 'volumes')),
    }
  })

const normVolumes = (v: unknown): InfraVolume[] =>
  arr(v).map((r) => {
    const o = rec(r)
    const state = str(g(o, 'state'))
    return {
      id: str(g(o, 'id')),
      name: str(g(o, 'name')),
      region: str(g(o, 'region')),
      sizeGiB: num(g(o, 'sizeGiB', 'size_gib')),
      monthlyCents: num(g(o, 'monthlyCents', 'monthly_cents')),
      state: (STATES.includes(state as VolumeState) ? state : 'unreferenced') as VolumeState,
      dropletIds: nums(g(o, 'dropletIds', 'droplet_ids')),
      nodeName: str(g(o, 'nodeName', 'node_name')),
      cluster: str(g(o, 'cluster')),
      clusterId: str(g(o, 'clusterId', 'cluster_id')),
      tagCluster: str(g(o, 'tagCluster', 'tag_cluster')),
      pv: str(g(o, 'pv')),
      pvPhase: str(g(o, 'pvPhase', 'pv_phase')),
      pvcNamespace: str(g(o, 'pvcNamespace', 'pvc_namespace')),
      pvcName: str(g(o, 'pvcName', 'pvc_name')),
      mountedBy: strs(g(o, 'mountedBy', 'mounted_by')),
      idle: bool(g(o, 'idle')),
      createdAt: str(g(o, 'createdAt', 'created_at')),
      // STRICT true: a missing/garbage flag is NEVER deletable (fail closed — a delete
      // the server will refuse must never be offered).
      deletable: g(o, 'deletable') === true,
      blockedReason: str(g(o, 'blockedReason', 'blocked_reason')),
    }
  })

const normLoadBalancers = (v: unknown): InfraLoadBalancer[] =>
  arr(v).map((r) => {
    const o = rec(r)
    return {
      id: str(g(o, 'id')),
      name: str(g(o, 'name')),
      region: str(g(o, 'region')),
      status: str(g(o, 'status')),
      ip: str(g(o, 'ip')),
      sizeUnit: num(g(o, 'sizeUnit', 'size_unit')),
      monthlyCents: num(g(o, 'monthlyCents', 'monthly_cents')),
      droplets: num(g(o, 'droplets')),
      cluster: str(g(o, 'cluster')),
    }
  })

const normFindings = (v: unknown): InfraFinding[] =>
  arr(v).map((r, i) => {
    const o = rec(r)
    const sev = str(g(o, 'severity'))
    return {
      id: str(g(o, 'id')) || `finding-${i}`,
      severity: (SEVERITIES.includes(sev as FindingSeverity) ? sev : 'info') as FindingSeverity,
      kind: str(g(o, 'kind')),
      title: str(g(o, 'title')),
      detail: str(g(o, 'detail')),
      resource: str(g(o, 'resource')),
      cluster: str(g(o, 'cluster')),
      monthlyCents: num(g(o, 'monthlyCents', 'monthly_cents')),
    }
  })

/** Normalize the raw `/v1/admin/infra` payload into the typed board model. */
export function normalizeSnapshot(raw: unknown): InfraSnapshot {
  const d = rec(raw)
  const volumes = normVolumes(g(d, 'volumes'))
  const complete = bool(g(d, 'complete'))
  return {
    at: str(g(d, 'at')),
    complete,
    incompleteReason: str(g(d, 'incompleteReason', 'incomplete_reason')),
    sources: normSources(g(d, 'sources')),
    totals: normTotals(g(d, 'totals')),
    cost: normCost(g(d, 'cost')),
    clusters: normClusters(g(d, 'clusters')),
    nodes: normNodes(g(d, 'nodes')),
    // Contract invariant, re-asserted client-side: an INCOMPLETE scan makes NOTHING
    // deletable, whatever the per-row flag says. Cheap, and it keeps a stale/partial
    // payload from ever rendering a delete the server would refuse.
    volumes: complete ? volumes : volumes.map((v) => ({ ...v, deletable: false, blockedReason: v.blockedReason || 'Scan incomplete — no volume is deletable.' })),
    loadBalancers: normLoadBalancers(g(d, 'loadBalancers', 'load_balancers')),
    findings: normFindings(g(d, 'findings')),
  }
}

export const AdminInfraApi = {
  /** The whole fleet snapshot. `refresh` busts the backend's 60s cache. */
  snapshot: async (refresh?: boolean): Promise<InfraSnapshot> =>
    normalizeSnapshot(await originGet<unknown>('admin/infra', refresh ? { refresh: '1' } : undefined)),

  /** Snapshot ONE volume (the pre-delete safety net; also usable on its own). */
  volumeSnapshot: async (id: string, name?: string): Promise<VolumeSnapshotResult> => {
    const r = rec(await originPost<unknown>(`admin/infra/volumes/${encodeURIComponent(id)}/snapshot`, name ? { name } : {}))
    return { snapshotId: str(g(r, 'snapshotId', 'snapshot_id')), name: str(g(r, 'name')), sizeGiB: num(g(r, 'sizeGiB', 'size_gib')) }
  },

  /**
   * Delete a volume. The server re-runs a FRESH complete scan and refuses unless the
   * volume is still `unreferenced`, so this can fail even from a deletable-looking row —
   * the caller surfaces that refusal verbatim rather than pretending it worked.
   */
  deleteVolume: async (id: string, snapshot: boolean): Promise<VolumeDeleteResult> => {
    const r = rec(await originDelete<unknown>(`admin/infra/volumes/${encodeURIComponent(id)}`, { snapshot: snapshot ? 'true' : 'false' }))
    return {
      deleted: bool(g(r, 'deleted')),
      snapshotId: str(g(r, 'snapshotId', 'snapshot_id')),
      name: str(g(r, 'name')),
      sizeGiB: num(g(r, 'sizeGiB', 'size_gib')),
      freedMonthlyCents: num(g(r, 'freedMonthlyCents', 'freed_monthly_cents')),
    }
  },

  /** Cordon/uncordon a node; `drain` additionally evicts its pods. */
  cordonNode: async (id: number, cordon: boolean, drain: boolean): Promise<CordonResult> => {
    const r = rec(await originPost<unknown>(`admin/infra/nodes/${encodeURIComponent(String(id))}/cordon`, { cordon, drain }))
    return { name: str(g(r, 'name')), schedulable: bool(g(r, 'schedulable')), evicted: num(g(r, 'evicted')) }
  },
}
