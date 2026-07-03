/**
 * APM / Infrastructure / Exceptions / Dashboards API — the SigNoz-flagship
 * observability surface, over the REAL Hanzo o11y (SigNoz) runtime.
 *
 * Transport: the same-origin user-bearer `/cloud` proxy (`cloudProxyV1Url`) — the
 * browser sends only its session cookie, the server route mints a short-lived IAM
 * bearer and forwards it, and cloud-api reverse-proxies `/v1/o11y/*` to the o11y
 * Deployment, which internally rewrites `/v1/o11y/*` → its `/api/*` controllers.
 * This is the SAME path AlertsModule already uses for `o11y/v1/rules`, so the whole
 * APM/infra/exceptions/dashboards surface rides it with no new plumbing. A cookie-
 * only or cross-tenant call is refused server-side (the o11y runtime scopes every
 * query by the JWT `owner` claim → `X-Org-Id`).
 *
 * o11y (SigNoz) speaks plain REST (raw JSON, real HTTP status codes), NOT the
 * casibase `{status,msg,data}` envelope — so we use `restGet`/`restPost`. When the
 * runtime is not initialized it answers 503; unrouted surfaces 404; access issues
 * 401/403. `restGet`/`restPost` throw a typed `ApiError` carrying that status, so
 * the modules render an honest `RuntimeNotice` instead of fabricating spans, hosts,
 * exceptions, or dashboards.
 *
 * Time units follow SigNoz's own controllers (verified against o11y
 * pkg/query-service): APM (services / dependency graph / listErrors) takes
 * NANOSECOND epoch strings; infra (hosts / pods / nodes / namespaces / clusters)
 * takes MILLISECOND epoch numbers. `apmWindow` / `infraWindow` build each correctly.
 *
 * Every reader returns a normalized, defensively-parsed view-model (garbage/absent
 * fields degrade to 0 / '' / [], never a throw), so the pure normalizers unit-test
 * without a live backend.
 */
import { restGet, restPost, cloudProxyV1Url } from './client'

// ── Time windows ──────────────────────────────────────────────────────────────

/** A resolved lookback window with the start/end in whatever unit the caller needs. */
export type ApmWindow = { startNs: string; endNs: string; startMs: number; endMs: number; seconds: number }

/** Build a window ending now, spanning `seconds`, carrying both ns-strings and ms-numbers. */
export function apmWindow(seconds: number): ApmWindow {
  const endMs = Date.now()
  const startMs = endMs - seconds * 1000
  return {
    startNs: String(startMs * 1_000_000),
    endNs: String(endMs * 1_000_000),
    startMs,
    endMs,
    seconds,
  }
}

// ── Service map / APM ─────────────────────────────────────────────────────────

/** One service row from `/api/v1/services` (POST): RED metrics over the window. */
export type ServiceRow = {
  serviceName: string
  /** p99 latency, nanoseconds (SigNoz returns ns). */
  p99: number
  /** Average duration, nanoseconds. */
  avgDuration: number
  numCalls: number
  callRate: number
  numErrors: number
  errorRate: number
  num4XX: number
  fourXXRate: number
}

/** One edge of the service dependency graph (`/api/v1/dependency_graph`). */
export type DependencyEdge = {
  parent: string
  child: string
  callCount: number
  callRate: number
  errorRate: number
  p99: number
  p95: number
  p50: number
}

/** One top-operation row for a service (`/api/v1/service/top_operations`). */
export type TopOperation = {
  name: string
  p50: number
  p95: number
  p99: number
  numCalls: number
  errorCount: number
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** Normalize one raw service object → ServiceRow (tolerant of missing fields). */
export function normalizeService(r: unknown): ServiceRow {
  const o = (r ?? {}) as Record<string, unknown>
  return {
    serviceName: str(o.serviceName),
    p99: num(o.p99),
    avgDuration: num(o.avgDuration),
    numCalls: num(o.numCalls),
    callRate: num(o.callRate),
    numErrors: num(o.numErrors),
    errorRate: num(o.errorRate),
    num4XX: num(o.num4XX),
    fourXXRate: num(o.fourXXRate),
  }
}

/** Normalize the services response (an array, or `{data:[…]}`) → ServiceRow[]. */
export function normalizeServices(body: unknown): ServiceRow[] {
  const rows = Array.isArray(body) ? body : Array.isArray((body as { data?: unknown[] })?.data) ? (body as { data: unknown[] }).data : []
  return rows.map(normalizeService).filter((s) => s.serviceName !== '')
}

/** Normalize one dependency-graph edge. */
export function normalizeEdge(r: unknown): DependencyEdge {
  const o = (r ?? {}) as Record<string, unknown>
  return {
    parent: str(o.parent),
    child: str(o.child),
    callCount: num(o.callCount),
    callRate: num(o.callRate),
    errorRate: num(o.errorRate),
    p99: num(o.p99),
    p95: num(o.p95),
    p50: num(o.p50),
  }
}

/** Normalize the dependency-graph response → edges (drops self/empty endpoints). */
export function normalizeDependencies(body: unknown): DependencyEdge[] {
  const rows = Array.isArray(body) ? body : Array.isArray((body as { data?: unknown[] })?.data) ? (body as { data: unknown[] }).data : []
  return rows.map(normalizeEdge).filter((e) => e.parent !== '' && e.child !== '')
}

/** Normalize the top-operations response (SigNoz returns rows keyed by name). */
export function normalizeTopOperations(body: unknown): TopOperation[] {
  const rows = Array.isArray(body) ? body : Array.isArray((body as { data?: unknown[] })?.data) ? (body as { data: unknown[] }).data : []
  return rows
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>
      return {
        name: str(o.name ?? o.operation),
        p50: num(o.p50),
        p95: num(o.p95),
        p99: num(o.p99),
        numCalls: num(o.numCalls),
        errorCount: num(o.errorCount),
      }
    })
    .filter((t) => t.name !== '')
}

// ── Infrastructure (hosts / k8s) ──────────────────────────────────────────────

/** One host row from `/api/v1/hosts/list`. */
export type HostRow = {
  hostName: string
  active: boolean
  os: string
  /** CPU utilization, 0..1 (SigNoz returns a fraction). */
  cpu: number
  /** Memory utilization, 0..1. */
  memory: number
  wait: number
  load15: number
}

/** One pod row from `/api/v1/pods/list`. */
export type PodRow = {
  podName: string
  cpu: number
  cpuRequest: number
  cpuLimit: number
  memory: number
  memoryRequest: number
  memoryLimit: number
  restarts: number
  /** Namespace / workload from the record's meta labels, best-effort. */
  namespace: string
  phase: { pending: number; running: number; succeeded: number; failed: number; unknown: number }
}

/** One node row from `/api/v1/nodes/list`. */
export type NodeRow = {
  nodeName: string
  cpuUsage: number
  cpuAllocatable: number
  memoryUsage: number
  memoryAllocatable: number
  condition: { ready: number; notReady: number; unknown: number }
}

/** The normalized infra list envelope: rows + total + whether any data was seen. */
export type InfraList<T> = { records: T[]; total: number; hasData: boolean }

/** Read the human name out of a record's `meta` labels, trying the known keys. */
const metaName = (meta: unknown, keys: string[]): string => {
  const m = (meta ?? {}) as Record<string, unknown>
  for (const k of keys) {
    const v = m[k]
    if (typeof v === 'string' && v !== '') return v
  }
  return ''
}

const rawRecords = (body: unknown): { rows: unknown[]; total: number } => {
  const b = (body ?? {}) as { records?: unknown[]; total?: unknown; data?: { records?: unknown[]; total?: unknown } }
  const src = b.records ? b : b.data ?? {}
  const rows = Array.isArray((src as { records?: unknown[] }).records) ? (src as { records: unknown[] }).records : []
  const total = num((src as { total?: unknown }).total) || rows.length
  return { rows, total }
}

/** Normalize the host-list response → HostRow[] (+ total + hasData). */
export function normalizeHosts(body: unknown): InfraList<HostRow> {
  const { rows, total } = rawRecords(body)
  const records = rows.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>
    return {
      hostName: str(o.hostName) || metaName(o.meta, ['host.name', 'hostName']),
      active: Boolean(o.active),
      os: str(o.os) || metaName(o.meta, ['os.type']),
      cpu: num(o.cpu),
      memory: num(o.memory),
      wait: num(o.wait),
      load15: num(o.load15),
    }
  })
  return { records, total, hasData: records.length > 0 }
}

/** Normalize the pod-list response → PodRow[]. */
export function normalizePods(body: unknown): InfraList<PodRow> {
  const { rows, total } = rawRecords(body)
  const records = rows.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>
    const ph = (o.countByPhase ?? {}) as Record<string, unknown>
    return {
      podName: metaName(o.meta, ['k8s.pod.name', 'k8s_pod_name']) || str(o.podUID),
      cpu: num(o.podCPU),
      cpuRequest: num(o.podCPURequest),
      cpuLimit: num(o.podCPULimit),
      memory: num(o.podMemory),
      memoryRequest: num(o.podMemoryRequest),
      memoryLimit: num(o.podMemoryLimit),
      restarts: num(o.restartCount),
      namespace: metaName(o.meta, ['k8s.namespace.name', 'k8s_namespace_name']),
      phase: {
        pending: num(ph.pending),
        running: num(ph.running),
        succeeded: num(ph.succeeded),
        failed: num(ph.failed),
        unknown: num(ph.unknown),
      },
    }
  })
  return { records, total, hasData: records.length > 0 }
}

/** Normalize the node-list response → NodeRow[]. */
export function normalizeNodes(body: unknown): InfraList<NodeRow> {
  const { rows, total } = rawRecords(body)
  const records = rows.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>
    const c = (o.countByCondition ?? {}) as Record<string, unknown>
    return {
      nodeName: metaName(o.meta, ['k8s.node.name', 'k8s_node_name']) || str(o.nodeUID),
      cpuUsage: num(o.nodeCPUUsage),
      cpuAllocatable: num(o.nodeCPUAllocatable),
      memoryUsage: num(o.nodeMemoryUsage),
      memoryAllocatable: num(o.nodeMemoryAllocatable),
      condition: { ready: num(c.ready), notReady: num(c.notReady), unknown: num(c.unknown) },
    }
  })
  return { records, total, hasData: records.length > 0 }
}

// ── Exceptions ────────────────────────────────────────────────────────────────

/** One grouped exception from `/api/v1/listErrors`. */
export type ExceptionGroup = {
  groupID: string
  exceptionType: string
  exceptionMessage: string
  exceptionCount: number
  serviceName: string
  lastSeen: string
  firstSeen: string
}

/** Normalize one raw error group. */
export function normalizeException(r: unknown): ExceptionGroup {
  const o = (r ?? {}) as Record<string, unknown>
  return {
    groupID: str(o.groupID),
    exceptionType: str(o.exceptionType),
    exceptionMessage: str(o.exceptionMessage),
    exceptionCount: num(o.exceptionCount),
    serviceName: str(o.serviceName),
    lastSeen: str(o.lastSeen),
    firstSeen: str(o.firstSeen),
  }
}

/** Normalize the listErrors response → ExceptionGroup[]. */
export function normalizeExceptions(body: unknown): ExceptionGroup[] {
  const rows = Array.isArray(body) ? body : Array.isArray((body as { data?: unknown[] })?.data) ? (body as { data: unknown[] }).data : []
  return rows.map(normalizeException).filter((e) => e.exceptionType !== '' || e.exceptionMessage !== '')
}

// ── Dashboards (SigNoz) ───────────────────────────────────────────────────────

/** One dashboard from `/api/v1/dashboards` (list). */
export type Dashboard = {
  uuid: string
  title: string
  description: string
  tags: string[]
  /** Count of panels/widgets declared in the dashboard data. */
  widgetCount: number
  createdAt: string
  updatedAt: string
  createdBy: string
}

/**
 * Normalize one raw dashboard. SigNoz nests the display fields under `data`
 * (`{uuid, created_at, data:{title, description, tags, widgets:[…]}}`); we read
 * both the top-level and `data.*` so either shape maps cleanly.
 */
export function normalizeDashboard(r: unknown): Dashboard {
  const o = (r ?? {}) as Record<string, unknown>
  const data = (o.data ?? {}) as Record<string, unknown>
  const tagsRaw = (data.tags ?? o.tags) as unknown
  const tags = Array.isArray(tagsRaw) ? tagsRaw.filter((t): t is string => typeof t === 'string') : []
  const widgets = data.widgets ?? data.layout
  return {
    uuid: str(o.uuid ?? o.id),
    title: str(data.title ?? o.title) || 'Untitled dashboard',
    description: str(data.description ?? o.description),
    tags,
    widgetCount: Array.isArray(widgets) ? widgets.length : 0,
    createdAt: str(o.created_at ?? o.createdAt),
    updatedAt: str(o.updated_at ?? o.updatedAt),
    createdBy: str(o.created_by ?? o.createdBy),
  }
}

/** Normalize the dashboards-list response (`{status, data:[…]}` or a bare array). */
export function normalizeDashboards(body: unknown): Dashboard[] {
  const rows = Array.isArray(body) ? body : Array.isArray((body as { data?: unknown[] })?.data) ? (body as { data: unknown[] }).data : []
  return rows.map(normalizeDashboard).filter((d) => d.uuid !== '')
}

// ── Transport ─────────────────────────────────────────────────────────────────

const u = (path: string): string => cloudProxyV1Url(`o11y/${path}`)

/** The APM POST body — a start/end window + optional tags filter (SigNoz shape). */
type ApmBody = { start: string; end: string; tags?: unknown[]; service?: string }
/** The infra POST body — a start/end (ms) window + an (empty) filter set. */
type InfraBody = { start: number; end: number; filters: { op: 'AND'; items: [] } }

const apmBody = (w: ApmWindow, extra?: Partial<ApmBody>): ApmBody => ({ start: w.startNs, end: w.endNs, tags: [], ...extra })
const infraBody = (w: ApmWindow): InfraBody => ({ start: w.startMs, end: w.endMs, filters: { op: 'AND', items: [] } })

export const ApmApi = {
  // ── Service map / APM ──
  services: async (w: ApmWindow): Promise<ServiceRow[]> => normalizeServices(await restPost<unknown>(u('v1/services'), apmBody(w))),
  dependencies: async (w: ApmWindow): Promise<DependencyEdge[]> =>
    normalizeDependencies(await restPost<unknown>(u('v1/dependency_graph'), apmBody(w))),
  topOperations: async (w: ApmWindow, service: string): Promise<TopOperation[]> =>
    normalizeTopOperations(await restPost<unknown>(u('v1/service/top_operations'), apmBody(w, { service }))),

  // ── Infrastructure ──
  hosts: async (w: ApmWindow): Promise<InfraList<HostRow>> => normalizeHosts(await restPost<unknown>(u('v1/hosts/list'), infraBody(w))),
  pods: async (w: ApmWindow): Promise<InfraList<PodRow>> => normalizePods(await restPost<unknown>(u('v1/pods/list'), infraBody(w))),
  nodes: async (w: ApmWindow): Promise<InfraList<NodeRow>> => normalizeNodes(await restPost<unknown>(u('v1/nodes/list'), infraBody(w))),

  // ── Exceptions ──
  exceptions: async (
    w: ApmWindow,
    opts: { limit?: number; order?: 'ascending' | 'descending'; orderParam?: string } = {},
  ): Promise<ExceptionGroup[]> =>
    normalizeExceptions(
      await restPost<unknown>(u('v1/listErrors'), {
        start: w.startNs,
        end: w.endNs,
        limit: opts.limit ?? 100,
        order: opts.order ?? 'descending',
        orderParam: opts.orderParam ?? 'exceptionCount',
      }),
    ),

  // ── Dashboards ──
  dashboards: async (): Promise<Dashboard[]> => normalizeDashboards(await restGet<unknown>(u('v1/dashboards'))),
  dashboard: (uuid: string): Promise<unknown> => restGet<unknown>(u(`v1/dashboards/${encodeURIComponent(uuid)}`)),
}
