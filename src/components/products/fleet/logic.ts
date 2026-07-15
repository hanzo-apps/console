/**
 * Fleet board — the pure view decisions.
 *
 * Everything here is a total function over the normalized `FleetUnit`/`FleetSample`
 * values: labels, capacity lines, filtering, ordering, and the series a chart plots.
 * No React, no icons, no `@hanzo/gui` — so it is unit-tested in the repo's node
 * vitest environment, and the logic that SHIPS is the logic that is tested.
 *
 * The honesty rules live in `~/lib/api/fleet` (a 0 on the unit wire is unknown); this
 * file only ever renders what survived them — an `undefined` becomes `DASH`, never a 0.
 */
import { fmtBytes, fmtPct } from '~/lib/api/agents'
import { DASH } from '~/lib/api/visor'
import {
  freshnessOf,
  isOnline,
  needsAttention,
  type FleetGpu,
  type FleetRange,
  type FleetSample,
  type FleetSpec,
  type FleetUnit,
} from '~/lib/api/fleet'

// ── labels ───────────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  agent: 'Agent',
  byo: 'BYO',
  cloud: 'Cloud',
  visor: 'Visor',
}

/** The source badge text. An unknown source shows ITSELF, not a wrong guess. */
export const sourceLabel = (source?: string): string => (source ? (SOURCE_LABEL[source] ?? source) : DASH)

const SOURCE_HINT: Record<string, string> = {
  agent: 'Linked by an agent or CLI session',
  byo: 'Bring-your-own worker you attached',
  cloud: 'Runs in Hanzo Cloud for your org',
  visor: 'A machine Hanzo manages for you',
}
export const sourceHint = (source?: string): string | undefined => (source ? SOURCE_HINT[source] : undefined)

const KIND_LABEL: Record<string, string> = {
  laptop: 'Laptop',
  cloud: 'Cloud box',
  gpu: 'GPU host',
  cluster: 'Cluster',
  machine: 'Machine',
  worker: 'Worker',
}
export const kindLabel = (kind?: string): string => (kind ? (KIND_LABEL[kind] ?? kind) : DASH)

/** A unit's display name: its label, else the host, else the raw id. Always something real. */
export const unitTitle = (u: FleetUnit): string => u.label || u.host || u.unit

/** The secondary line under the title — the host, unless it is already the title. */
export const unitSubtitle = (u: FleetUnit): string | undefined => (u.host && u.host !== unitTitle(u) ? u.host : undefined)

// ── capacity ─────────────────────────────────────────────────────────────────

/** `2× H100` / `1× GB10 · 1× A100`; DASH when there are none. Groups identical models. */
export function gpuLabel(gpus: FleetGpu[]): string {
  if (!gpus.length) return DASH
  const groups = new Map<string, number>()
  for (const g of gpus) {
    const k = g.model || g.vendor || 'GPU'
    groups.set(k, (groups.get(k) ?? 0) + 1)
  }
  return [...groups].map(([model, n]) => `${n}× ${model}`).join(' · ')
}

/**
 * The capacity line: `linux/arm64 · 20 vCPU · 128 GB · 1× GB10`.
 *
 * Only the parts the host actually reported appear — an unreported CPU count is
 * omitted from the line rather than printed as "0 vCPU". An all-silent spec is DASH.
 */
export function capacityLine(spec: FleetSpec): string {
  const parts: string[] = []
  if (spec.os && spec.arch) parts.push(`${spec.os}/${spec.arch}`)
  else if (spec.os) parts.push(spec.os)
  else if (spec.arch) parts.push(spec.arch)
  if (spec.cpus !== undefined) parts.push(`${spec.cpus} vCPU`)
  if (spec.memory !== undefined) parts.push(fmtBytes(spec.memory))
  if (spec.gpus.length) parts.push(gpuLabel(spec.gpus))
  return parts.length ? parts.join(' · ') : DASH
}

/** A load average as `1.50`; DASH when the host never reported one. */
export const fmtLoad = (n?: number): string => (n === undefined ? DASH : n.toFixed(2))

/** A 0..1 ratio as a percent; DASH when unknown. (Re-exported so views have one import.) */
export const fmtRatio = (x?: number): string => (x === undefined ? DASH : fmtPct(x))

/** `40 GB / 128 GB`; DASH when either half is unknown. */
export const fmtMemPair = (used?: number, total?: number): string =>
  used === undefined || total === undefined ? DASH : `${fmtBytes(used)} / ${fmtBytes(total)}`

/**
 * Load as a fraction of the unit's OWN cores — the only way a load average means
 * anything (1.0 is idle on 20 cores and on fire on 1). May exceed 1: that is a real
 * overload and the caller shows the true number while the bar pins at full.
 * `undefined` when either half is unknown — no denominator, no bar.
 */
export function loadRatio(u: FleetUnit): number | undefined {
  const load = u.metrics.load1
  const cpus = u.spec.cpus
  if (load === undefined || cpus === undefined) return undefined
  return load / cpus
}

// ── health verdict ───────────────────────────────────────────────────────────

/**
 * How a unit reads at a glance. `attention` is the only state that asks for action:
 * the unit says it is online but has stopped reporting.
 */
export type Verdict = 'attention' | 'healthy' | 'draining' | 'quiet'

export function verdictOf(u: FleetUnit, nowS: number): Verdict {
  if (needsAttention(u, nowS)) return 'attention'
  if (u.status === 'draining') return 'draining'
  if (isOnline(u)) return 'healthy'
  return 'quiet'
}

/** Why a unit is flagged — shown next to the pill so the state explains itself. */
export function verdictNote(u: FleetUnit, nowS: number): string | undefined {
  if (verdictOf(u, nowS) !== 'attention') return undefined
  return 'Online but has stopped reporting'
}

/** True when a heartbeat is old enough to dim the live numbers it produced. */
export const isStale = (u: FleetUnit, nowS: number): boolean => freshnessOf(u.metrics.at, nowS) === 'stale'

// ── filtering + ordering ─────────────────────────────────────────────────────

export type FleetFilter = { search?: string; source?: string; status?: string }

/**
 * Filter by source/status and a free-text match over the fields a person would
 * actually type: name, host, id, os/arch and GPU model.
 *
 * The search is a LITERAL case-insensitive substring test — never a compiled RegExp
 * of user input (the repo's ReDoS rule).
 */
export function filterUnits(units: FleetUnit[], f: FleetFilter): FleetUnit[] {
  const q = (f.search ?? '').trim().toLowerCase()
  return units.filter((u) => {
    if (f.source && f.source !== 'all' && (u.source ?? '') !== f.source) return false
    if (f.status && f.status !== 'all' && (u.status ?? '') !== f.status) return false
    if (!q) return true
    const hay = [unitTitle(u), u.host, u.unit, u.source, u.kind, u.spec.os, u.spec.arch, gpuLabel(u.spec.gpus)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}

const RANK: Record<Verdict, number> = { attention: 0, draining: 1, healthy: 2, quiet: 3 }

/**
 * Order the board so what needs attention is at the top: flagged units first, then
 * draining, then healthy, then quiet — each group by name. Mission control is scanned
 * from the top down, so the top must be the thing worth looking at.
 */
export function orderUnits(units: FleetUnit[], nowS: number): FleetUnit[] {
  return [...units].sort((a, b) => {
    const d = RANK[verdictOf(a, nowS)] - RANK[verdictOf(b, nowS)]
    if (d !== 0) return d
    return unitTitle(a).localeCompare(unitTitle(b))
  })
}

/** The source options a filter should offer: only sources actually present, plus `all`. */
export function sourceOptions(units: FleetUnit[]): string[] {
  const seen = new Set<string>()
  for (const u of units) if (u.source) seen.add(u.source)
  return ['all', ...[...seen].sort()]
}

/** The status options actually present, plus `all`. */
export function statusOptions(units: FleetUnit[]): string[] {
  const seen = new Set<string>()
  for (const u of units) if (u.status) seen.add(u.status)
  return ['all', ...[...seen].sort()]
}

// ── the trend ────────────────────────────────────────────────────────────────

export const RANGE_LABEL: Record<FleetRange, string> = { '1h': '1H', '6h': '6H', '24h': '24H', '7d': '7D' }

/** A time label for a sample: clock time inside a day, date beyond it. */
export function sampleLabel(ts: number, range: FleetRange): string {
  const d = new Date(ts * 1000)
  if (range === '7d') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** The numeric fields of a sample a chart can plot. */
export type SampleKey = 'load1' | 'load5' | 'load15' | 'gpuUtil' | 'memUsed' | 'costCents'

/**
 * A sample series as chart points.
 *
 * A row that did not carry this column is SKIPPED, never plotted as 0 — a gap is
 * honest, a false trough is a lie. `gpuUtil` is scaled to a percentage for display.
 */
export function seriesOf(samples: FleetSample[], key: SampleKey, range: FleetRange): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = []
  for (const s of samples) {
    const raw = s[key]
    if (raw === undefined || s.ts === undefined) continue
    out.push({ label: sampleLabel(s.ts, range), value: key === 'gpuUtil' ? raw * 100 : raw })
  }
  return out
}

/** The house rule: fewer than two real points is not a trend. */
export const hasTrend = (points: { value: number }[]): boolean => points.length >= 2

/**
 * The recorded-sessions note.
 *
 * `/v1/fleet` reports a unit's authoritative session counts. `/v1/agents/sessions`
 * has NO per-target filter today, so this board does not fetch a per-unit session
 * LIST — a client-side filter of the org's recent sessions could show "none" for a
 * unit whose own count says 12, and a panel that contradicts the number beside it is
 * worse than no panel. BACKEND FOLLOW-ON: add `?target=` to GET /v1/agents/sessions
 * and this becomes a real list.
 */
export function sessionsSummary(u: FleetUnit): string {
  if (u.sessions === 0) return 'No sessions recorded'
  const plural = u.sessions === 1 ? 'session' : 'sessions'
  return u.running > 0 ? `${u.sessions} ${plural} · ${u.running} running now` : `${u.sessions} ${plural} · none running`
}
