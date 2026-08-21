/**
 * AutomationsApi — the org's Hanzo Automations: the ONE native Connectors +
 * Automations engine on cloud `/v1/auto/*` (`hanzoai/cloud` apps/auto,
 * HIP-0106). Flows + versions + runs over the go:embed'd
 * 706-connector catalogue, run durably on the shared hanzoai/tasks engine, with
 * credentials KMS-sealed per org. This replaces the retired standalone
 * auto.hanzo.ai engine and its reverse proxy — ONE native surface, no
 * link-out.
 *
 * Transport mirrors `paas.ts`/`functions.ts`: the same-origin `/v1` user-bearer BFF via
 * `cloudProxyV1Url` (`<origin>/v1/auto/*` → the `app/v1/[...path]` catch-all) —
 * the browser sends only its session cookie, the BFF mints a short-lived user IAM Bearer
 * and forwards it; cloud's `SanitizeIdentity` resolves the org from the Bearer OWNER
 * claim and pins every read/write to it, so a caller only ever sees THEIR org's
 * flows/runs (backend-enforced). A cookie-only call would 403 (cloud requires the
 * minted identity), so the BFF's bearer is load-bearing; `auto` is allow-listed
 * in `proxy-allow.ts` CLOUD_HEADS.
 *
 * The endpoints return PLAIN JSON (`{data:[…]}` lists, bare objects), NOT the
 * casibase `{status,msg,data}` envelope — so we use the `rest*` transport and
 * normalize defensively (a garbage/absent field degrades to an honest default,
 * never throws during render).
 */
import { restGet, restPost, restDelete, cloudProxyV1Url } from './client'

const BASE = 'auto'
const enc = encodeURIComponent
const url = (p: string): string => cloudProxyV1Url(`${BASE}/${p}`)

// ── view-models (mirror cloud apps/auto types.go JSON tags) ──────────────────

export type FlowStatus = 'ENABLED' | 'DISABLED'
export type RunStatus =
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'PAUSED'
  | 'QUEUED'
  | 'CANCELED'
  | 'TIMEOUT'

/**
 * A flow. `displayName` lives on the flow's VERSION, so the list endpoint (bare
 * `Flow` rows) omits it — it is populated only on `getFlow`/`createFlow` (a
 * `populatedFlow`). The UI falls back to externalId/id when it is absent (honest,
 * never fabricated).
 */
export interface AutomationFlow {
  id: string
  externalId: string
  status: FlowStatus
  publishedVersionId: string
  displayName?: string
  created: number
  updated: number
}

export interface FlowRun {
  id: string
  flowId: string
  flowVersionId: string
  status: RunStatus
  startTime: number
  finishTime: number
  created: number
}

export interface PieceAction {
  name: string
  displayName: string
  description: string
}

export interface Piece {
  name: string
  displayName: string
  description: string
  logoUrl: string
  version: string
  categories: string[]
  auth: { type: string; required: boolean }
  actions: PieceAction[]
  triggers: PieceAction[]
}

export interface Catalog {
  pieceCount: number
  pieces: Piece[]
}

// ── defensive normalizers (pure; unit-tested) ─────────────────────────────────

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strs = (v: unknown): string[] => arr(v).map(str).filter(Boolean)

/** Unwrap a list body — a bare array OR a `{data|items|results:[…]}` wrapper. */
function listOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body
  const o = rec(body)
  for (const k of ['data', 'items', 'results']) if (Array.isArray(o[k])) return o[k] as unknown[]
  return []
}

const flowStatus = (v: unknown): FlowStatus => (str(v) === 'ENABLED' ? 'ENABLED' : 'DISABLED')

const RUN_STATUSES: RunStatus[] = ['RUNNING', 'SUCCEEDED', 'FAILED', 'PAUSED', 'QUEUED', 'CANCELED', 'TIMEOUT']
const runStatus = (v: unknown): RunStatus => (RUN_STATUSES as string[]).includes(str(v)) ? (str(v) as RunStatus) : 'RUNNING'

export function normalizeFlow(raw: unknown): AutomationFlow {
  const o = rec(raw)
  const version = rec(o.version) // populatedFlow carries the version → its displayName
  const displayName = str(version.displayName) || str(o.displayName)
  return {
    id: str(o.id),
    externalId: str(o.externalId),
    status: flowStatus(o.status),
    publishedVersionId: str(o.publishedVersionId),
    displayName: displayName || undefined,
    created: num(o.created),
    updated: num(o.updated),
  }
}

export function normalizeFlows(body: unknown): AutomationFlow[] {
  return listOf(body).map(normalizeFlow).filter((f) => f.id !== '')
}

export function normalizeRun(raw: unknown): FlowRun {
  const o = rec(raw)
  return {
    id: str(o.id),
    flowId: str(o.flowId),
    flowVersionId: str(o.flowVersionId),
    status: runStatus(o.status),
    startTime: num(o.startTime),
    finishTime: num(o.finishTime),
    created: num(o.created),
  }
}

export function normalizeRuns(body: unknown): FlowRun[] {
  return listOf(body).map(normalizeRun).filter((r) => r.id !== '')
}

export function normalizePiece(raw: unknown): Piece {
  const o = rec(raw)
  const auth = rec(o.auth)
  const action = (a: unknown): PieceAction => {
    const x = rec(a)
    return { name: str(x.name), displayName: str(x.displayName) || str(x.name), description: str(x.description) }
  }
  return {
    name: str(o.name),
    displayName: str(o.displayName) || str(o.name),
    description: str(o.description),
    logoUrl: str(o.logoUrl),
    version: str(o.version),
    categories: strs(o.categories),
    auth: { type: str(auth.type) || 'none', required: auth.required === true },
    actions: arr(o.actions).map(action),
    triggers: arr(o.triggers).map(action),
  }
}

export function normalizeCatalog(body: unknown): Catalog {
  const o = rec(body)
  const pieces = arr(o.pieces).map(normalizePiece).filter((p) => p.name !== '')
  const declared = num(o.pieceCount)
  return { pieceCount: declared > 0 ? declared : pieces.length, pieces }
}

// ── API ───────────────────────────────────────────────────────────────────────

export const AutomationsApi = {
  /** The go:embed'd connector catalogue (706 pieces). */
  pieces: (): Promise<Catalog> => restGet<unknown>(url('pieces')).then(normalizeCatalog),

  /** The org's flows (bare rows — no displayName; see AutomationFlow). */
  listFlows: (): Promise<AutomationFlow[]> => restGet<unknown>(url('flows')).then(normalizeFlows),

  /** One flow + its latest version (populated → displayName present). */
  getFlow: (id: string): Promise<AutomationFlow> => restGet<unknown>(url(`flows/${enc(id)}`)).then(normalizeFlow),

  /** Create an empty flow (a nil trigger is valid); returns the populated flow. */
  createFlow: (displayName: string): Promise<AutomationFlow> =>
    restPost<unknown>(url('flows'), { displayName }).then(normalizeFlow),

  deleteFlow: (id: string): Promise<void> => restDelete(url(`flows/${enc(id)}`)),

  enableFlow: (id: string): Promise<AutomationFlow> =>
    restPost<unknown>(url(`flows/${enc(id)}/enable`), {}).then(normalizeFlow),

  disableFlow: (id: string): Promise<AutomationFlow> =>
    restPost<unknown>(url(`flows/${enc(id)}/disable`), {}).then(normalizeFlow),

  /** Start a durable run of a flow's runnable version. */
  runFlow: (id: string): Promise<FlowRun> => restPost<unknown>(url(`flows/${enc(id)}/run`), {}).then(normalizeRun),

  /** Recent runs, optionally scoped to one flow. */
  listRuns: (flowId?: string): Promise<FlowRun[]> =>
    restGet<unknown>(url(flowId ? `runs?flowId=${enc(flowId)}` : 'runs')).then(normalizeRuns),
} as const
