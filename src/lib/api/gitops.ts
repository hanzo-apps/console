/**
 * Hanzo CD — the typed client for the native deploy plane (`/v1/deploy`).
 *
 * The console's native replacement for ArgoCD. Each operator `hanzo.ai/v1` App CR
 * IS a GitOps Application: the desired state for one workload, which the Hanzo
 * operator reconciles into a Deployment + Service + Ingress (+ HPA/PDB/Pods). This
 * plane OBSERVES that reconciliation the way ArgoCD observes a synced Application.
 *
 * cloud OWNS this API (the k8s client lives there — the console never holds
 * cluster credentials). This client only CONSUMES the contract cloud serves at
 * `/v1/deploy/*` (`cloudProxyV1Url` → same-origin `/v1/deploy/*`). In the go:embed
 * console (console.hanzo.ai / cd.hanzo.ai) `/v1` reaches cloud directly under the
 * session cookie; in the standalone console the `/v1` bearer BFF mints a
 * short-lived user token (the `deploy` head is allow-listed in proxy-allow.ts).
 * Authz is enforced SERVER-SIDE by cloud: today `/v1/deploy` is a SuperAdmin
 * platform surface (a non-admin 403s → the console renders an honest access
 * state); the org-scoped projection keys the same routes by the caller's org, and
 * the FE simply renders whatever rows the API returns per the active org.
 *
 * CONTRACT (cloud clients/deploy; a not-yet-routed/forbidden call renders an
 * honest state, never fabricated rows). The plane keys every per-application
 * address under `applications/{name}` (HIP-0139). The DTOs are mapped INTO the
 * console's `Application`/`ResourceNode` view-models below:
 *   GET  /v1/deploy/applications                        → { applications: [{name,namespace,env,role,
 *          repository,version,runningVersion,health,healthMessage,sync,phase,endpoints}], summary }
 *   GET  /v1/deploy/applications/{name}/resource-tree   → { application, nodes: [{group,version,kind,
 *          namespace,name,ref,uid,createdAt,health,healthMessage,sync,version,parentRefs:[{…,ref}]}] }
 *   POST /v1/deploy/applications/{name}/rollback {tag}  → { rolledBack, target, tag, application } (clean semver)
 *   POST /v1/deploy/applications/{name}/sync            → { synced, target, requestedAt, note }
 *
 * Every field is optional-safe: the normalizers tolerate snake_case and
 * camelCase and degrade a missing signal to an honest empty/`Unknown`, never a
 * guessed-up "Healthy".
 */
import { restGet, restPost, cloudProxyV1Url } from './client'

// ── Vocabulary (mirrors ArgoCD's health/sync split, folded from the CR) ──────

/** An application's live health — folded from the CR `.status` (phase + ready replicas). */
export type HealthStatus = 'Healthy' | 'Progressing' | 'Degraded' | 'Suspended' | 'Missing' | 'Unknown'

/** Desired (CR `spec.image.tag`) vs live (running Deployment image) agreement. */
export type SyncStatus = 'Synced' | 'OutOfSync' | 'Syncing' | 'Unknown'

/** The container image a CR (or an owned resource) declares. */
export interface ImageRef {
  repository: string
  tag: string
}

/** One `services.hanzo.ai` operator CR, projected as a GitOps application. */
export interface Application {
  name: string
  namespace: string
  image: ImageRef
  /** Raw CR `.status.phase` (Pending|Creating|Running|Degraded|Deleting), verbatim. */
  phase: string
  health: HealthStatus
  sync: SyncStatus
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
  /** Lifecycle env the App CR lives in (main|test|dev); '' when unknown. */
  env?: string
  /** The CR `spec.role`, when present. */
  role?: string
  /** Externally reachable endpoints the operator reconciled (status.endpoints). */
  endpoints?: string[]
}

/** One node in an application's owned-resource tree (the CR + everything it owns). */
export interface ResourceNode {
  /** Opaque server token identifying the resource (its uid); owner edges cite it. */
  ref: string
  group: string
  version: string
  kind: string
  name: string
  namespace: string
  health: HealthStatus
  sync: SyncStatus
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

/** An application's owned-resource graph — the topology the board renders. */
export interface AppTree {
  nodes: ResourceNode[]
  /** Explicit owner→child edges; when absent they are derived from `ownerRefs`. */
  edges: { from: string; to: string }[]
}

export interface RollbackResult {
  name: string
  tag: string
  phase: string
}

export interface SyncResult {
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

const HEALTHS = new Set<HealthStatus>(['Healthy', 'Progressing', 'Degraded', 'Suspended', 'Missing', 'Unknown'])

/** Coerce a server-provided health string to the vocab (case-insensitive). */
export const asHealth = (v: unknown): HealthStatus | undefined => {
  const s = str(v).trim()
  const cap = s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : ''
  return HEALTHS.has(cap as HealthStatus) ? (cap as HealthStatus) : undefined
}
/** Coerce a server-provided sync string to the vocab (case-insensitive). */
export const asSync = (v: unknown): SyncStatus | undefined => {
  const s = str(v).trim().toLowerCase()
  if (s === 'synced' || s === 'insync' || s === 'in-sync') return 'Synced'
  if (s === 'outofsync' || s === 'out-of-sync' || s === 'drift') return 'OutOfSync'
  if (s === 'syncing') return 'Syncing'
  if (s === '' || s === 'unknown') return s === 'unknown' ? 'Unknown' : undefined
  return undefined
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

/**
 * The application's image, from the `/v1/deploy` shape (top-level `repository` +
 * declared `version`), degrading to a nested `image` object or a flat `repo:tag`
 * string. Declared `version` is the CR `spec.image.tag`.
 */
function resolveAppImage(r: Record<string, unknown>): ImageRef {
  const repository = str(pick(r, 'repository', 'repo'))
  const tag = str(pick(r, 'version', 'tag'))
  if (repository || tag) return { repository, tag }
  return normalizeImage(pick(r, 'image'))
}

/** The `.ref` tokens of a `parentRefs: [{…, ref}]` array (owner→child edges). */
function parentRefStrings(v: unknown): string[] {
  return arr(v)
    .map((e) => str(pick(rec(e), 'ref', 'uid')))
    .filter(Boolean)
}

// The pure health/sync FOLDS live in the component's `logic.ts` (unit-tested,
// React-free) so the transport layer stays a thin, dependency-light mapper; the
// client trusts a server-computed `health`/`sync` when present and otherwise
// carries `Unknown` for the fold to refine from phase + replicas.

function normalizeApp(raw: unknown): Application {
  const r = rec(raw)
  return {
    name: str(pick(r, 'name')),
    namespace: str(pick(r, 'namespace', 'ns')) || 'hanzo',
    image: resolveAppImage(r),
    phase: str(pick(r, 'phase', 'status')),
    health: asHealth(pick(r, 'health')) ?? 'Unknown',
    sync: asSync(pick(r, 'sync', 'syncStatus', 'sync_status')) ?? 'Unknown',
    replicas: num(pick(r, 'replicas', 'desiredReplicas', 'desired_replicas')),
    readyReplicas: num(pick(r, 'readyReplicas', 'ready_replicas', 'ready')),
    liveTag: str(pick(r, 'runningVersion', 'running_version', 'liveTag', 'live_tag', 'runningTag', 'running_tag')),
    org: str(pick(r, 'org', 'orgId', 'org_id')),
    message: str(pick(r, 'healthMessage', 'health_message', 'message', 'msg')),
    revisions: strList(pick(r, 'revisions', 'history', 'tags')),
    updatedAt: epoch(pick(r, 'updatedAt', 'updated_at', 'lastTransitionTime', 'last_transition_time')),
    env: str(pick(r, 'env', 'environment')),
    role: str(pick(r, 'role')),
    endpoints: strList(pick(r, 'endpoints', 'urls')),
  }
}

function normalizeResourceNode(raw: unknown): ResourceNode {
  const r = rec(raw)
  return {
    ref: str(pick(r, 'ref', 'uid', 'id')),
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
    // `/v1/deploy` emits owner edges as `parentRefs: [{…, ref}]`; fall back to the
    // flat owner-uid shapes so a future backend that lists them directly still folds.
    ownerRefs: (() => {
      const parents = parentRefStrings(pick(r, 'parentRefs', 'parent_refs'))
      return parents.length > 0 ? parents : strList(pick(r, 'ownerRefs', 'owner_refs', 'owners', 'ownerUids', 'owner_uids'))
    })(),
    createdAt: epoch(pick(r, 'createdAt', 'created_at', 'creationTimestamp')),
  }
}

function normalizeTree(raw: unknown): AppTree {
  const r = rec(raw)
  const nodes = arr(pick(r, 'nodes', 'resources')).map(normalizeResourceNode).filter((n) => n.ref && n.kind)
  const edges = arr(pick(r, 'edges'))
    .map((e) => {
      const er = rec(e)
      return { from: str(pick(er, 'from', 'source', 'owner')), to: str(pick(er, 'to', 'target', 'child')) }
    })
    .filter((e) => e.from && e.to)
  return { nodes, edges }
}

const url = (path: string): string => cloudProxyV1Url(path)

/** The `applications/{name}` stem every per-application address hangs off. */
const app = (name: string): string => `deploy/applications/${encodeURIComponent(name)}`

export const GitopsApi = {
  /** List every `services.hanzo.ai` CR as a GitOps application. */
  applications: async (): Promise<Application[]> => {
    const data = await restGet<unknown>(url('deploy/applications'))
    const rows = Array.isArray(data) ? data : arr(pick(rec(data), 'applications', 'apps', 'items', 'services'))
    return rows.map(normalizeApp).filter((a) => a.name)
  },

  /** The owned-resource tree for one application (Service → Deployment → RS → Pods …). */
  tree: async (name: string): Promise<AppTree> => {
    const data = await restGet<unknown>(url(`${app(name)}/resource-tree`))
    return normalizeTree(data)
  },

  /** Roll an application back to a prior image tag — cloud patches the CR
   *  `spec.image.tag`, the operator reconciles the Deployment. */
  rollback: async (name: string, tag: string): Promise<RollbackResult> => {
    const data = await restPost<unknown>(url(`${app(name)}/rollback`), { tag })
    const r = rec(data)
    return { name: str(pick(r, 'name')) || name, tag: str(pick(r, 'tag')) || tag, phase: str(pick(r, 'phase', 'status')) }
  },

  /** Force a re-reconcile of the CR to its desired state (ArgoCD "Sync"). */
  sync: async (name: string): Promise<SyncResult> => {
    const data = await restPost<unknown>(url(`${app(name)}/sync`), {})
    const r = rec(data)
    return { name: str(pick(r, 'name')) || name, phase: str(pick(r, 'phase', 'status')) }
  },
}
