/**
 * Fleet — the BYO ("bring your own") connect fleet: machines dialed into the org via
 * `hanzo gpu connect`, with LIVE heartbeat.
 *
 * Distinct from the two neighbouring surfaces, and the reason this client exists:
 *  - `/v1/visor/machines` folds these boxes in (provider="byo") but drops the heartbeat.
 *  - `/v1/visor/gpus` expands them to one row per accelerator, also without a heartbeat.
 *  - `GET /v1/visor/fleet/workers` is the ONLY surface carrying the per-box `lastHeartbeat`
 *    (+ capabilities + the hanzo-engine advert), so it is the source of truth for
 *    "which of my machines are online right now".
 *
 * Read over the same-origin `/v1` user-bearer BFF (`visor` allow-listed in
 * proxy-allow.ts; org resolved from the Bearer owner); on the go:embed console it hits
 * cloud's `/v1/visor/fleet/workers` directly under the first-party session. The backend
 * derives online/offline itself (online iff the last heartbeat is ≤ 90s old — ~1.5×
 * the CLI's 30s beat), so the console renders that verdict rather than recomputing it;
 * every field the backend omits degrades to "—", nothing is fabricated.
 */
import { restGet, restPost, cloudProxyV1Url, ApiError } from './client'
import { gbOf } from './compute'

/** One accelerator a worker advertises (nvidia-smi name + total memory). */
export type FleetGpu = {
  /** Accelerator name as the host reports it, e.g. `NVIDIA GB10`, `Apple M3 Max`. */
  name?: string
  /** Total accelerator memory in GB (VRAM / unified), parsed from `"131072 MiB"` etc. */
  memoryGb?: number
}

/** The hanzo-engine advert a worker publishes when it serves models (`--serve-engine`). */
export type FleetEngine = {
  url?: string
  /** Served API shapes, e.g. `["openai","anthropic"]`. */
  apis: string[]
  /** Model ids the node's engine exposes. */
  models: string[]
  /** `ready` | `unreachable`. */
  status?: string
}

/** One connected BYO machine, as `GET /v1/visor/fleet/workers` reports it. */
export type FleetWorker = {
  id: string
  hostname?: string
  /** Always `byo` for the connect fleet; drives the BYO badge. */
  provider?: string
  /** `on-prem` (BYO has no cloud region). */
  location?: string
  /** Server-derived liveness: `online` | `offline` (heartbeat ≤ 90s ⇒ online). */
  status?: string
  gpus: FleetGpu[]
  /** RFC3339 timestamp of the last heartbeat — the freshness the status is derived from. */
  lastHeartbeat?: string
  /** RFC3339 timestamp the box first dialed in. */
  firstSeen?: string
  /** Operating system the host reports, e.g. `darwin`, `linux`. */
  os?: string
  /** Worker agent version. */
  version?: string
  /** Advertised capabilities, e.g. `["studio.render","engine.serve"]`. */
  capabilities: string[]
  /** The tasks namespace this worker claims jobs from (`gpu-jobs` by default). */
  jobQueue?: string
  /** Present when the box also serves models (hanzo-engine). */
  engine?: FleetEngine
}

// ── Defensive normalizers (a field rename upstream degrades a cell, never throws) ──

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const numOpt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : undefined

function normalizeFleetGpu(raw: unknown): FleetGpu {
  const r = rec(raw)
  return {
    name: str(r.name) ?? str(r.model) ?? str(r.product),
    memoryGb: gbOf(r.memoryTotal) ?? gbOf(r.memory) ?? gbOf(r.vram) ?? gbOf(r.memoryGb),
  }
}

function normalizeEngine(raw: unknown): FleetEngine | undefined {
  const r = rec(raw)
  if (Object.keys(r).length === 0) return undefined
  return { url: str(r.url), apis: strArr(r.apis), models: strArr(r.models), status: str(r.status) }
}

export function normalizeWorker(raw: unknown, i = 0): FleetWorker {
  const r = rec(raw)
  const id = str(r.id) ?? str(r.hostname) ?? str(r.workflowId) ?? `worker-${i}`
  return {
    id,
    hostname: str(r.hostname) ?? str(r.name) ?? id,
    provider: str(r.provider) ?? 'byo',
    location: str(r.location) ?? str(r.region),
    status: str(r.status) ?? str(r.state),
    gpus: Array.isArray(r.gpus) ? r.gpus.map(normalizeFleetGpu) : [],
    lastHeartbeat: str(r.lastHeartbeat) ?? str(r.last_heartbeat) ?? str(r.lastHeartbeatTime),
    firstSeen: str(r.firstSeen) ?? str(r.first_seen),
    os: str(r.os) ?? str(r.operatingSystem),
    version: str(r.version),
    capabilities: strArr(r.capabilities),
    jobQueue: str(r.jobQueue) ?? str(r.job_queue),
    engine: normalizeEngine(r.engine),
  }
}

// ── Pure view helpers (testable; the section stays presentational) ────────────

/** True iff the backend marks the worker online (heartbeat within its live window). */
export const workerOnline = (w: FleetWorker): boolean => (w.status ?? '').toLowerCase() === 'online'

/**
 * The accelerator label (the box's "arch"): identical accelerators are grouped into
 * `2× NVIDIA GB10`; distinct ones are comma-joined. `—` when the host reported none. PURE.
 */
export function acceleratorLabel(w: FleetWorker): string {
  const names = w.gpus.map((g) => g.name).filter((n): n is string => !!n)
  if (names.length === 0) return '—'
  const counts = new Map<string, number>()
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
  return [...counts.entries()].map(([n, c]) => (c > 1 ? `${c}× ${n}` : n)).join(', ')
}

/** Total accelerator memory across a worker's GPUs (GB), or `undefined` when unreported. PURE. */
export function fleetMemGb(w: FleetWorker): number | undefined {
  const vals = w.gpus.map((g) => g.memoryGb).filter((n): n is number => typeof n === 'number')
  return vals.length ? vals.reduce((a, b) => a + b, 0) : undefined
}

/** True when the box also serves models (hanzo-engine ready, or the advertised capability). PURE. */
export const engineServing = (w: FleetWorker): boolean =>
  (w.engine?.status ?? '').toLowerCase() === 'ready' || w.capabilities.some((c) => c.toLowerCase() === 'engine.serve')

/** Count of online workers in a fleet. PURE. */
export const onlineCount = (workers: FleetWorker[]): number => workers.filter(workerOnline).length

/**
 * Last-heartbeat as compact relative time (`just now`, `12s ago`, `3m ago`, `2h ago`,
 * `4d ago`), or `—` when absent/unparseable. Finer than the shared `sinceText` because a
 * heartbeat beats every ~30s — seconds granularity is meaningful here. PURE.
 */
export function fmtHeartbeat(iso?: string, now: number = Date.now()): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Jobs (the gpu-jobs queue) ─────────────────────────────────────────────────
//
// The connect fleet CLAIMS work from the org's `gpu-jobs` tasks namespace (presence
// is a SEPARATE `fleet` namespace). `GET /v1/visor/fleet/jobs` lists that queue + history:
// one row per activity, carrying the target GPU (`gpu`, ''=shared pool), the claiming
// GPU (`worker`, set once running), status, timings and any failure. This is what makes
// the per-GPU queue VISIBLE (depth + running workflow + history) and MANAGEABLE (cancel).

export type FleetJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled'

/** One gpu-jobs activity as `GET /v1/visor/fleet/jobs` reports it. Missing fields render `—`. */
export type FleetJob = {
  /** Workflow id — the job's stable identity (the cancel target). */
  id: string
  runId?: string
  /** Job/workflow type, e.g. `studio.render`, `echo`. */
  type?: string
  /** `queued | running | completed | failed | canceled` (raw engine states tolerated). */
  status: FleetJobStatus
  /** Target node the job was dispatched to; `''` = shared pool (any eligible GPU). */
  gpu?: string
  /** The GPU/worker id that CLAIMED it (set once running); joins to `FleetWorker.id`. */
  worker?: string
  attempt?: number
  startTime?: string
  closeTime?: string
  lastHeartbeat?: string
  leaseExpiry?: string
  failureCause?: string
}

const JOB_STATES = new Set<FleetJobStatus>(['queued', 'running', 'completed', 'failed', 'canceled'])

/** Coerce any backend status (canonical OR raw `ACTIVITY_TASK_STATE_*`) to a FleetJobStatus.
 *  An UNRECOGNIZED status defaults to a TERMINAL bucket (`completed`), never `queued`: a
 *  future upstream state we don't yet map is far more likely a finished job than a live one,
 *  and misrendering a done job as an active/cancelable queue entry is the dangerous failure.
 *  PURE. */
export function normalizeJobStatus(v: unknown): FleetJobStatus {
  const s = (str(v) ?? '').toLowerCase().replace(/^activity_task_state_/, '')
  if (JOB_STATES.has(s as FleetJobStatus)) return s as FleetJobStatus
  if (s === 'scheduled' || s === 'pending') return 'queued'
  if (s === 'started') return 'running'
  return 'completed'
}

export function normalizeJob(raw: unknown, i = 0): FleetJob {
  const r = rec(raw)
  return {
    id: str(r.id) ?? str(r.workflowId) ?? str(r.workflow_id) ?? `job-${i}`,
    runId: str(r.runId) ?? str(r.run_id),
    type: str(r.type) ?? str(r.activityType) ?? str(r.jobType),
    status: normalizeJobStatus(r.status ?? r.state),
    gpu: str(r.gpu) ?? str(r.target) ?? '',
    worker: str(r.worker) ?? str(r.identity) ?? str(r.claimedBy),
    attempt: numOpt(r.attempt),
    startTime: str(r.startTime) ?? str(r.start_time) ?? str(r.startedAt),
    closeTime: str(r.closeTime) ?? str(r.close_time) ?? str(r.endedAt),
    lastHeartbeat: str(r.lastHeartbeat) ?? str(r.last_heartbeat),
    leaseExpiry: str(r.leaseExpiry) ?? str(r.lease_expiry),
    failureCause: str(r.failureCause) ?? str(r.failure_cause) ?? str(r.error),
  }
}

// ── Board + samples (live utilization; already served, previously unread) ─────

/** One compute unit on the `GET /v1/visor/fleet` board — its live util + running/sessions. */
export type FleetBoardUnit = {
  source: string
  unit: string
  kind?: string
  label?: string
  host?: string
  status?: string
  /** Live GPU utilization as a PERCENT 0..100 (backend 0..1 fraction OR 0..100 tolerated). */
  gpuUtil?: number
  running: number
  sessions: number
  gpus?: number
  gpuModel?: string
}

/** One row of the `GET /v1/visor/fleet/samples` util+cost time series. */
export type FleetSample = {
  unit?: string
  source?: string
  at?: string
  /** GPU utilization as a PERCENT 0..100. */
  gpuUtil?: number
  costCents?: number
}

/** Normalize a utilization value to a 0..100 percent, tolerating a 0..1 fraction. PURE. */
export function utilToPct(v: unknown): number | undefined {
  const n = numOpt(v)
  if (n === undefined) return undefined
  const p = n <= 1 ? n * 100 : n
  return Math.max(0, Math.min(100, Math.round(p)))
}

export function normalizeUnit(raw: unknown): FleetBoardUnit {
  const r = rec(raw)
  const metrics = rec(r.metrics)
  const spec = rec(r.spec)
  return {
    source: str(r.source) ?? '',
    unit: str(r.unit) ?? str(r.id) ?? '',
    kind: str(r.kind),
    label: str(r.label),
    host: str(r.host),
    status: str(r.status),
    gpuUtil: utilToPct(metrics.gpuUtil ?? metrics.gpu_util ?? r.gpuUtil),
    running: numOpt(r.running) ?? 0,
    sessions: numOpt(r.sessions) ?? 0,
    gpus: numOpt(spec.gpus),
    gpuModel: str(spec.gpuModel) ?? str(spec.gpu_model),
  }
}

export function normalizeSample(raw: unknown): FleetSample {
  const r = rec(raw)
  return {
    unit: str(r.unit),
    source: str(r.source),
    at: str(r.at) ?? str(r.timestamp),
    gpuUtil: utilToPct(r.gpuUtil ?? r.gpu_util),
    costCents: numOpt(r.costCents) ?? numOpt(r.cost_cents),
  }
}

// ── Pure view helpers for jobs/board (testable; sections stay presentational) ──

/** A job in a terminal state (its work is done — history, not queue). PURE. */
export const isTerminal = (s: string): boolean => s === 'completed' || s === 'failed' || s === 'canceled'
/** A job still in flight (queued or running). PURE. */
export const jobActive = (j: FleetJob): boolean => j.status === 'queued' || j.status === 'running'

/** A job's stable key (workflow + run) — the identity for row keys + the pending-cancel set. PURE. */
export const jobKey = (j: FleetJob): string => `${j.id}/${j.runId ?? ''}`

/** Jobs that belong to a worker: it CLAIMED them (`worker`) OR they target it (`gpu`). PURE. */
export const jobsForWorker = (jobs: FleetJob[], workerId: string): FleetJob[] =>
  jobs.filter((j) => j.worker === workerId || (!!j.gpu && j.gpu === workerId))

/** Queued jobs, optionally only those TARGETED at one worker (shared-pool jobs excluded). PURE. */
export const queuedJobs = (jobs: FleetJob[], workerId?: string): FleetJob[] =>
  jobs.filter((j) => j.status === 'queued' && (workerId === undefined || j.gpu === workerId))

/** ALL jobs currently RUNNING on a worker (claimed by it, or targeting it). A multi-GPU
 *  box runs concurrent renders, so this is a LIST — the panel must show every one, not a
 *  single job that would contradict the row's own "N running" count. PURE. */
export const runningJobs = (jobs: FleetJob[], workerId: string): FleetJob[] =>
  jobs.filter((j) => j.status === 'running' && (j.worker === workerId || j.gpu === workerId))

/** The FIRST job running on a worker, or undefined (thin wrapper over `runningJobs`). PURE. */
export const runningJob = (jobs: FleetJob[], workerId: string): FleetJob | undefined => runningJobs(jobs, workerId)[0]

/** Queue depth = number of queued jobs (optionally targeted at one worker). PURE. */
export const queueDepth = (jobs: FleetJob[], workerId?: string): number => queuedJobs(jobs, workerId).length

/** Count of running jobs (optionally for one worker). PURE. */
export const runningCount = (jobs: FleetJob[], workerId?: string): number =>
  jobs.filter(
    (j) => j.status === 'running' && (workerId === undefined || j.worker === workerId || j.gpu === workerId),
  ).length

/** A compact queue summary for a worker: `1 running · 2 queued`, or `idle`. PURE. */
export function queueSummary(jobs: FleetJob[], workerId: string): string {
  const r = runningCount(jobs, workerId)
  const q = queueDepth(jobs, workerId)
  if (!r && !q) return 'idle'
  return [r ? `${r} running` : '', q ? `${q} queued` : ''].filter(Boolean).join(' · ')
}

/** Status → pill tone: running=blue, completed=green, failed=red, queued/canceled=neutral. PURE. */
export type JobTone = 'run' | 'ok' | 'down' | 'idle'
export function jobTone(status: string): JobTone {
  switch (status) {
    case 'running':
      return 'run'
    case 'completed':
      return 'ok'
    case 'failed':
      return 'down'
    default:
      return 'idle' // queued | canceled | unknown
  }
}

/** Statuses that mean a board unit is up and doing work-capable duty. */
const UNIT_ONLINE = new Set(['online', 'ready', 'active', 'running', 'up', 'available', 'ok'])
/** True when a unit reports an online/ready status. PURE. */
export const unitOnline = (u: FleetBoardUnit): boolean => UNIT_ONLINE.has((u.status ?? '').toLowerCase())

/**
 * A unit's utilization for averaging/display: the reported `gpuUtil`, OR `0` when the unit
 * is ONLINE but reported no util — an idle online GPU is genuinely at 0%, and the backend
 * omits `gpuUtil` (omitempty) for a 0 value, so treating "missing on an online unit" as `0`
 * both shows the honest 0% AND keeps that unit IN the mean (omitting it would bias the
 * average upward). An OFFLINE unit with no util is truly unknown → `undefined` (excluded). PURE.
 */
export const unitUtil = (u: FleetBoardUnit): number | undefined => (u.gpuUtil ?? (unitOnline(u) ? 0 : undefined))

/** De-duplicate board units by (source, unit), preferring a row that actually reports util,
 *  so a doubled row can't double-count in the mean. PURE. */
export function dedupeUnits(units: FleetBoardUnit[]): FleetBoardUnit[] {
  const by = new Map<string, FleetBoardUnit>()
  for (const u of units) {
    const k = `${u.source}/${u.unit}`
    const prev = by.get(k)
    if (!prev || (prev.gpuUtil === undefined && u.gpuUtil !== undefined)) by.set(k, u)
  }
  return [...by.values()]
}

/**
 * Live GPU utilization % for a worker from the board units. Prefers a matching unit that
 * actually reports util; else, for its representative (BYO) row, an ONLINE unit reads `0`
 * (idle) and an offline one reads `undefined` (unknown). PURE.
 */
export function utilForWorker(units: FleetBoardUnit[], workerId: string): number | undefined {
  const matches = units.filter((u) => u.unit === workerId)
  if (!matches.length) return undefined
  const withUtil = matches.find((u) => u.gpuUtil !== undefined)
  if (withUtil) return withUtil.gpuUtil
  return unitUtil(matches.find((u) => u.source === 'byo') ?? matches[0])
}

/** Mean GPU utilization % across the DISTINCT units that report (or, if online, imply 0)
 *  util, or undefined when none do (no telemetry at all). PURE. */
export function avgGpuUtil(units: FleetBoardUnit[]): number | undefined {
  const vals = dedupeUnits(units)
    .map(unitUtil)
    .filter((n): n is number => typeof n === 'number')
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : undefined
}

/** GPU-util series (percent points, oldest→newest) for the overview sparkline. PURE. */
export function utilSeries(samples: FleetSample[]): number[] {
  return [...samples]
    .filter((s) => s.gpuUtil !== undefined)
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
    .map((s) => s.gpuUtil as number)
}

/** Total metered cost (USD) across the samples window, or undefined. PURE. */
export function totalCostUsd(samples: FleetSample[]): number | undefined {
  const cents = samples.map((s) => s.costCents).filter((n): n is number => typeof n === 'number')
  return cents.length ? cents.reduce((a, b) => a + b, 0) / 100 : undefined
}

/** Compact elapsed time from `start` to `end` (or now, if still running), or `—`. PURE. */
export function fmtDuration(start?: string, end?: string, now: number = Date.now()): string {
  if (!start) return '—'
  const t0 = Date.parse(start)
  if (!Number.isFinite(t0)) return '—'
  const t1 = end ? Date.parse(end) : now
  const s = Math.max(0, Math.floor(((Number.isFinite(t1) ? t1 : now) - t0) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** Title-case a job status for a cell (`running` → `Running`), or `—`. PURE. */
export const fmtJobStatus = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—')

/**
 * A human, actionable message for a FAILED cancel — the specific races the review named:
 * 404 the job is already gone, 409 it finished between polls, 503 the engine is down. Any
 * other error echoes its own message (or a safe fallback). Never swallowed. PURE.
 */
export function cancelErrorMessage(e: unknown): string {
  const status = e instanceof ApiError ? e.status : undefined
  if (status === 404) return 'That job no longer exists — it may have already finished.'
  if (status === 409) return 'That job already finished — there was nothing to cancel.'
  if (status === 503) return 'The GPU engine isn’t ready right now — try again in a moment.'
  const msg = e instanceof Error ? e.message : ''
  return msg || 'Could not cancel the job — please try again.'
}

/**
 * Reconcile the optimistic pending-cancel set against a fresh jobs poll: a key stays
 * pending only while its job is STILL active (queued/running) — once the poll shows it
 * terminal or gone, the cancel has landed and the key is dropped. PURE (returns the kept
 * keys); the caller swaps its Set for these.
 */
export function reconcilePending(pending: string[], freshJobs: FleetJob[]): string[] {
  const active = new Set(freshJobs.filter(jobActive).map(jobKey))
  return pending.filter((k) => active.has(k))
}

// ── API ──────────────────────────────────────────────────────────────────────

export const FleetApi = {
  /** The org's connected BYO fleet with live heartbeat (`GET /v1/visor/fleet/workers`). */
  workers: async (): Promise<FleetWorker[]> => {
    const r = await restGet<unknown>(cloudProxyV1Url('visor/fleet/workers'))
    const arr = Array.isArray(r) ? r : rec(r).workers
    return (Array.isArray(arr) ? arr : []).map((w, i) => normalizeWorker(w, i))
  },

  /** The org's gpu-jobs queue + history (`GET /v1/visor/fleet/jobs?gpu=&status=&limit=`). `limit`
   *  bounds the poll to the backend's recency read so a long-lived org never streams an
   *  unbounded history every few seconds; the response is rendered as-returned (the backend
   *  owns the recency/pagination bound). */
  jobs: async (opts: { gpu?: string; status?: string; limit?: number } = {}): Promise<FleetJob[]> => {
    const q = new URLSearchParams()
    if (opts.gpu) q.set('gpu', opts.gpu)
    if (opts.status) q.set('status', opts.status)
    if (opts.limit) q.set('limit', String(opts.limit))
    const qs = q.toString()
    const r = await restGet<unknown>(cloudProxyV1Url(`visor/fleet/jobs${qs ? `?${qs}` : ''}`))
    const arr = Array.isArray(r) ? r : rec(r).jobs
    return (Array.isArray(arr) ? arr : []).map((j, i) => normalizeJob(j, i))
  },

  /** The unified compute board (`GET /v1/visor/fleet`) — per-unit live util + running/sessions. */
  board: async (): Promise<FleetBoardUnit[]> => {
    const r = await restGet<unknown>(cloudProxyV1Url('visor/fleet'))
    const arr = Array.isArray(r) ? r : rec(r).units
    return (Array.isArray(arr) ? arr : []).map(normalizeUnit)
  },

  /** The org's util+cost time series (`GET /v1/visor/fleet/samples?range=…`). */
  samples: async (query = 'range=24h'): Promise<FleetSample[]> => {
    const r = await restGet<unknown>(cloudProxyV1Url(`visor/fleet/samples${query ? `?${query}` : ''}`))
    const arr = Array.isArray(r) ? r : rec(r).samples
    return (Array.isArray(arr) ? arr : []).map(normalizeSample)
  },

  /** Cancel a queued/running job (`POST /v1/visor/fleet/jobs/:id/cancel`). */
  cancel: (id: string, run?: string, reason?: string): Promise<unknown> =>
    restPost(cloudProxyV1Url(`visor/fleet/jobs/${encodeURIComponent(id)}/cancel`), { run, reason }),
}
