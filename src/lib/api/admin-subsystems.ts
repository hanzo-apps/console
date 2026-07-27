/**
 * Admin SUBSYSTEMS client — the per-subsystem lens on the one cloud binary.
 * GLOBAL-ADMIN only.
 *
 * Reads `/v1/admin/subsystems` through `originGet` — same-origin, so it terminates at
 * the GLOBAL-ADMIN-GATED `app/admin/aggregate` proxy rather than a split-origin
 * `NEXT_PUBLIC_CLOUD_URL` that could route around the console gate.
 *
 * The payload has two halves that fail differently, and the UI must keep them apart:
 * the INVENTORY (name/prefixes/enabled) is the process's own mount index and is always
 * truthful, while the RED signals come from the trace warehouse and can be absent. A
 * row with `requests: 0` therefore means "served nothing" only when the traces source
 * is ok — otherwise it means "we cannot see". `sources[]` carries that distinction.
 *
 * OPTIONAL-SAFE: every field degrades to an honest 0 / empty string; nothing is
 * fabricated.
 */
import { originGet } from './client'

export type TimeRange = '24h' | '7d' | '30d'

/** Freshness of one upstream the board read (mirrors cloud's core.SourceStatus). */
export type SourceStatus = { name: string; ok: boolean; rows: number; error: string; at: string }

/** One subsystem: what it is, whether it is on, and how it behaved. */
export type Subsystem = {
  name: string
  prefixes: string[]
  enabled: boolean
  requests: number
  requestsPerMin: number
  errors: number
  errorRate: number
  latencyP50Ms: number
  latencyP95Ms: number
  latencyP99Ms: number
  lastErrorAt: string
  lastErrorRoute: string
  lastErrorStatus: string
  lastErrorMessage: string
}

export type SubsystemTotals = {
  subsystems: number
  enabled: number
  disabled: number
  /** Enabled AND served at least one traced request in the window. */
  reporting: number
  requests: number
  errors: number
  errorRate: number
}

export type SubsystemBoard = {
  range: TimeRange
  start: string
  end: string
  totals: SubsystemTotals
  rows: Subsystem[]
  sources: SourceStatus[]
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function normalizeSubsystem(raw: unknown): Subsystem {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    name: str(r.name),
    prefixes: arr(r.prefixes).map(str).filter(Boolean),
    enabled: bool(r.enabled),
    requests: num(r.requests),
    requestsPerMin: num(r.requestsPerMin),
    errors: num(r.errors),
    errorRate: num(r.errorRate),
    latencyP50Ms: num(r.latencyP50Ms),
    latencyP95Ms: num(r.latencyP95Ms),
    latencyP99Ms: num(r.latencyP99Ms),
    lastErrorAt: str(r.lastErrorAt),
    lastErrorRoute: str(r.lastErrorRoute),
    lastErrorStatus: str(r.lastErrorStatus),
    lastErrorMessage: str(r.lastErrorMessage),
  }
}

function normalizeSource(raw: unknown): SourceStatus {
  const r = (raw ?? {}) as Record<string, unknown>
  return { name: str(r.name), ok: bool(r.ok), rows: num(r.rows), error: str(r.error), at: str(r.at) }
}

function normalizeBoard(raw: unknown): SubsystemBoard {
  const r = (raw ?? {}) as Record<string, unknown>
  const t = (r.totals ?? {}) as Record<string, unknown>
  return {
    range: (['24h', '7d', '30d'] as const).find((x) => x === r.range) ?? '30d',
    start: str(r.start),
    end: str(r.end),
    totals: {
      subsystems: num(t.subsystems),
      enabled: num(t.enabled),
      disabled: num(t.disabled),
      reporting: num(t.reporting),
      requests: num(t.requests),
      errors: num(t.errors),
      errorRate: num(t.errorRate),
    },
    rows: arr(r.rows).map(normalizeSubsystem),
    sources: arr(r.sources).map(normalizeSource),
  }
}

/** True when the trace warehouse could not be read — a 0 then means "unknown", not "none". */
export function telemetryDown(sources: SourceStatus[]): boolean {
  return sources.some((s) => s.name.startsWith('trace') && !s.ok)
}

export const AdminSubsystemsApi = {
  board: async (range: TimeRange = '30d'): Promise<SubsystemBoard> =>
    normalizeBoard(await originGet<unknown>('admin/subsystems', { range })),
}
