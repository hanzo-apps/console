/**
 * Display formatters for the AI Metrics surfaces — pure, display-only.
 *
 * One place so every tile, chart axis, and table cell reads the same. No data is
 * fabricated here; missing/zero values render truthfully (em dash or "$0.00").
 * These are dependency-free so the components that use them lift cleanly into
 * `@hanzo/ui`.
 */

/** USD from cents: "$1.23", "$12.3k" once it gets large. */
export const usd = (cents: number): string => {
  const dollars = cents / 100
  if (dollars !== 0 && Math.abs(dollars) >= 1000) return `$${compact(dollars)}`
  return `$${dollars.toFixed(2)}`
}

/** Whole count with thousands separators: 1234 → "1,234". */
export const count = (n: number): string => Math.round(n).toLocaleString()

/** Compact magnitude: 1500 → "1.5k", 2_300_000 → "2.3M". */
export const compact = (n: number): string => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${trim(n / 1_000_000_000)}B`
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`
  if (abs >= 1_000) return `${trim(n / 1_000)}k`
  return `${Math.round(n)}`
}

/** Tokens as a compact magnitude (token counts get large fast). */
export const tokens = (n: number): string => (n > 0 ? compact(n) : '0')

/** One decimal place, trailing-zero-trimmed: 1.50 → "1.5", 2.0 → "2". */
const trim = (n: number): string => {
  const s = n.toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/** A relative "time ago" for recent-activity rows; absolute date past a week. */
export const ago = (ms: number | null, now: number = Date.now()): string => {
  if (ms === null) return '—'
  const diff = now - ms
  if (diff < 0) return new Date(ms).toLocaleString()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ms).toLocaleDateString()
}

/** Short day label for a `YYYY-MM-DD` key: "Jun 24". */
export const dayLabel = (day: string): string => {
  const d = new Date(`${day}T00:00:00`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
