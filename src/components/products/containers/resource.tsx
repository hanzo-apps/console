/**
 * Compact relative age for the Containers boards. PURE — no I/O, no React.
 */

/** Relative age from an ISO/epoch timestamp (`3d`, `5h`, `12m`, `now`), or '—'. */
export function fmtAge(v: unknown): string {
  if (typeof v !== 'string' && typeof v !== 'number') return '—'
  const d = new Date(typeof v === 'number' ? v : /^\d+$/.test(v) ? Number(v) * 1000 : v)
  const t = d.getTime()
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
