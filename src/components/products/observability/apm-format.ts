/**
 * Display formatters for the APM / infra / exceptions surfaces — pure, display-only.
 *
 * O11y reports in its OWN units (latency in NANOSECONDS, throughput as a
 * per-second rate, utilization as a 0..1 fraction), distinct from the LLM-trace
 * `format.ts` (latency in seconds, cost in USD). Keeping these separate is
 * separation of concerns: one module per unit system. No data is fabricated —
 * missing / non-finite values render as an em dash.
 *
 * Units the WHOLE console shares (bytes, "how long ago") are not o11y-specific: they
 * live in `~/lib/format` and are aliased here, so there is one implementation.
 */
import { toneVar } from '~/components/ui/tone'
import { DASH, ago, bytes } from '~/lib/format'

/** Nanosecond latency → "450ms" / "1.23s" / "820µs"; em dash for missing/negative. */
export const fmtNs = (ns?: number | null): string => {
  if (ns == null || !Number.isFinite(ns) || ns < 0) return DASH
  const ms = ns / 1_000_000
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  if (ms >= 1) return `${ms.toFixed(ms >= 100 ? 0 : 1)}ms`
  const us = ns / 1000
  if (us >= 1) return `${us.toFixed(0)}µs`
  return `${Math.round(ns)}ns`
}

/** A per-second rate → "12.3 /s" (2 sig digits under 10, else integer); em dash if absent. */
export const fmtRate = (rate?: number | null): string => {
  if (rate == null || !Number.isFinite(rate) || rate < 0) return DASH
  if (rate === 0) return '0 /s'
  if (rate < 10) return `${rate.toFixed(2)} /s`
  if (rate < 100) return `${rate.toFixed(1)} /s`
  return `${Math.round(rate).toLocaleString()} /s`
}

/** A 0..1 fraction OR a 0..100 percent → "12.3%". Values >1 are treated as already-%. */
export const fmtPct = (v?: number | null): string => {
  if (v == null || !Number.isFinite(v) || v < 0) return DASH
  const pct = v <= 1 ? v * 100 : v
  return `${pct.toFixed(pct >= 10 || pct === 0 ? 0 : 1)}%`
}

/** A grouped integer count; em dash for missing/non-finite. */
export const fmtCount = (n?: number | null): string =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n).toLocaleString() : DASH

/** Bytes → "1.5 GB" / "820 MB"; em dash for missing/negative. Base-1024. */
export const fmtBytes = bytes

/**
 * A CPU utilization fraction → "0.42 cores" when it looks like an absolute core
 * count (>1), else a percent. Node/pod CPU usage is reported in cores; host CPU is
 * a 0..1 fraction — this reads either honestly.
 */
export const fmtCores = (v?: number | null): string => {
  if (v == null || !Number.isFinite(v) || v < 0) return DASH
  if (v === 0) return '0'
  return v < 1 ? `${(v * 100).toFixed(0)}%` : `${v.toFixed(2)} cores`
}

/** A short "how long ago" for a timestamp (e.g. "3m ago", "2h ago"); em dash if absent. */
export const fmtAgo = ago

/** The weight an error rate (0..1 or 0..100) carries — calm, warn, hot. Greyscale by design. */
export const errorTone = (rate?: number | null): string => {
  const pct = rate == null ? 0 : rate <= 1 ? rate * 100 : rate
  if (!Number.isFinite(pct) || pct <= 0) return toneVar('positive')
  if (pct < 5) return toneVar('warning')
  return toneVar('critical')
}
