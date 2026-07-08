/**
 * APM / Infrastructure / Exceptions / Dashboards API — the SigNoz-flagship
 * observability surface, over the REAL Hanzo o11y (SigNoz) runtime.
 *
 * Transport: the same-origin user-bearer `/v1` proxy (`originV1Url`) — the
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
import { restGet, restPost, originV1Url } from './client'

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

// ── Per-service health (RED metrics for ONE product's service) ────────────────

/**
 * Pick the RED-metrics row for a product's OTel service from the services list,
 * trying each candidate name in order (the product's o11y `service.name`, then its
 * operator-app name — a product may emit under either). Exact match, so a wrong
 * guess yields `null` (→ honest empty), never another service's metrics.
 */
export function pickService(rows: ServiceRow[], candidates: (string | null | undefined)[]): ServiceRow | null {
  const names = candidates.filter((c): c is string => typeof c === 'string' && c !== '')
  for (const n of names) {
    const hit = rows.find((r) => r.serviceName === n)
    if (hit) return hit
  }
  return null
}

/** A product service's live health, derived from its o11y RED metrics over the window. */
export type ServiceHealth = {
  service: string
  numCalls: number
  callRate: number
  /** Error rate as a percentage (SigNoz `errorRate` is already a percent). */
  errorRatePct: number
  /** p99 latency in milliseconds (SigNoz returns nanoseconds). */
  p99Ms: number
  /** Average latency in milliseconds. */
  avgMs: number
  tone: 'green' | 'yellow' | 'red'
}

/**
 * Derive a service's health from its RED metrics: a service that served traffic in
 * the window is `green`, `yellow` at ≥1% errors, `red` at ≥5% — the standard RED
 * verdict. `null` when the service reported no calls (nothing to fabricate a verdict
 * from → the view shows an honest "no telemetry" state, never a fake green).
 */
export function serviceHealthOf(row: ServiceRow | null): ServiceHealth | null {
  if (!row || row.serviceName === '' || row.numCalls <= 0) return null
  const errorRatePct = Math.max(0, row.errorRate)
  const tone = errorRatePct >= 5 ? 'red' : errorRatePct >= 1 ? 'yellow' : 'green'
  return {
    service: row.serviceName,
    numCalls: row.numCalls,
    callRate: row.callRate,
    errorRatePct,
    p99Ms: row.p99 / 1_000_000,
    avgMs: row.avgDuration / 1_000_000,
    tone,
  }
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

// ── Logs + Traces (SigNoz composite query_range) ──────────────────────────────
//
// The universal `POST /api/v3/query_range` builder query. A `list`-panel `noop`
// query over `dataSource: logs | traces` returns RAW rows (recent log lines /
// spans), newest first — the one true logs/traces read (`/api/v1/logs` is a stub
// that returns `{"results":[]}`; query_range is what the SigNoz logs/traces
// explorer actually issues). Time is epoch MILLISECONDS (v3) = `ApmWindow.startMs
// /endMs`. Every helper is pure (JSON in, view-model out) so it unit-tests
// without a live runtime.

/** The telemetry signal a builder query reads. */
export type SignozDataSource = 'logs' | 'traces' | 'metrics'

/**
 * One SigNoz builder-query filter item — the `{key, op, value}` shape the explorer
 * sends. `key` carries the attribute's name + type so the runtime resolves it
 * correctly (a resource attribute vs an indexed column).
 */
export type QueryFilterItem = {
  key: { key: string; dataType: 'string'; type: string; isColumn: boolean }
  op: string
  value: string
}

/**
 * Filter a logs/traces list query to ONE OpenTelemetry `service.name`. `service.name`
 * is a RESOURCE attribute on both signals (on traces it is also materialized as an
 * indexed column, so `isColumn` is set there) — this is the exact filter item SigNoz's
 * own explorer emits for a service-scoped list, so the runtime resolves it and never
 * 400s. The caller ALSO re-filters the normalized rows client-side (belt-and-suspenders),
 * so a runtime that ignores the item can never leak another service's rows onto a
 * per-product page.
 */
export function serviceFilterItem(dataSource: SignozDataSource, service: string): QueryFilterItem {
  return {
    key: { key: 'service.name', dataType: 'string', type: 'resource', isColumn: dataSource === 'traces' },
    op: '=',
    value: service,
  }
}

/**
 * The exact v3 `query_range` LIST payload — ONE `noop` builder query keyed `A`,
 * newest-first, paged by `offset`/`pageSize`. Mirrors what SigNoz's own explorer
 * sends (verified against the frontend + the server `BuilderQuery` struct), so the
 * runtime never 400s on shape. `filters` (default none) scopes the query — e.g. a
 * `serviceFilterItem` restricts it to one product's OTel service.
 */
export function listQueryPayload(
  dataSource: SignozDataSource,
  w: ApmWindow,
  limit: number,
  filters: QueryFilterItem[] = [],
): Record<string, unknown> {
  const pageSize = Math.max(1, Math.min(1000, Math.floor(limit)))
  return {
    start: w.startMs,
    end: w.endMs,
    step: 60,
    compositeQuery: {
      queryType: 'builder',
      panelType: 'list',
      builderQueries: {
        A: {
          queryName: 'A',
          dataSource,
          aggregateOperator: 'noop',
          aggregateAttribute: {},
          expression: 'A',
          disabled: false,
          stepInterval: 60,
          filters: { items: filters, op: 'AND' },
          groupBy: [],
          having: [],
          orderBy: [{ columnName: 'timestamp', order: 'desc' }],
          limit: null,
          offset: 0,
          pageSize,
        },
      },
    },
  }
}

/** A `list`-panel query returns rows under `data.result[].list` (newer runtimes
 *  mirror them under `data.newResult.data.result[].list`); each is `{timestamp,data}`. */
type ListRow = { timestamp?: string | number; data?: Record<string, unknown> | null }

/** Pull the flat list rows out of either result location, never throwing on shape. */
export function parseListRows(body: unknown): ListRow[] {
  const r = (body ?? {}) as { data?: { result?: unknown; newResult?: { data?: { result?: unknown } } } }
  const direct = r?.data?.result
  const nested = r?.data?.newResult?.data?.result
  const results = (Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : []) as { list?: unknown }[]
  const out: ListRow[] = []
  for (const res of results) {
    if (Array.isArray(res?.list)) out.push(...(res.list as ListRow[]).filter((x): x is ListRow => x != null))
  }
  return out
}

/** Read the first present key from a flattened SigNoz row `data` map. */
function pick(data: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!data) return ''
  for (const k of keys) {
    const v = data[k]
    if (v !== undefined && v !== null && v !== '') return str(v)
  }
  return ''
}

/** Normalize the epoch value SigNoz returns (ns/us/ms/s, or an ISO string) → ISO. */
export function toIso(ts: string | number | undefined | null): string {
  if (ts == null || ts === '') return ''
  if (typeof ts === 'string' && !/^\d+$/.test(ts)) return ts // already ISO
  let ms = typeof ts === 'number' ? ts : Number(ts)
  if (!Number.isFinite(ms)) return ''
  while (ms > 1e14) ms = Math.floor(ms / 1000) // ns/us → ms by magnitude
  if (ms > 0 && ms < 1e11) ms = ms * 1000 // seconds → ms
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/** One application/platform log line, projected from a logs list row. */
export type LogRow = { id: string; timestamp: string; severity: string; service: string; body: string }

/** Normalize one logs list row → LogRow (tolerant of column-name variants). */
export function normalizeLogRow(row: ListRow, idx: number): LogRow {
  const d = row.data ?? {}
  return {
    id: pick(d, ['id', 'log_id']) || `${str(row.timestamp)}-${idx}`,
    timestamp: toIso(row.timestamp) || toIso(pick(d, ['timestamp'])),
    severity: pick(d, ['severity_text', 'severityText', 'level', 'severity']).toLowerCase(),
    service: pick(d, ['service.name', 'service_name', 'serviceName']),
    body: pick(d, ['body', 'message', 'log', 'msg']),
  }
}

/** Normalize a logs `query_range` response → LogRow[] (newest first). */
export function normalizeLogs(body: unknown): LogRow[] {
  return parseListRows(body).map(normalizeLogRow)
}

/** One trace/span row from a `dataSource: traces` list query. */
export type TraceSpan = {
  id: string
  timestamp: string
  traceId: string
  name: string
  service: string
  /** Duration in nanoseconds (SigNoz unit), or null when absent. */
  durationNano: number | null
  status: string
}

/** Normalize one traces list row → TraceSpan. */
export function normalizeTraceSpan(row: ListRow, idx: number): TraceSpan {
  const d = row.data ?? {}
  const traceId = pick(d, ['traceID', 'traceId', 'trace_id'])
  const spanId = pick(d, ['spanID', 'spanId', 'span_id'])
  const durRaw = d?.['durationNano'] ?? d?.['duration_nano'] ?? d?.['durationNs']
  const durNum = Number(durRaw)
  return {
    id: spanId || traceId || `${str(row.timestamp)}-${idx}`,
    timestamp: toIso(row.timestamp) || toIso(pick(d, ['timestamp'])),
    traceId,
    name: pick(d, ['name', 'operationName', 'operation']),
    service: pick(d, ['serviceName', 'service.name', 'service_name']),
    durationNano: durRaw != null && durRaw !== '' && Number.isFinite(durNum) ? durNum : null,
    status: pick(d, ['statusCode', 'status_code', 'httpCode', 'responseStatusCode']),
  }
}

/** Normalize a traces `query_range` response → TraceSpan[] (newest first). */
export function normalizeSpans(body: unknown): TraceSpan[] {
  return parseListRows(body).map(normalizeTraceSpan)
}

// ── Transport ─────────────────────────────────────────────────────────────────

const u = (path: string): string => originV1Url(`o11y/${path}`)

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

  // ── Logs + Traces (composite query_range; `/api/v1/logs` is a stub) ──
  // A `service` scopes the query to ONE product's OTel `service.name` (the per-product
  // Logs sub-page); omit it for the org-wide stream. The rows are re-filtered client-side
  // to the same service so a runtime ignoring the item can never leak other services' lines.
  logs: async (w: ApmWindow, limit = 200, service?: string): Promise<LogRow[]> => {
    const filters = service ? [serviceFilterItem('logs', service)] : []
    const rows = normalizeLogs(await restPost<unknown>(u('v3/query_range'), listQueryPayload('logs', w, limit, filters)))
    return service ? rows.filter((r) => !r.service || r.service === service) : rows
  },
  traceSearch: async (w: ApmWindow, limit = 200, service?: string): Promise<TraceSpan[]> => {
    const filters = service ? [serviceFilterItem('traces', service)] : []
    const rows = normalizeSpans(await restPost<unknown>(u('v3/query_range'), listQueryPayload('traces', w, limit, filters)))
    return service ? rows.filter((r) => !r.service || r.service === service) : rows
  },

  // ── Per-product service health (RED metrics for ONE product's OTel service) ──
  // Reads the org-scoped services list once and picks the row for the product's service
  // (trying each candidate name). Works for a customer too (o11y scopes by the bearer's
  // org), unlike the admin-only control-plane inventory. `null` → honest "no telemetry".
  serviceHealth: async (w: ApmWindow, ...candidates: (string | null | undefined)[]): Promise<ServiceHealth | null> =>
    serviceHealthOf(pickService(await ApmApi.services(w), candidates)),
}
