/**
 * Fleet — the org's WHOLE compute surface on ONE board.
 *
 * Every unit the org owns or linked, from four sources, unioned server-side:
 *   agent — a laptop/box a `hanzo code --link` session registered as a run-target
 *   byo   — a bring-your-own worker / on-prem node the org attached
 *   cloud — an in-cloud box the platform runs for the org
 *   visor — a visor-managed machine (the Machines product's inventory)
 *
 * Transport: the same-origin `/v1` user-bearer BFF (`cloudProxyV1Url`), exactly like
 * machines/gpus/agents. The reads authorize on the Bearer OWNER claim and 403 a
 * cookie-only call, so they must address the BFF — which mints a short-lived user
 * token and resolves the org SERVER-SIDE from that token. The `fleet` head is
 * allow-listed in proxy-allow.ts.
 *
 * TENANCY: the org is NEVER a parameter. This client sends no org in a query, a body
 * or a path — a caller cannot ask for another org's fleet, because the only thing
 * that selects a tenant is the token the BFF mints for the signed-in user.
 *
 * HONEST BY CONSTRUCTION — the two wires carry DIFFERENT zero semantics, so they get
 * different rules (see `pos` vs `finite`):
 *   - `/v1/fleet` marshals every spec/metrics field `omitempty`, so a real 0 and a
 *     never-reported field are the SAME bytes. A 0 therefore means UNKNOWN and the
 *     view renders `—` (per contract). Printing "0 load" for a host that never
 *     reported is a fabrication, and this is the file that refuses to make it.
 *   - `/v1/fleet/samples` returns warehouse rows: a row EXISTS because a measurement
 *     happened, so a 0 in it is a real measured value and is kept. An absent column
 *     is a gap the chart skips — a gap is honest, a false 0 is a lie.
 * An upstream field rename degrades a cell to `—`; it never throws and never invents.
 */
import { cloudProxyV1Url, restGet } from './client'

// ── the wire vocabulary (closed sets the backend documents) ──────────────────

/** Where a unit came from. Rendered as the source badge. */
export type FleetSource = 'agent' | 'byo' | 'cloud' | 'visor'
export const FLEET_SOURCES: readonly FleetSource[] = ['agent', 'byo', 'cloud', 'visor']

/** What a unit IS. Drives the kind icon. */
export type FleetKind = 'laptop' | 'cloud' | 'gpu' | 'cluster' | 'machine' | 'worker'
export const FLEET_KINDS: readonly FleetKind[] = ['laptop', 'cloud', 'gpu', 'cluster', 'machine', 'worker']

/** A unit's declared lifecycle. Rendered as the status pill. */
export type FleetStatus = 'online' | 'offline' | 'draining'
export const FLEET_STATUSES: readonly FleetStatus[] = ['online', 'offline', 'draining']

/** The utilization-trend windows `/v1/fleet/samples` accepts. */
export type FleetRange = '1h' | '6h' | '24h' | '7d'
export const FLEET_RANGES: readonly FleetRange[] = ['1h', '6h', '24h', '7d']

// ── the view types ───────────────────────────────────────────────────────────

/** One accelerator on a unit. `memory` is VRAM BYTES; absent = unknown. */
export type FleetGpu = { vendor?: string; model?: string; memory?: number }

/** What a unit IS — static capability. `memory` is total RAM BYTES. */
export type FleetSpec = { os?: string; arch?: string; cpus?: number; memory?: number; gpus: FleetGpu[] }

/** What a unit is DOING — the last heartbeat. Bytes for memory, 0..1 for gpuUtil. */
export type FleetMetrics = {
  load1?: number
  load5?: number
  load15?: number
  memUsed?: number
  memFree?: number
  /** Aggregate utilization, 0..1. */
  gpuUtil?: number
  /** Unix SECONDS the server stamped this heartbeat. The staleness clock. */
  at?: number
}

/**
 * One unit of the org's compute.
 *
 * `source`/`kind`/`status` are typed as plain strings, not the unions above: the
 * backend owns those vocabularies, and a word it adds later must render honestly
 * (its own label, a neutral tone) rather than be silently coerced into a lie. The
 * unions + `isOnline`/`sourceOf`/`kindOf` are how a caller reads them safely.
 */
export type FleetUnit = {
  /** The unit id. Unique WITHIN a source — `(source, unit)` is the identity. */
  unit: string
  source?: string
  kind?: string
  status?: string
  label?: string
  host?: string
  spec: FleetSpec
  metrics: FleetMetrics
  /** Sessions recorded against this unit. Absent ⇒ none ⇒ 0 (see `count`). */
  sessions: number
  /** Of those, currently running. */
  running: number
}

/** One row of a unit's utilization trend. `ts` is unix SECONDS. */
export type FleetSample = {
  ts?: number
  cpus?: number
  memory?: number
  memUsed?: number
  memFree?: number
  load1?: number
  load5?: number
  load15?: number
  /** 0..1. */
  gpuUtil?: number
  gpus?: number
  gpuModel?: string
  costCents?: number
}

// ── defensive readers ────────────────────────────────────────────────────────

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/**
 * A finite number from a JSON value — including a numeric STRING, because the
 * warehouse serializes 64-bit ints as strings. `undefined` for anything else.
 */
const num = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/**
 * A REPORTED capacity/telemetry value on `/v1/fleet`: finite and > 0, else undefined.
 *
 * The `omitempty` wire cannot distinguish a real 0 from a never-reported field, so 0
 * must read as UNKNOWN — the view prints `—`. This is the rule that keeps an idle-
 * looking "0.00 load" off a host that has said nothing at all.
 */
const pos = (v: unknown): number | undefined => {
  const n = num(v)
  return n !== undefined && n > 0 ? n : undefined
}

/**
 * A measured value on a `/v1/fleet/samples` row: any finite number, 0 INCLUDED.
 * The row exists because a measurement happened, so its 0 is real data.
 */
const finite = (v: unknown): number | undefined => num(v)

/**
 * A count WE keep (sessions/running). Absent ⇒ we hold no rows ⇒ 0 is the truth,
 * not a fabrication — unlike host telemetry, whose absence means the host was silent.
 */
const count = (v: unknown): number => {
  const n = num(v)
  return n !== undefined && n > 0 ? Math.floor(n) : 0
}

/** Read the first present key (wire tolerance: snake_case AND camelCase). */
const pick = (r: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null) return r[k]
  return undefined
}

/** Pull the first array under any common envelope key (else `[]` — never throws). */
const arrayUnder = (payload: unknown, keys: string[]): unknown[] => {
  if (Array.isArray(payload)) return payload
  const o = rec(payload)
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[]
  // One level of nesting — a `{status,data:{units}}` envelope.
  const d = rec(o.data)
  for (const k of keys) if (Array.isArray(d[k])) return d[k] as unknown[]
  return []
}

/** A ratio clamped to the documented 0..1. Out-of-range is a bug — bound it, don't trust it. */
const ratio = (v: unknown): number | undefined => {
  const n = pos(v)
  return n === undefined ? undefined : Math.min(1, n)
}

// ── normalizers ──────────────────────────────────────────────────────────────

export function normalizeGpu(raw: unknown): FleetGpu {
  const r = rec(raw)
  return { vendor: str(r.vendor), model: str(r.model), memory: pos(r.memory) }
}

export function normalizeSpec(raw: unknown): FleetSpec {
  const r = rec(raw)
  const gpus = Array.isArray(r.gpus) ? r.gpus.map(normalizeGpu) : []
  return { os: str(r.os), arch: str(r.arch), cpus: pos(r.cpus), memory: pos(r.memory), gpus }
}

export function normalizeMetrics(raw: unknown): FleetMetrics {
  const r = rec(raw)
  return {
    load1: pos(r.load1),
    load5: pos(r.load5),
    load15: pos(r.load15),
    memUsed: pos(pick(r, 'memUsed', 'mem_used')),
    memFree: pos(pick(r, 'memFree', 'mem_free')),
    gpuUtil: ratio(pick(r, 'gpuUtil', 'gpu_util')),
    at: pos(r.at),
  }
}

/** One unit. Returns null for a row with no id — an unaddressable unit is dropped, not faked. */
export function normalizeUnit(raw: unknown): FleetUnit | null {
  const r = rec(raw)
  const unit = str(pick(r, 'unit', 'id', 'unitId'))
  if (!unit) return null
  return {
    unit,
    source: str(r.source),
    kind: str(r.kind),
    status: str(r.status),
    label: str(r.label),
    host: str(r.host),
    spec: normalizeSpec(r.spec),
    metrics: normalizeMetrics(r.metrics),
    sessions: count(r.sessions),
    running: count(r.running),
  }
}

/** `{units:[…]}` (the contract), or a bare array / `{items}` / `{data:{units}}`. */
export function normalizeUnits(payload: unknown): FleetUnit[] {
  return arrayUnder(payload, ['units', 'items', 'rows'])
    .map(normalizeUnit)
    .filter((u): u is FleetUnit => u !== null)
}

/**
 * Unix SECONDS from a sample timestamp. Tolerates seconds, milliseconds and an ISO
 * string, because the column's unit is the backend's choice and a chart that silently
 * plots milliseconds-as-seconds is wrong by 50,000 years.
 */
export function sampleSeconds(v: unknown): number | undefined {
  const n = num(v)
  if (n !== undefined && n > 0) return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n)
  const s = str(v)
  if (!s) return undefined
  const t = Date.parse(s)
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined
}

export function normalizeSample(raw: unknown): FleetSample {
  const r = rec(raw)
  return {
    ts: sampleSeconds(pick(r, 'ts', 'timestamp', 'time')),
    cpus: finite(r.cpus),
    memory: finite(r.memory),
    memUsed: finite(pick(r, 'mem_used', 'memUsed')),
    memFree: finite(pick(r, 'mem_free', 'memFree')),
    load1: finite(r.load1),
    load5: finite(r.load5),
    load15: finite(r.load15),
    gpuUtil: finite(pick(r, 'gpu_util', 'gpuUtil')),
    gpus: finite(r.gpus),
    gpuModel: str(pick(r, 'gpu_model', 'gpuModel')),
    costCents: finite(pick(r, 'cost_cents', 'costCents')),
  }
}

/** Samples, oldest-first (a trend reads left-to-right); rows with no `ts` are dropped. */
export function normalizeSamples(payload: unknown): FleetSample[] {
  return arrayUnder(payload, ['samples', 'rows', 'items', 'series'])
    .map(normalizeSample)
    .filter((s) => s.ts !== undefined)
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
}

// ── pure value logic (the board's decisions, testable without a browser) ──────

/** A heartbeat older than this is stale — the unit stopped reporting. */
export const STALE_AFTER_S = 120

/** Is this heartbeat current, old, or was there never one? */
export type Freshness = 'fresh' | 'stale' | 'unknown'

/**
 * Freshness of a heartbeat. THREE states, deliberately: a unit that never reported
 * is `unknown`, NOT `stale` — we have no evidence it went quiet, so claiming it did
 * would be as much an invention as claiming it is fine.
 *
 * A future `at` (the server's clock ahead of the browser's) is `fresh`, never a
 * negative age.
 */
export function freshnessOf(at: number | undefined, nowS: number): Freshness {
  if (!at) return 'unknown'
  return nowS - at > STALE_AFTER_S ? 'stale' : 'fresh'
}

/** "12s ago" / "4m ago" / "3h ago" / "2d ago"; `—` when the unit never reported. */
export function agoLabel(at: number | undefined, nowS: number, dash = '—'): string {
  if (!at) return dash
  const age = Math.max(0, nowS - at)
  if (age < 60) return `${Math.floor(age)}s ago`
  if (age < 3600) return `${Math.floor(age / 60)}m ago`
  if (age < 86400) return `${Math.floor(age / 3600)}h ago`
  return `${Math.floor(age / 86400)}d ago`
}

/** True only for a unit the backend declares online. Anything else fails closed. */
export const isOnline = (u: FleetUnit): boolean => u.status === 'online'

/**
 * The one signal worth an operator's attention: a unit that CLAIMS to be online but
 * has stopped reporting. Offline is an expected absence, and a unit that never
 * reported metrics (a cluster, say) is not a fault — neither is flagged.
 */
export const needsAttention = (u: FleetUnit, nowS: number): boolean =>
  isOnline(u) && freshnessOf(u.metrics.at, nowS) === 'stale'

/** Memory in use as a 0..1 ratio, or undefined when either half is unreported. */
export function memRatio(m: FleetMetrics): number | undefined {
  const total = memTotal(m)
  if (total === undefined || m.memUsed === undefined) return undefined
  return Math.min(1, m.memUsed / total)
}

/** Total RAM the heartbeat implies (used + free), or undefined if neither is known. */
export function memTotal(m: FleetMetrics): number | undefined {
  if (m.memUsed === undefined && m.memFree === undefined) return undefined
  return (m.memUsed ?? 0) + (m.memFree ?? 0)
}

/**
 * The summary strip.
 *
 * Every total carries the number of units that actually REPORTED it (`*From`), so the
 * tile can say "across 4 of 7" rather than pass a partial sum off as the whole fleet.
 * `gpuUtil` is the mean over REPORTING units only — averaging a silent unit in as 0
 * would invent an idle machine and drag the fleet's number toward a comfortable lie.
 */
export type FleetSummary = {
  total: number
  online: number
  /** Online but no longer reporting — the "needs attention" count. */
  stale: number
  cpus?: number
  cpusFrom: number
  memory?: number
  memoryFrom: number
  gpus?: number
  gpusFrom: number
  gpuUtil?: number
  gpuUtilFrom: number
}

export function summarize(units: FleetUnit[], nowS: number): FleetSummary {
  let cpus = 0
  let cpusFrom = 0
  let memory = 0
  let memoryFrom = 0
  let gpus = 0
  let gpusFrom = 0
  let utilSum = 0
  let gpuUtilFrom = 0
  let online = 0
  let stale = 0

  for (const u of units) {
    if (isOnline(u)) online += 1
    if (needsAttention(u, nowS)) stale += 1
    if (u.spec.cpus !== undefined) {
      cpus += u.spec.cpus
      cpusFrom += 1
    }
    if (u.spec.memory !== undefined) {
      memory += u.spec.memory
      memoryFrom += 1
    }
    if (u.spec.gpus.length > 0) {
      gpus += u.spec.gpus.length
      gpusFrom += 1
    }
    if (u.metrics.gpuUtil !== undefined) {
      utilSum += u.metrics.gpuUtil
      gpuUtilFrom += 1
    }
  }

  return {
    total: units.length,
    online,
    stale,
    cpus: cpusFrom > 0 ? cpus : undefined,
    cpusFrom,
    memory: memoryFrom > 0 ? memory : undefined,
    memoryFrom,
    gpus: gpusFrom > 0 ? gpus : undefined,
    gpusFrom,
    gpuUtil: gpuUtilFrom > 0 ? utilSum / gpuUtilFrom : undefined,
    gpuUtilFrom,
  }
}

/** One unit's `(source, unit)` identity as a stable key. */
export const unitKey = (u: Pick<FleetUnit, 'source' | 'unit'>): string => `${u.source ?? ''}/${u.unit}`

/** Find a unit by its `(source, unit)` pair — the identity a detail route carries. */
export const findUnit = (units: FleetUnit[], source: string, unit: string): FleetUnit | undefined =>
  units.find((u) => u.unit === unit && (u.source ?? '') === source)

// ── transport ────────────────────────────────────────────────────────────────

const fleetUrl = (path: string, query?: Record<string, string | undefined>): string => {
  const base = cloudProxyV1Url(path)
  if (!query) return base
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, v)
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

/** The trend query. NO org — the BFF resolves the tenant from the bearer. */
export type SamplesQuery = { unit: string; source?: string; range?: FleetRange }

export const FleetApi = {
  /** GET /v1/fleet → every unit the org owns or linked. */
  units: async (): Promise<FleetUnit[]> => normalizeUnits(await restGet<unknown>(fleetUrl('fleet'))),

  /** GET /v1/fleet/samples?unit&source&range → one unit's utilization trend. */
  samples: async (q: SamplesQuery): Promise<FleetSample[]> =>
    normalizeSamples(
      await restGet<unknown>(fleetUrl('fleet/samples', { unit: q.unit, source: q.source, range: q.range ?? '24h' })),
    ),
}
