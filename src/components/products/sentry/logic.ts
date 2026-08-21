// Pure presentation logic for the Hanzo Sentinel panels — summaries, formatters,
// the Discover builder catalogs, and the project SDK snippet. NO React / gui / I/O
// imports (types are erased), so every helper unit-tests in a plain-node suite
// (logic.test.ts) and the panels stay thin views over real `/v1/o11y/sentinel` data.
import type { SentryIssue, StatPoint, Period } from '~/lib/api/sentry'
import type { Slice, ChartPoint } from '~/components/ui/Charts'
import { toneVar, type Tone } from '~/components/ui/tone'

// ── Level → tone (the ONE console map — severity by weight, never hue) ────────

export const LEVEL_TONE: Record<string, Tone> = {
  fatal: 'critical',
  error: 'critical',
  warning: 'warning',
  info: 'neutral',
  debug: 'muted',
}
export const levelColor = (level: string): string => toneVar(LEVEL_TONE[level.toLowerCase()] ?? 'muted')

/** Status color — resolved reads as normal, ignored de-emphasised, unresolved loudest. */
export function statusTone(status: string): string {
  return toneVar(status === 'resolved' ? 'positive' : status === 'ignored' ? 'muted' : 'critical')
}

/** Log/trace-status color, reusing the level ramp (error/warn/ok). */
export function logLevelTone(level: string): string {
  const l = level.toLowerCase()
  if (l === 'error' || l === 'fatal' || l === 'critical') return toneVar('critical')
  if (l === 'warn' || l === 'warning') return toneVar('warning')
  if (l === 'debug' || l === 'trace') return toneVar('muted')
  return toneVar('neutral')
}

// ── Issue KPIs + distribution ─────────────────────────────────────────────────

export type IssueSummary = { total: number; unresolved: number; regressed: number; events: number; users: number }

/** Fold real issue rows into KPI tiles (never fabricated — a sum over what loaded). */
export function summarizeIssues(issues: SentryIssue[]): IssueSummary {
  return {
    total: issues.length,
    unresolved: issues.filter((i) => i.status === 'unresolved').length,
    regressed: issues.filter((i) => i.regressed).length,
    events: issues.reduce((s, i) => s + i.count, 0),
    users: issues.reduce((s, i) => s + i.userCount, 0),
  }
}

/** Issues grouped by severity level → donut slices (real counts, biggest first). */
export function levelSlices(issues: SentryIssue[]): Slice[] {
  const by = new Map<string, number>()
  for (const i of issues) by.set(i.level, (by.get(i.level) ?? 0) + 1)
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([level, value]) => ({ label: level, value, color: levelColor(level) }))
}

// ── Time formatting ───────────────────────────────────────────────────────────

/** Relative "3m ago" (em-dash for an unparseable / empty timestamp). */
export function fmtWhen(iso: string): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

/** Absolute local datetime (em-dash on failure). Accepts an ISO string or epoch-ms. */
export function fmtDateTime(v: string | number): string {
  const t = typeof v === 'number' ? v : Date.parse(v)
  if (!Number.isFinite(t)) return '—'
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

/** Compact count — 1234 → "1.2k", 2_500_000 → "2.5M". */
export function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (a >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`
  return String(Math.round(n))
}

/** Human duration — 42 → "42ms", 2100 → "2.1s". */
export function fmtDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

// ── Time period ───────────────────────────────────────────────────────────────

/** Issue sort options (label ↔ the `sort` query value). */
export const ISSUE_SORTS: { value: 'lastSeen' | 'firstSeen' | 'freq'; label: string }[] = [
  { value: 'lastSeen', label: 'Last seen' },
  { value: 'firstSeen', label: 'First seen' },
  { value: 'freq', label: 'Events' },
]

// ── Stats → chart points ──────────────────────────────────────────────────────

/**
 * Project a stats timeseries onto chart points. The x label is time-of-day for a
 * short window (≤2 days span) and a date otherwise, so the axis reads cleanly at
 * either range. Empty in → empty out (the chart renders its own honest empty).
 */
export function statsToPoints(points: StatPoint[]): ChartPoint[] {
  if (points.length === 0) return []
  const span = points[points.length - 1].ts - points[0].ts
  const intraday = span > 0 && span <= 2 * 86_400_000
  return points.map((p) => {
    const d = new Date(p.ts)
    const label = Number.isNaN(d.getTime())
      ? ''
      : intraday
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    return { label, value: p.value }
  })
}

/** Sum of a stats series (a KPI over the window). */
export const statsTotal = (points: StatPoint[]): number => points.reduce((s, p) => s + p.value, 0)

// ── Discover builder catalogs ─────────────────────────────────────────────────
// The field/op/aggregation vocabulary the query builder offers. Kept here (pure)
// so the builder UI stays declarative and the set is one place to extend.

export const DISCOVER_FIELDS: readonly string[] = [
  'transaction',
  'level',
  'environment',
  'release',
  'platform',
  'error.type',
  'message',
  'user.email',
  'server_name',
  'http.status_code',
]

export const DISCOVER_OPS: readonly string[] = ['=', '!=', 'contains', '>', '<']

export const DISCOVER_AGGREGATIONS: readonly string[] = [
  'count()',
  'count_unique(user)',
  'p50(duration)',
  'p95(duration)',
  'p99(duration)',
  'avg(duration)',
  'failure_rate()',
]

/** A blank filter row for the builder. */
export const emptyFilter = (): { field: string; op: string; value: string } => ({ field: DISCOVER_FIELDS[0], op: '=', value: '' })

// ── Project DSN + SDK snippet ─────────────────────────────────────────────────

/**
 * The ingest endpoint a Sentry-compatible SDK derives from a Hanzo Sentinel DSN.
 * The DSN is the CLEAN path `https://<key>@api.hanzo.ai/v1/event/<project>` (NO
 * `/api/` segment), so the SDK POSTs envelopes to `<host>/v1/event/<project>/envelope/`.
 * Returns '' for an unparseable DSN (never a fabricated URL).
 */
export function ingestUrl(dsn: string): string {
  if (!dsn) return ''
  const at = dsn.indexOf('@')
  if (at < 0) return ''
  const scheme = dsn.startsWith('https://') ? 'https://' : dsn.startsWith('http://') ? 'http://' : 'https://'
  const rest = dsn.slice(at + 1) // host/v1/event/<project>
  return `${scheme}${rest.replace(/\/+$/, '')}/envelope/`
}

/**
 * The copy-paste SDK init for a project. Hanzo Sentinel is Sentry-wire-compatible, so
 * any Sentry SDK points at the Hanzo DSN — no fabricated package. Honest: an absent
 * DSN yields a placeholder the user replaces after creating/rotating a key.
 */
export function sdkSnippet(dsn: string): string {
  const d = dsn || 'https://<key>@api.hanzo.ai/v1/event/<project>'
  return [
    "import * as Sentry from '@sentry/browser'",
    '',
    'Sentry.init({',
    `  dsn: '${d}',`,
    '  tracesSampleRate: 1.0,',
    '})',
  ].join('\n')
}
