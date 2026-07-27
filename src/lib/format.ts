/**
 * Display formatting — the ONE way the console renders money, counts, percentages,
 * dates, durations and sizes. Pure, no React (vitest runs `environment: 'node'`).
 *
 * Money is ALWAYS integer USD cents in — that is the shape every `/v1` money field
 * carries — and ALWAYS renders with exactly two decimals, so `$5` can never sit in a
 * column beside `$5.00`. An absent or non-finite value reads as an em dash: an honest
 * "we don't have this", never a fabricated 0.
 */

/** What an absent value reads as. Never '0', never ''. */
export const DASH = '—'

/** The one absent-value gate: a finite number, or null. */
const num = (n: number | null | undefined): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? n : null

/** A refund/debit reads `-$5.00`, never `$-5.00` — the sign leads the amount. */
const signed = (v: number, body: string): string => (v < 0 ? '-' : '') + '$' + body

/** Integer cents → `$1,234.56`. Always two decimals. */
export function usd(cents: number | null | undefined): string {
  const v = num(cents)
  if (v === null) return DASH
  return signed(v, Math.abs(v / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
}

/** Integer cents → `$1.2k` / `$3.4M` for headline figures; exact `usd` under $1k. */
export function usdCompact(cents: number | null | undefined): string {
  const v = num(cents)
  if (v === null) return DASH
  const abs = Math.abs(v / 100)
  const short = (div: number, suffix: string) => signed(v, (abs / div).toFixed(1).replace(/\.0$/, '') + suffix)
  if (abs >= 1e9) return short(1e9, 'B')
  if (abs >= 1e6) return short(1e6, 'M')
  if (abs >= 1e3) return short(1e3, 'k')
  return usd(v)
}

/** A grouped integer count → `1,234`. */
export function int(n: number | null | undefined): string {
  const v = num(n)
  return v === null ? DASH : Math.round(v).toLocaleString('en-US')
}

/** An ALREADY-percent number → `12.3%` (`dp` decimals, default 1). */
export function pct(n: number | null | undefined, dp = 1): string {
  const v = num(n)
  return v === null ? DASH : `${v.toFixed(dp)}%`
}

/** An ISO timestamp → its calendar day, `2026-07-27`. */
export function shortDate(s: string | null | undefined): string {
  if (!s) return DASH
  return s.split('T')[0] || s
}

/** An ISO timestamp → the viewer's locale date + time. */
export function dateTime(s: string | null | undefined): string {
  if (!s) return DASH
  const t = Date.parse(s)
  return Number.isNaN(t) ? DASH : new Date(t).toLocaleString()
}

/** An ISO timestamp → how long ago, `45s ago` / `3m ago` / `2d ago`. */
export function ago(s: string | null | undefined): string {
  if (!s) return DASH
  const t = new Date(s).getTime()
  if (!Number.isFinite(t)) return DASH
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (sec < 60) return `${sec}s ago`
  const m = Math.round(sec / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** Milliseconds → `124ms` / `1.2s`. */
export function ms(n: number | null | undefined): string {
  const v = num(n)
  if (v === null || v < 0) return DASH
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`
}

/** Bytes → `1.5 GB` / `820 MB`. Base-1024. */
export function bytes(n: number | null | undefined): string {
  const v = num(n)
  if (v === null || v < 0) return DASH
  if (v === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(v) / Math.log(1024)))
  const scaled = v / Math.pow(1024, i)
  return `${scaled.toFixed(scaled >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

/** A GiB count → `500 GiB` / `12.5 TiB` (thousands-grouped, never a bare number). */
export function gib(n: number | null | undefined): string {
  const v = num(n)
  if (v === null || v < 0) return DASH
  if (v >= 1024) return `${(v / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} TiB`
  return `${Math.round(v).toLocaleString('en-US')} GiB`
}
