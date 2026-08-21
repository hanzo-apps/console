/**
 * Router observability — the PURE view logic for `RouterModule`'s Overview.
 *
 * Dependency-free by construction (no React, no @hanzo/gui, no registry), so it
 * unit-tests in node and is the single home for the honest-state decisions:
 *   - a partial/garbage `/v1/ai/router/stats` payload → a well-formed `RouterStats`
 *     with honest defaults (`normalizeStats`), never a throw at render;
 *   - a nullable/absent metric → an em-dash "—" (never a fabricated number);
 *   - the cost indices are labeled a BLENDED $/MTok PROXY, not billed dollars
 *     (the routing ledger carries no per-token counts);
 *   - `shadow_agreement` reads null → "not available yet", never 0%.
 *
 * The component keeps only presentation (tiles, donuts, the toggle); every number
 * it renders comes from here.
 */
import type { RouterStats, CostStats, QualityStats } from '~/lib/api/router'

const EM_DASH = '—'

// ── defensive coercion (the transport boundary) ──────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true
/** A finite number OR null (the nullable $ index / shadow_agreement contract). */
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Coerce a `{ <key>: count }` map to a clean `Record<string, number>` (finite, >0 kept as-is). */
function countMap(v: unknown): Record<string, number> {
  if (!isRecord(v)) return {}
  const out: Record<string, number> = {}
  for (const [k, val] of Object.entries(v)) if (typeof k === 'string' && k) out[k] = num(val)
  return out
}

/**
 * Normalize any `/v1/ai/router/stats` payload into a well-formed `RouterStats`. The
 * backend contract is trusted but partial-safe: a missing block degrades to an
 * honest empty (no cost, empty distributions, zero window) rather than throwing
 * during render. `cost` stays absent (null) when there are no priced events so the
 * caller shows "—" — never $0 as if it were measured.
 */
export function normalizeStats(raw: unknown): RouterStats {
  const r = isRecord(raw) ? raw : {}
  const win = isRecord(r.window) ? r.window : {}
  const q = isRecord(r.quality) ? r.quality : {}
  const tp = isRecord(r.throughput) ? r.throughput : {}

  const quality: QualityStats = {
    reward_rate: num(q.reward_rate),
    rewarded_events: num(q.rewarded_events),
    engine_share: num(q.engine_share),
    avg_confidence: num(q.avg_confidence),
    shadow_agreement: numOrNull(q.shadow_agreement),
  }

  const by_task: RouterStats['by_task'] = {}
  if (isRecord(r.by_task)) {
    for (const [task, ts] of Object.entries(r.by_task)) {
      if (!isRecord(ts)) continue
      by_task[task] = { events: num(ts.events), models: countMap(ts.models) }
    }
  }

  let cost: CostStats | null = null
  if (isRecord(r.cost)) {
    const c = r.cost
    cost = {
      routed_index: numOrNull(c.routed_index),
      counterfactual_index: numOrNull(c.counterfactual_index),
      saved_pct: num(c.saved_pct),
      cumulative_saved_index: num(c.cumulative_saved_index),
      baseline_model: str(c.baseline_model),
      priced_events: num(c.priced_events),
    }
  }

  const stats: RouterStats = {
    scope: str(r.scope),
    org: str(r.org) || undefined,
    window: { since: str(win.since), until: str(win.until), events: num(win.events) },
    cost,
    quality,
    by_task,
    by_model: countMap(r.by_model),
    throughput: {
      per_hour: Array.isArray(tp.per_hour) ? tp.per_hour.map(num) : [],
      total_window: num(tp.total_window),
    },
    retrain: null,
  }

  if (isRecord(r.retrain)) {
    const m = r.retrain
    stats.retrain = {
      version: str(m.version),
      trained_time: str(m.trained_time),
      events: num(m.events),
      gate_passed: bool(m.gate_passed),
      published: bool(m.published),
      gate_kind: str(m.gate_kind),
      gate_metric: str(m.gate_metric),
      gate_value: num(m.gate_value),
      gate_base: num(m.gate_base),
      note: str(m.note),
    }
  }
  return stats
}

// ── honest predicates ────────────────────────────────────────────────────────

/** Any routing events landed in the window (drives empty-state vs. board). */
export const hasActivity = (s: RouterStats): boolean => s.window.events > 0
/** Cost is measurable only when at least one served model had a known price. */
export const hasPricedCost = (s: RouterStats): boolean => !!s.cost && s.cost.priced_events > 0

// ── formatters (honest "—" for absent/non-finite) ────────────────────────────

/** A blended $/MTok PROXY index → `$1.23`; null/absent → "—". NOT billed dollars. */
export function moneyIndex(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(2)}` : EM_DASH
}

/** A 0..1 fraction → an integer percent (`73%`); null → "—". */
export function fractionPct(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 100)}%` : EM_DASH
}

/** Cost saved headline — `saved_pct` (already a percentage) when priced, else "—". */
export function savedPctLabel(s: RouterStats): string {
  return hasPricedCost(s) && s.cost ? `${s.cost.saved_pct.toFixed(1)}%` : EM_DASH
}

/**
 * The learned reward proxy. Honest "—" with no rewarded events; a percentage when
 * the reward reads as a 0..1 rate; a raw 2-decimal otherwise (a reward outside the
 * unit interval is shown verbatim, never coerced into a fake percentage).
 */
export function rewardLabel(q: QualityStats): string {
  if (q.rewarded_events <= 0) return EM_DASH
  const r = q.reward_rate
  if (!Number.isFinite(r)) return EM_DASH
  return r >= 0 && r <= 1 ? `${Math.round(r * 100)}%` : r.toFixed(2)
}

/** Shadow agreement is null until a shadow model is scored → the caller says "not available yet". */
export function shadowAgreementLabel(q: QualityStats): string | null {
  return q.shadow_agreement == null ? null : fractionPct(q.shadow_agreement)
}

/** A labelled magnitude with no color (the view assigns polychrome from CHART_PALETTE). */
export type NamedValue = { label: string; value: number }

/** Routed-model distribution, highest count first, zeros dropped. */
export function modelSlices(by_model: Record<string, number>): NamedValue[] {
  return Object.entries(by_model)
    .filter(([, v]) => v > 0)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
}

/** Per-task breakdown: tasks by event volume, each with its models by share. */
export type TaskBreakdown = { task: string; events: number; models: NamedValue[] }

export function taskBreakdown(by_task: RouterStats['by_task']): TaskBreakdown[] {
  return Object.entries(by_task)
    .map(([task, ts]) => ({ task, events: ts.events, models: modelSlices(ts.models) }))
    .filter((t) => t.models.length > 0)
    .sort((a, b) => b.events - a.events)
}

/**
 * The throughput series (one point per bucket). Value = the bucket count; label =
 * the bucket's UTC clock time (`HH:mm`) derived from the window (the backend
 * window is UTC), falling back to a 1-based index when the window is unparseable.
 * Deterministic (UTC) so it renders identically everywhere and unit-tests cleanly.
 */
export function throughputSeries(s: RouterStats): NamedValue[] {
  const per = s.throughput.per_hour
  if (per.length === 0) return []
  const start = Date.parse(s.window.since)
  const end = Date.parse(s.window.until)
  const step = Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / per.length : NaN
  return per.map((value, i) => ({
    label: Number.isFinite(step) ? hhmmUTC(start + i * step) : String(i + 1),
    value,
  }))
}

/** `HH:mm` in UTC for a ms epoch (the window instants are UTC RFC3339). */
function hhmmUTC(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/**
 * The one-line retrain summary (f): "Last retrained <time> · gate <kind> <metric>
 * <value> vs <base> · <verdict>", with the honest verdict (published vs. gate
 * passed vs. kept incumbent) and an optional trailing note. Null when no retrain.
 */
export function retrainLine(s: RouterStats): string | null {
  const m = s.retrain
  if (!m) return null
  const when = m.trained_time || 'unknown time'
  const gate = `gate ${m.gate_kind || '—'} ${m.gate_metric || '—'} ${m.gate_value.toFixed(3)} vs ${m.gate_base.toFixed(3)}`
  const verdict = m.published ? 'published' : m.gate_passed ? 'gate passed, not published' : 'kept incumbent'
  const note = m.note ? ` — ${m.note}` : ''
  return `Last retrained ${when} · ${gate} · ${verdict}${note}`
}

// ── window range selector (24h / 7d / 30d) ───────────────────────────────────

export type RouterRange = '24h' | '7d' | '30d'
export const ROUTER_RANGES: RouterRange[] = ['24h', '7d', '30d']

/** Hours for a range (server caps at 90d; all three are within the cap). */
export function hoursFor(range: RouterRange): number {
  switch (range) {
    case '7d':
      return 24 * 7
    case '30d':
      return 24 * 30
    default:
      return 24
  }
}
