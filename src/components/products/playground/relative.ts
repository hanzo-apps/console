/**
 * relativeTime — a compact "x ago" label for History rows. Pure + unit-tested so
 * the History card shows a real, stable relative time (computed from the run's own
 * timestamp), never a fabricated one.
 */
export function relativeTime(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(at).toLocaleDateString()
}
