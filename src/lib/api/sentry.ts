/**
 * Hanzo Sentinel — the full error/log/trace dashboard client, over the `/v1/o11y/sentinel`
 * contract (native-Go cloud surface, built in parallel to this exact shape).
 *
 * Transport: the version-less same-origin `/v1` BFF every Observe tab uses
 * (`originV1Url` → `<origin>/v1/o11y/sentinel/<resource>`) — the browser sends only its
 * first-party session cookie; the console's `app/v1/[...path]` catch-all mints a
 * short-lived IAM bearer and forwards it (org from the Bearer owner), and the
 * go:embed console reaches cloud's `/v1/o11y/sentinel/*` directly on the same cookie. The
 * `o11y` head is allow-listed in `proxy-allow.ts`, so a cookie-only / cross-tenant
 * call is refused server-side. Org scope is ALWAYS server-enforced — never a client
 * param — so no reader takes an org.
 *
 * `/v1/o11y/sentinel` speaks plain REST (raw JSON + real HTTP status), NOT the casibase
 * `{status,msg,data}` envelope — so we use `restGet`/`restPost`/`restPut`, which
 * throw a typed `ApiError` carrying that status (503 not-initialized, 404 unrouted,
 * 401/403 access). Every reader returns a defensively-parsed view-model (garbage /
 * absent fields degrade to 0 / '' / [], never a throw), so the pure normalizers
 * unit-test without a live backend and every panel renders an honest empty/notice
 * state rather than fabricating an issue, log, span, or point.
 */
import { restGet, restPost, restPut, originV1Url } from './client'

// ── Shared defensive coercions ────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1
/** A numeric series (per-issue sparkline / stat counts), NaN-safe. */
const numArr = (v: unknown): number[] => (Array.isArray(v) ? v.map(num) : [])
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
/** Read the first present, non-empty string among keys (wire-shape tolerance). */
const pickStr = (o: Record<string, unknown>, keys: string[]): string => {
  for (const k of keys) {
    const s = str(o[k])
    if (s) return s
  }
  return ''
}

/** Unwrap a `{data:…}` render envelope (a bare body passes through). */
const unwrap = (body: unknown): unknown =>
  body && typeof body === 'object' && 'data' in obj(body) ? (body as { data: unknown }).data : body

/** Pull a row array out of a bare array, `{items}`, `{results}`, or `{data:[…]}`. */
function rowsOf(body: unknown): unknown[] {
  const d = unwrap(body)
  if (Array.isArray(d)) return d
  const o = obj(d)
  for (const k of ['items', 'results', 'rows', 'data']) {
    if (Array.isArray(o[k])) return o[k] as unknown[]
  }
  return []
}

// ── Time period (the lookback the panels share) ───────────────────────────────

export type Period = '1h' | '24h' | '7d' | '14d' | '30d' | '90d'
export const PERIODS: readonly Period[] = ['1h', '24h', '7d', '14d', '30d', '90d']

// ── Projects ──────────────────────────────────────────────────────────────────

/** A Sentry project — the client identity errors/logs/traces are ingested under.
 *  `dsn` is present on create + get (the ingest credential); '' in a bare list. */
export type SentryProject = {
  id: string
  slug: string
  name: string
  platform: string
  dsn: string
  status: string
  eventCount: number
  firstEvent: string
  lastEvent: string
  dateCreated: string
}

export function normalizeProject(r: unknown): SentryProject {
  const o = obj(r)
  return {
    id: pickStr(o, ['id', 'slug', 'name']),
    slug: pickStr(o, ['slug', 'id']),
    name: pickStr(o, ['name', 'slug', 'id']),
    platform: str(o.platform),
    dsn: pickStr(o, ['dsn', 'publicDsn']),
    status: str(o.status) || 'active',
    eventCount: num(o.eventCount ?? o.count ?? o.events),
    firstEvent: pickStr(o, ['firstEvent', 'first_event', 'firstSeen']),
    lastEvent: pickStr(o, ['lastEvent', 'last_event', 'lastSeen']),
    dateCreated: pickStr(o, ['dateCreated', 'created', 'createdAt', 'created_at']),
  }
}

export const normalizeProjects = (body: unknown): SentryProject[] =>
  rowsOf(body).map(normalizeProject).filter((p) => p.id !== '')

/** The `{dsn}` returned by a key rotation (or a bare string). */
export const normalizeDsn = (body: unknown): string => {
  const d = unwrap(body)
  if (typeof d === 'string') return d
  return pickStr(obj(d), ['dsn', 'publicDsn', 'key'])
}

// ── Issues (grouped by fingerprint) ───────────────────────────────────────────

export type IssueStatus = 'unresolved' | 'resolved' | 'ignored'
const issueStatus = (v: unknown): IssueStatus => (v === 'resolved' || v === 'ignored' ? v : 'unresolved')

/** A grouped issue — one fingerprint bucket with lifecycle + a sparkline series. */
export type SentryIssue = {
  id: string
  shortId: string
  title: string
  culprit: string
  type: string
  value: string
  level: string
  status: IssueStatus
  platform: string
  project: string
  environment: string
  release: string
  count: number
  userCount: number
  firstSeen: string
  lastSeen: string
  regressed: boolean
  assignee: string
  /** Per-issue event-count sparkline over the window (real counts, or [] when absent). */
  stats: number[]
}

export function normalizeIssue(r: unknown): SentryIssue {
  const o = obj(r)
  // The sparkline may arrive as `stats` (number[]) OR `[[ts,count],…]` — flatten both.
  const rawStats = o.stats ?? o.sparkline ?? o.series
  const stats = Array.isArray(rawStats)
    ? rawStats.map((p) => (Array.isArray(p) ? num(p[1]) : num(p)))
    : []
  return {
    id: pickStr(o, ['id', 'issueId', 'groupID', 'fingerprint']),
    shortId: pickStr(o, ['shortId', 'short_id']),
    title: pickStr(o, ['title', 'type', 'metadata.type']),
    culprit: str(o.culprit),
    type: pickStr(o, ['type', 'exceptionType']) || 'Error',
    value: pickStr(o, ['value', 'message', 'exceptionMessage']),
    level: str(o.level) || 'error',
    status: issueStatus(o.status),
    platform: str(o.platform),
    project: pickStr(o, ['project', 'projectId', 'projectSlug']),
    environment: str(o.environment),
    release: str(o.release),
    count: num(o.count ?? o.eventCount ?? o.events),
    userCount: num(o.userCount ?? o.users),
    firstSeen: pickStr(o, ['firstSeen', 'first_seen']),
    lastSeen: pickStr(o, ['lastSeen', 'last_seen']),
    regressed: bool(o.regressed ?? o.isRegressed),
    assignee: pickStr(o, ['assignee', 'assignedTo']),
    stats,
  }
}

export const normalizeIssues = (body: unknown): SentryIssue[] =>
  rowsOf(body).map(normalizeIssue).filter((i) => i.id !== '')

// ── Events (an issue's occurrences + the full sampled event) ──────────────────

export type SentryFrame = {
  function: string
  module: string
  filename: string
  absPath: string
  lineno: number
  colno: number
  inApp: boolean
  /** Source context lines around the crash, `[lineno, code]` (empty when absent). */
  context: Array<[number, string]>
}

export type SentryBreadcrumb = { timestamp: string; type: string; category: string; level: string; message: string }
export type SentryTag = { key: string; value: string }

/** One occurrence / the sampled event that drives the issue detail. */
export type SentryEvent = {
  id: string
  issueId: string
  title: string
  message: string
  culprit: string
  level: string
  platform: string
  timestamp: string
  environment: string
  release: string
  transaction: string
  serverName: string
  traceId: string
  spanId: string
  user: { id: string; email: string; ipAddress: string }
  tags: SentryTag[]
  frames: SentryFrame[]
  breadcrumbs: SentryBreadcrumb[]
  contexts: Record<string, Record<string, unknown>>
}

function normalizeFrame(r: unknown): SentryFrame {
  const o = obj(r)
  const ctx = Array.isArray(o.context)
    ? (o.context as unknown[])
        .map((p) => (Array.isArray(p) ? ([num(p[0]), str(p[1])] as [number, string]) : null))
        .filter((p): p is [number, string] => p !== null)
    : []
  return {
    function: pickStr(o, ['function', 'func']) || '<anonymous>',
    module: str(o.module),
    filename: pickStr(o, ['filename', 'file']),
    absPath: pickStr(o, ['absPath', 'abs_path']),
    lineno: num(o.lineno ?? o.line),
    colno: num(o.colno ?? o.col),
    inApp: bool(o.inApp ?? o.in_app),
    context: ctx,
  }
}

function normalizeTags(v: unknown): SentryTag[] {
  if (Array.isArray(v)) {
    return v
      .map((t) => {
        const o = obj(t)
        return { key: pickStr(o, ['key', 'name']), value: str(o.value) }
      })
      .filter((t) => t.key !== '')
  }
  // A `{key: value}` map is also accepted.
  return Object.entries(obj(v)).map(([key, value]) => ({ key, value: str(value) }))
}

function normalizeBreadcrumbs(v: unknown): SentryBreadcrumb[] {
  return (Array.isArray(v) ? v : []).map((b) => {
    const o = obj(b)
    return {
      timestamp: pickStr(o, ['timestamp', 'time']),
      type: str(o.type),
      category: str(o.category),
      level: str(o.level) || 'info',
      message: pickStr(o, ['message', 'msg']),
    }
  })
}

export function normalizeEvent(r: unknown): SentryEvent {
  const o = obj(r)
  // Frames may live under exception.frames, stacktrace.frames, or a flat `frames`.
  const exc = obj((obj(o.exception).values as unknown[])?.[0] ?? o.exception)
  const stack = obj(exc.stacktrace ?? o.stacktrace)
  const rawFrames = (o.frames ?? stack.frames ?? exc.frames) as unknown
  const u = obj(o.user)
  return {
    id: pickStr(o, ['id', 'eventId', 'eventID', 'event_id']),
    issueId: pickStr(o, ['issueId', 'groupID', 'issue']),
    title: pickStr(o, ['title', 'type']),
    message: pickStr(o, ['message', 'value', 'logentry.message']),
    culprit: str(o.culprit),
    level: str(o.level) || 'error',
    platform: str(o.platform),
    timestamp: pickStr(o, ['timestamp', 'dateCreated', 'time']),
    environment: str(o.environment),
    release: str(o.release),
    transaction: str(o.transaction),
    serverName: pickStr(o, ['serverName', 'server_name']),
    traceId: pickStr(o, ['traceId', 'traceID', 'trace_id']),
    spanId: pickStr(o, ['spanId', 'spanID', 'span_id']),
    user: { id: str(u.id), email: str(u.email), ipAddress: pickStr(u, ['ipAddress', 'ip_address', 'ip']) },
    tags: normalizeTags(o.tags),
    frames: (Array.isArray(rawFrames) ? rawFrames : []).map(normalizeFrame),
    breadcrumbs: normalizeBreadcrumbs(obj(o.breadcrumbs).values ?? o.breadcrumbs),
    contexts: obj(o.contexts) as Record<string, Record<string, unknown>>,
  }
}

/** The events list — an issue's occurrence timeline, newest-first. */
export const normalizeEvents = (body: unknown): SentryEvent[] => rowsOf(body).map(normalizeEvent)

export type SentryIssueDetail = { issue: SentryIssue | null; latestEvent: SentryEvent | null }

/** Issue detail — the group + its latest sampled occurrence (frames/tags/crumbs). */
export function normalizeIssueDetail(body: unknown): SentryIssueDetail {
  const d = obj(unwrap(body))
  // The detail may be `{issue, latestEvent}` OR a bare issue that carries its own
  // `latestEvent`; both map cleanly.
  const issueRaw = d.issue ?? d
  const eventRaw = d.latestEvent ?? d.event ?? obj(issueRaw).latestEvent
  return {
    issue: issueRaw ? normalizeIssue(issueRaw) : null,
    latestEvent: eventRaw ? normalizeEvent(eventRaw) : null,
  }
}

// ── Discover (the query/search builder over events) ───────────────────────────

/** One filter clause in a Discover query (`level = error`, `transaction ~ /api`). */
export type DiscoverFilter = { field: string; op: string; value: string }

/** A Discover query — field filters, aggregations, group-by, a range + ordering. */
export type DiscoverQuery = {
  project?: string
  filters?: DiscoverFilter[]
  aggregations?: string[]
  groupBy?: string[]
  period?: Period
  orderBy?: string
  limit?: number
}

/** One Discover result row — a map of the selected columns to scalar values. */
export type DiscoverRow = Record<string, string | number>

/** A Discover result — the columns, the rows, and an optional time series for the chart. */
export type DiscoverResult = { fields: string[]; rows: DiscoverRow[]; series: Array<{ ts: number; value: number }> }

export function normalizeDiscover(body: unknown): DiscoverResult {
  // `rows` are the result data; `meta.fields` + `series` are SIBLINGS of `data`, so
  // read them off the top-level envelope (and one level of nesting), NOT the unwrapped
  // rows array — unwrapping `{data:[…], series:[…]}` would drop the sibling series.
  const env = obj(body)
  const dataObj = obj(env.data) // {} when `data` is a bare rows array or absent
  const rows: DiscoverRow[] = rowsOf(body).map((r) => {
    const o = obj(r)
    const row: DiscoverRow = {}
    for (const [k, v] of Object.entries(o)) row[k] = typeof v === 'number' ? v : str(v)
    return row
  })
  // Columns: an explicit meta.fields, else the union of keys seen across rows.
  const metaFields = obj(env.meta).fields ?? env.fields ?? obj(dataObj.meta).fields ?? dataObj.fields
  const fields = Array.isArray(metaFields)
    ? metaFields.map(str).filter(Boolean)
    : [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const series = normalizeStats(env.series ?? env.timeseries ?? dataObj.series ?? dataObj.timeseries)
  return { fields, rows, series }
}

// ── Logs (the searchable log stream) ──────────────────────────────────────────

export type SentryLog = {
  id: string
  timestamp: string
  level: string
  message: string
  logger: string
  project: string
  traceId: string
  attributes: Record<string, string>
}

export function normalizeLog(r: unknown, idx: number): SentryLog {
  const o = obj(r)
  const attrsRaw = obj(o.attributes ?? o.attrs ?? o.fields)
  const attributes: Record<string, string> = {}
  for (const [k, v] of Object.entries(attrsRaw)) attributes[k] = str(v)
  return {
    id: pickStr(o, ['id', 'logId']) || `${pickStr(o, ['timestamp', 'time'])}-${idx}`,
    timestamp: pickStr(o, ['timestamp', 'time', 'ts']),
    level: (pickStr(o, ['level', 'severity', 'severityText', 'severity_text']) || 'info').toLowerCase(),
    message: pickStr(o, ['message', 'body', 'msg', 'log']),
    logger: pickStr(o, ['logger', 'loggerName', 'source']),
    project: pickStr(o, ['project', 'projectSlug']),
    traceId: pickStr(o, ['traceId', 'traceID', 'trace_id']),
    attributes,
  }
}

export const normalizeLogs = (body: unknown): SentryLog[] => rowsOf(body).map((r, i) => normalizeLog(r, i))

// ── Traces (list + detail) ────────────────────────────────────────────────────

/** A trace list row — the root transaction with roll-up counts. */
export type SentryTrace = {
  traceId: string
  transaction: string
  project: string
  op: string
  service: string
  timestamp: string
  durationMs: number
  spanCount: number
  errorCount: number
  status: string
}

export function normalizeTrace(r: unknown): SentryTrace {
  const o = obj(r)
  return {
    traceId: pickStr(o, ['traceId', 'traceID', 'trace_id', 'id']),
    transaction: pickStr(o, ['transaction', 'name', 'rootTransaction']),
    project: pickStr(o, ['project', 'projectSlug']),
    op: pickStr(o, ['op', 'operation']),
    service: pickStr(o, ['service', 'serviceName', 'rootService']),
    timestamp: pickStr(o, ['timestamp', 'startTimestamp', 'time']),
    durationMs: num(o.durationMs ?? o.duration ?? o.durationMilliseconds),
    spanCount: num(o.spanCount ?? o.spans ?? o.numSpans),
    errorCount: num(o.errorCount ?? o.errors),
    status: str(o.status),
  }
}

export const normalizeTraces = (body: unknown): SentryTrace[] =>
  rowsOf(body).map(normalizeTrace).filter((t) => t.traceId !== '')

/** One span in a trace waterfall. */
export type SentrySpan = {
  spanId: string
  parentSpanId: string
  op: string
  description: string
  service: string
  startMs: number
  durationMs: number
  status: string
}

export function normalizeSpan(r: unknown): SentrySpan {
  const o = obj(r)
  return {
    spanId: pickStr(o, ['spanId', 'spanID', 'span_id', 'id']),
    parentSpanId: pickStr(o, ['parentSpanId', 'parentSpanID', 'parent_span_id']),
    op: pickStr(o, ['op', 'operation']),
    description: pickStr(o, ['description', 'name', 'desc']),
    service: pickStr(o, ['service', 'serviceName']),
    startMs: num(o.startMs ?? o.relativeStartMs ?? o.startTimestampMs),
    durationMs: num(o.durationMs ?? o.duration ?? o.exclusiveTime),
    status: str(o.status),
  }
}

export type SentryTraceDetail = {
  traceId: string
  transaction: string
  project: string
  timestamp: string
  durationMs: number
  spans: SentrySpan[]
}

export function normalizeTraceDetail(body: unknown): SentryTraceDetail {
  const o = obj(unwrap(body))
  const spans = (Array.isArray(o.spans) ? o.spans : rowsOf(o.spans)).map(normalizeSpan)
  return {
    traceId: pickStr(o, ['traceId', 'traceID', 'trace_id', 'id']),
    transaction: pickStr(o, ['transaction', 'name']),
    project: pickStr(o, ['project', 'projectSlug']),
    timestamp: pickStr(o, ['timestamp', 'startTimestamp']),
    durationMs: num(o.durationMs ?? o.duration),
    spans,
  }
}

// ── Stats (event-rate / error-rate timeseries) ────────────────────────────────

/** One point in a stats timeseries — an epoch-ms timestamp + a count. */
export type StatPoint = { ts: number; value: number }

/**
 * Normalize a stats timeseries into `{ts(ms), value}[]`. Accepts the Sentry
 * `[[unixSeconds, count], …]` pair form, a `{data:[[…]]}` wrapper, or an object-row
 * `[{ts,value}]`. Seconds are widened to ms by magnitude so the charts get a real
 * time axis; garbage → [].
 */
export function normalizeStats(body: unknown): StatPoint[] {
  const rows = rowsOf(body)
  const src = rows.length ? rows : Array.isArray(body) ? (body as unknown[]) : []
  const out: StatPoint[] = []
  for (const p of src) {
    if (Array.isArray(p)) {
      let ts = num(p[0])
      if (ts > 0 && ts < 1e11) ts *= 1000 // seconds → ms by magnitude
      out.push({ ts, value: num(p[1]) })
    } else {
      const o = obj(p)
      let ts = num(o.ts ?? o.timestamp ?? o.time ?? o[0])
      if (ts > 0 && ts < 1e11) ts *= 1000
      out.push({ ts, value: num(o.value ?? o.count ?? o.v ?? o[1]) })
    }
  }
  return out
}

// ── Transport ─────────────────────────────────────────────────────────────────

const u = (path: string): string => originV1Url(`o11y/sentinel/${path.replace(/^\/+/, '')}`)

/** Build a `?k=v` query string from a params map, dropping empty values. */
function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export type IssuesQuery = {
  project?: string
  status?: IssueStatus | ''
  query?: string
  sort?: 'lastSeen' | 'firstSeen' | 'freq'
  period?: Period
}

export type LogsQuery = { project?: string; query?: string; level?: string; period?: Period }
export type TracesQuery = { project?: string; query?: string; period?: Period }
export type StatsQuery = { project?: string; field?: string; period?: Period }

/** The `/v1/o11y/sentinel` client — every read org-scoped SERVER-SIDE (no org param). */
export const SentryApi = {
  // ── Projects ──
  projects: async (): Promise<SentryProject[]> => normalizeProjects(await restGet<unknown>(u('projects'))),
  project: async (id: string): Promise<SentryProject> => normalizeProject(unwrap(await restGet<unknown>(u(`projects/${encodeURIComponent(id)}`)))),
  createProject: async (name: string, platform = ''): Promise<SentryProject> =>
    normalizeProject(unwrap(await restPost<unknown>(u('projects'), { name, platform }))),
  rotateKey: async (id: string): Promise<string> =>
    normalizeDsn(await restPost<unknown>(u(`projects/${encodeURIComponent(id)}/keys/rotate`), {})),

  // ── Issues ──
  issues: async (q: IssuesQuery = {}): Promise<SentryIssue[]> =>
    normalizeIssues(await restGet<unknown>(u(`issues${qs(q)}`))),
  issue: async (id: string): Promise<SentryIssueDetail> =>
    normalizeIssueDetail(await restGet<unknown>(u(`issues/${encodeURIComponent(id)}`))),
  updateIssue: async (id: string, status: IssueStatus): Promise<SentryIssue> =>
    normalizeIssue(unwrap(await restPut<unknown>(u(`issues/${encodeURIComponent(id)}`), { status }))),
  issueEvents: async (id: string): Promise<SentryEvent[]> =>
    normalizeEvents(await restGet<unknown>(u(`issues/${encodeURIComponent(id)}/events`))),

  // ── Discover ──
  discover: async (query: DiscoverQuery): Promise<DiscoverResult> =>
    normalizeDiscover(await restPost<unknown>(u('discover'), query)),
  event: async (id: string): Promise<SentryEvent> => normalizeEvent(unwrap(await restGet<unknown>(u(`events/${encodeURIComponent(id)}`)))),

  // ── Logs ──
  logs: async (q: LogsQuery = {}): Promise<SentryLog[]> => normalizeLogs(await restGet<unknown>(u(`logs${qs(q)}`))),

  // ── Traces ──
  traces: async (q: TracesQuery = {}): Promise<SentryTrace[]> => normalizeTraces(await restGet<unknown>(u(`traces${qs(q)}`))),
  trace: async (id: string): Promise<SentryTraceDetail> => normalizeTraceDetail(await restGet<unknown>(u(`traces/${encodeURIComponent(id)}`))),

  // ── Stats ──
  stats: async (q: StatsQuery = {}): Promise<StatPoint[]> => normalizeStats(await restGet<unknown>(u(`stats${qs(q)}`))),
}
