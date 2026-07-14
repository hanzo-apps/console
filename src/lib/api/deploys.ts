/**
 * Hanzo Deploy — the typed client for the operator-CR deploy plane.
 *
 * The console's native replacement for ArgoCD's UI. It reads the live
 * `services.hanzo.ai` operator custom resources (the ONE native pipeline:
 * git push → native Actions → image → registry → cloud emits/updates a Service
 * CR → hanzo-operator reconciles the Deployment/Ingress/cert). There is no
 * ArgoCD; the operator does the reconciliation and this surface visualizes it.
 *
 * cloud OWNS this API (the k8s client lives there — the console never holds
 * cluster credentials). This client only CONSUMES the contract cloud serves,
 * through the same-origin `/v1` path (`cloudProxyV1Url` → `/v1/deploys/*`). In
 * the go:embed console (console.hanzo.ai) `/v1` reaches cloud directly under the
 * session cookie; in the standalone console the `/v1` bearer BFF mints a
 * short-lived user token. Either way authz (SuperAdmin / owner scope — a
 * platform surface) is enforced SERVER-SIDE by cloud.
 *
 * CONTRACT (cloud-owned; if a route is not live yet the caller renders an honest
 * `BackendStateCard`, never fabricated rows):
 *   GET  /v1/deploys                          → { deploys: Deploy[] }
 *   GET  /v1/deploys/{name}/tree              → { nodes: ResourceNode[], edges? }
 *   GET  /v1/deploys/{name}/resource/{ref}    → ResourceDetail (manifest + diff + events)
 *   GET  /v1/deploys/{name}/logs?ref&container&tail → { lines: LogLine[] }
 *   POST /v1/deploys/{name}/rollback  { tag } → RollbackResult (patch CR tag → reconcile)
 *   POST /v1/deploys/{name}/restart           → RestartResult (rollout restart; extension)
 *
 * Every field is optional-safe: the normalizers tolerate snake_case and
 * camelCase and degrade a missing signal to an honest empty/`Unknown`, never a
 * guessed-up "Healthy".
 */
import { restGet, restPost, cloudProxyV1Url } from './client'

// ── Vocabulary (mirrors the ArgoCD health/sync split, folded from the CR) ────

/** A deploy's live health — folded from the CR `.status` (phase + ready replicas). */
export type DeployHealth = 'Healthy' | 'Progressing' | 'Degraded' | 'Suspended' | 'Missing' | 'Unknown'

/** Desired (CR `spec.image.tag`) vs live (running Deployment image) agreement. */
export type DeploySync = 'Synced' | 'OutOfSync' | 'Syncing' | 'Unknown'

/** The container image a CR (or an owned resource) declares. */
export interface ImageRef {
  repository: string
  tag: string
}

/** One `services.hanzo.ai` operator CR, projected for the deploys board. */
export interface Deploy {
  name: string
  namespace: string
  image: ImageRef
  /** Raw CR `.status.phase` (Pending|Creating|Running|Degraded|Deleting), verbatim. */
  phase: string
  health: DeployHealth
  sync: DeploySync
  replicas: number
  readyReplicas: number
  /** Running image tag off the live Deployment (drives sync); '' when unknown. */
  liveTag: string
  /** Attributing org (the `hanzo.ai/org` label), when present. */
  org: string
  /** The latest status condition message, when present. */
  message: string
  /** Prior image tags available to roll back to (newest first). */
  revisions: string[]
  /** Epoch ms of the last observed change; 0 when unknown. */
  updatedAt: number
}

/** One node in a CR's owned-resource tree (the CR + every resource it owns). */
export interface ResourceNode {
  /** Opaque server token identifying the resource (its uid) — path-safe. */
  ref: string
  group: string
  version: string
  kind: string
  name: string
  namespace: string
  health: DeployHealth
  sync: DeploySync
  /** Raw phase/status string, verbatim. */
  phase: string
  replicas: number
  readyReplicas: number
  images: string[]
  /** `ref`s of this resource's owners (parent edges), when present. */
  ownerRefs: string[]
  /** Epoch ms of creation; 0 when unknown. */
  createdAt: number
}

/** A CR's owned-resource graph — the topology the board renders as a canvas. */
export interface DeployTree {
  nodes: ResourceNode[]
  /** Explicit owner→child edges; when absent they are derived from `ownerRefs`. */
  edges: { from: string; to: string }[]
}

/** A single k8s Event on a resource. */
export interface ResourceEvent {
  type: string
  reason: string
  message: string
  count: number
  lastSeen: string
}

/** A resource's drill-in detail: live manifest, desired-vs-live diff, events. */
export interface ResourceDetail {
  ref: string
  /** Live manifest YAML (as served by the cluster). */
  live: string
  /** Desired manifest YAML (what the operator reconciles toward); '' when N/A. */
  desired: string
  /** Unified diff desired→live; '' when in sync or not computed. */
  diff: string
  events: ResourceEvent[]
}

/** One log line for a pod/container. */
export interface LogLine {
  ts: string
  pod: string
  container: string
  level: string
  message: string
}

export interface RollbackResult {
  name: string
  tag: string
  phase: string
}

export interface RestartResult {
  name: string
  phase: string
}

// ── Optional-safe parsing helpers (snake_case + camelCase tolerant) ──────────

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const pick = (r: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null) return r[k]
  return undefined
}
const strList = (v: unknown): string[] => arr(v).map(str).filter(Boolean)
const epoch = (v: unknown): number => {
  const s = str(v)
  if (!s) return 0
  const t = Date.parse(s)
  return Number.isNaN(t) ? 0 : t
}

const HEALTHS = new Set<DeployHealth>(['Healthy', 'Progressing', 'Degraded', 'Suspended', 'Missing', 'Unknown'])
const SYNCS = new Set<DeploySync>(['Synced', 'OutOfSync', 'Syncing', 'Unknown'])

/** Coerce a server-provided health string to the vocab (case-insensitive). */
export const asHealth = (v: unknown): DeployHealth | undefined => {
  const s = str(v).trim()
  const cap = s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : ''
  return HEALTHS.has(cap as DeployHealth) ? (cap as DeployHealth) : undefined
}
/** Coerce a server-provided sync string to the vocab (case-insensitive). */
export const asSync = (v: unknown): DeploySync | undefined => {
  const s = str(v).trim().toLowerCase()
  if (s === 'synced' || s === 'insync' || s === 'in-sync') return 'Synced'
  if (s === 'outofsync' || s === 'out-of-sync' || s === 'drift') return 'OutOfSync'
  if (s === 'syncing' || s === 'progressing') return 'Syncing'
  if (s === 'unknown' || s === '') return s === '' ? undefined : 'Unknown'
  return SYNCS.has((s[0].toUpperCase() + s.slice(1)) as DeploySync) ? ((s[0].toUpperCase() + s.slice(1)) as DeploySync) : undefined
}

/** Read an `{repository,tag}` image, tolerating a flat `repo:tag` string. */
function normalizeImage(v: unknown): ImageRef {
  if (typeof v === 'string') {
    const i = v.lastIndexOf(':')
    return i > 0 ? { repository: v.slice(0, i), tag: v.slice(i + 1) } : { repository: v, tag: '' }
  }
  const r = rec(v)
  return { repository: str(pick(r, 'repository', 'repo', 'image')), tag: str(pick(r, 'tag', 'version')) }
}

// The pure health/sync FOLDS live in the component's `logic.ts` (unit-tested,
// React-free) so the transport layer stays a thin, dependency-light mapper; the
// client trusts a server-computed `health`/`sync` when present and otherwise
// carries `Unknown` for the fold to refine from phase + replicas.

function normalizeDeploy(raw: unknown): Deploy {
  const r = rec(raw)
  return {
    name: str(pick(r, 'name')),
    namespace: str(pick(r, 'namespace', 'ns')) || 'hanzo',
    image: normalizeImage(pick(r, 'image')),
    phase: str(pick(r, 'phase', 'status')),
    health: asHealth(pick(r, 'health')) ?? 'Unknown',
    sync: asSync(pick(r, 'sync', 'syncStatus', 'sync_status')) ?? 'Unknown',
    replicas: num(pick(r, 'replicas', 'desiredReplicas', 'desired_replicas')),
    readyReplicas: num(pick(r, 'readyReplicas', 'ready_replicas', 'ready')),
    liveTag: str(pick(r, 'liveTag', 'live_tag', 'runningTag', 'running_tag')),
    org: str(pick(r, 'org', 'orgId', 'org_id')),
    message: str(pick(r, 'message', 'msg')),
    revisions: strList(pick(r, 'revisions', 'history', 'tags')),
    updatedAt: epoch(pick(r, 'updatedAt', 'updated_at', 'lastTransitionTime', 'last_transition_time')),
  }
}

function normalizeResourceNode(raw: unknown): ResourceNode {
  const r = rec(raw)
  const ref = str(pick(r, 'ref', 'uid', 'id'))
  return {
    ref,
    group: str(pick(r, 'group')),
    version: str(pick(r, 'version')),
    kind: str(pick(r, 'kind')),
    name: str(pick(r, 'name')),
    namespace: str(pick(r, 'namespace', 'ns')),
    health: asHealth(pick(r, 'health')) ?? 'Unknown',
    sync: asSync(pick(r, 'sync')) ?? 'Unknown',
    phase: str(pick(r, 'phase', 'status')),
    replicas: num(pick(r, 'replicas', 'desiredReplicas')),
    readyReplicas: num(pick(r, 'readyReplicas', 'ready_replicas', 'ready')),
    images: strList(pick(r, 'images', 'image')),
    ownerRefs: strList(pick(r, 'ownerRefs', 'owner_refs', 'owners', 'ownerUids', 'owner_uids')),
    createdAt: epoch(pick(r, 'createdAt', 'created_at', 'creationTimestamp')),
  }
}

function normalizeTree(raw: unknown): DeployTree {
  const r = rec(raw)
  const nodes = arr(pick(r, 'nodes', 'resources')).map(normalizeResourceNode).filter((n) => n.ref && n.kind)
  const edges = arr(pick(r, 'edges')).map((e) => {
    const er = rec(e)
    return { from: str(pick(er, 'from', 'source', 'owner')), to: str(pick(er, 'to', 'target', 'child')) }
  }).filter((e) => e.from && e.to)
  return { nodes, edges }
}

function normalizeEvent(raw: unknown): ResourceEvent {
  const r = rec(raw)
  return {
    type: str(pick(r, 'type')),
    reason: str(pick(r, 'reason')),
    message: str(pick(r, 'message', 'msg', 'note')),
    count: num(pick(r, 'count')),
    lastSeen: str(pick(r, 'lastSeen', 'last_seen', 'lastTimestamp', 'eventTime')),
  }
}

function normalizeDetail(ref: string, raw: unknown): ResourceDetail {
  const r = rec(raw)
  return {
    ref: str(pick(r, 'ref')) || ref,
    live: str(pick(r, 'live', 'manifest', 'liveManifest', 'live_manifest')),
    desired: str(pick(r, 'desired', 'target', 'desiredManifest', 'desired_manifest')),
    diff: str(pick(r, 'diff')),
    events: arr(pick(r, 'events')).map(normalizeEvent),
  }
}

function normalizeLine(raw: unknown): LogLine {
  const r = rec(raw)
  return {
    ts: str(pick(r, 'ts', 'time', 'timestamp')),
    pod: str(pick(r, 'pod', 'podName', 'pod_name')),
    container: str(pick(r, 'container')),
    level: str(pick(r, 'level', 'severity')),
    message: str(pick(r, 'message', 'msg', 'log', 'line')),
  }
}

/** Split a bare `{ log: "...\n..." }` blob into lines when no structured rows exist. */
function linesFromBlob(blob: string): LogLine[] {
  return blob
    .split('\n')
    .filter((l) => l.length > 0)
    .map((message) => ({ ts: '', pod: '', container: '', level: '', message }))
}

const url = (path: string): string => cloudProxyV1Url(path)

export interface LogQuery {
  /** The pod resource `ref` to read (from the tree); omit for the deploy's pods. */
  ref?: string
  container?: string
  /** Tail line count. */
  tail?: number
}

export const DeploysApi = {
  /** List every `services.hanzo.ai` CR with its folded health + sync. */
  list: async (): Promise<Deploy[]> => {
    const data = await restGet<unknown>(url('deploys'))
    const rows = Array.isArray(data) ? data : arr(pick(rec(data), 'deploys', 'services', 'items'))
    return rows.map(normalizeDeploy).filter((d) => d.name)
  },

  /** The owned-resource tree for one CR (Service → Deployment → ReplicaSet → Pods …). */
  tree: async (name: string): Promise<DeployTree> => {
    const data = await restGet<unknown>(url(`deploys/${encodeURIComponent(name)}/tree`))
    return normalizeTree(data)
  },

  /** One resource's live manifest, desired-vs-live diff, and events. */
  resource: async (name: string, ref: string): Promise<ResourceDetail> => {
    const data = await restGet<unknown>(url(`deploys/${encodeURIComponent(name)}/resource/${encodeURIComponent(ref)}`))
    return normalizeDetail(ref, data)
  },

  /** Pod logs for the deploy (optionally scoped to one pod `ref` + container). */
  logs: async (name: string, q: LogQuery = {}): Promise<LogLine[]> => {
    const qs = new URLSearchParams()
    if (q.ref) qs.set('ref', q.ref)
    if (q.container) qs.set('container', q.container)
    if (q.tail) qs.set('tail', String(q.tail))
    const suffix = qs.toString() ? `?${qs}` : ''
    const data = await restGet<unknown>(url(`deploys/${encodeURIComponent(name)}/logs${suffix}`))
    const rows = pick(rec(data), 'lines', 'logs')
    if (Array.isArray(rows)) return rows.map(normalizeLine)
    const blob = str(pick(rec(data), 'log', 'output'))
    return blob ? linesFromBlob(blob) : []
  },

  /** Roll a CR back to a prior image tag — cloud patches `spec.image.tag`, the
   *  operator reconciles the Deployment. */
  rollback: async (name: string, tag: string): Promise<RollbackResult> => {
    const data = await restPost<unknown>(url(`deploys/${encodeURIComponent(name)}/rollback`), { tag })
    const r = rec(data)
    return { name: str(pick(r, 'name')) || name, tag: str(pick(r, 'tag')) || tag, phase: str(pick(r, 'phase', 'status')) }
  },

  /** Rollout-restart a CR's workload (extension; a 404 is handled as "not available"). */
  restart: async (name: string): Promise<RestartResult> => {
    const data = await restPost<unknown>(url(`deploys/${encodeURIComponent(name)}/restart`), {})
    const r = rec(data)
    return { name: str(pick(r, 'name')) || name, phase: str(pick(r, 'phase', 'status')) }
  },
}
