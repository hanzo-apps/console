/**
 * Fleet — the BYO ("bring your own") connect fleet: machines dialed into the org via
 * `hanzo gpu connect`, with LIVE heartbeat.
 *
 * Distinct from the two neighbouring surfaces, and the reason this client exists:
 *  - `/v1/machines` folds these boxes in (provider="byo") but drops the heartbeat.
 *  - `/v1/gpus` expands them to one row per accelerator, also without a heartbeat.
 *  - `GET /v1/fleet/workers` is the ONLY surface carrying the per-box `lastHeartbeat`
 *    (+ capabilities + the hanzo-engine advert), so it is the source of truth for
 *    "which of my machines are online right now".
 *
 * Read over the same-origin `/v1` user-bearer BFF (`fleet` allow-listed in
 * proxy-allow.ts; org resolved from the Bearer owner); on the go:embed console it hits
 * cloud's `/v1/fleet/workers` directly under the first-party session. The backend
 * derives online/offline itself (online iff the last heartbeat is ≤ 90s old — ~1.5×
 * the CLI's 30s beat), so the console renders that verdict rather than recomputing it;
 * every field the backend omits degrades to "—", nothing is fabricated.
 */
import { restGet, cloudProxyV1Url } from './client'
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

/** One connected BYO machine, as `GET /v1/fleet/workers` reports it. */
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
  /** Present when the box also serves models (hanzo-engine). */
  engine?: FleetEngine
}

// ── Defensive normalizers (a field rename upstream degrades a cell, never throws) ──

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

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

// ── API ──────────────────────────────────────────────────────────────────────

export const FleetApi = {
  /** The org's connected BYO fleet with live heartbeat (`GET /v1/fleet/workers`). */
  workers: async (): Promise<FleetWorker[]> => {
    const r = await restGet<unknown>(cloudProxyV1Url('fleet/workers'))
    const arr = Array.isArray(r) ? r : rec(r).workers
    return (Array.isArray(arr) ? arr : []).map((w, i) => normalizeWorker(w, i))
  },
}
