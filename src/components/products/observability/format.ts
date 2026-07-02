/**
 * Display formatters for the observability surfaces — pure, display-only.
 *
 * One place for the trace/session/score value formatting so every list and
 * detail reads the same. No data is fabricated here; missing values render as an
 * em dash.
 */
import type { Score } from '~/lib/api'

/** A timestamp as a locale date-time; empty string for missing/invalid. */
export const fmtDate = (v?: string | null): string => {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString()
}

/** Latency in seconds as "450ms" / "1.23s"; em dash for missing/non-finite/negative. */
export const fmtLatency = (seconds?: number | null): string => {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  return `${seconds.toFixed(2)}s`
}

/** Cost in USD as "$0.0123"; em dash for missing/non-finite/negative. */
export const fmtCost = (usd?: number | null): string => {
  if (usd == null || !Number.isFinite(usd) || usd < 0) return '—'
  if (usd === 0) return '$0'
  return usd < 0.01 ? `$${usd.toFixed(5)}` : `$${usd.toFixed(4)}`
}

/** Token count as a grouped integer; em dash for missing/non-finite. */
export const fmtTokens = (n?: number | null): string =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n).toLocaleString() : '—'

/** Elapsed seconds between two ISO timestamps; null if either is missing. */
export const elapsed = (start?: string | null, end?: string | null): number | null => {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return Number.isFinite(ms) ? ms / 1000 : null
}

/** A score's display value — the number, or its string value for non-numeric. */
export const scoreValue = (s: Score): string => {
  if (s.dataType === 'NUMERIC') return String(s.value)
  return s.stringValue ?? String(s.value)
}

/** Stringify any JSON-ish value safely. */
const stringify = (v: unknown, space?: number): string => {
  try {
    return JSON.stringify(v, null, space)
  } catch {
    return String(v)
  }
}

/** Pretty multi-line JSON for a detail panel; the raw string for strings. */
export const jsonBlock = (v: unknown): string => {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  return stringify(v, 2)
}
