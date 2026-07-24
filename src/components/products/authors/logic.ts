/**
 * Pure, unit-tested helpers for the Authors product — money/share/label/tone
 * formatting so the views stay declarative and the logic is node-testable
 * (registry/React never imported here).
 */
import type { AuthorStatus, RepoVerifyMethod } from '~/lib/api/authors'

/** USD cents → "$10.00" (em-dash for a non-finite value — honest, never NaN). */
export function usd(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

/** Basis points → a human percent ("2000" → "20%", "1550" → "15.5%"). */
export function sharePct(shareBps: number | null | undefined): string {
  if (shareBps == null || !Number.isFinite(shareBps)) return '—'
  const pct = shareBps / 100
  // Trim a trailing ".0" so a whole percent reads clean.
  return `${Number.isInteger(pct) ? String(pct) : pct.toFixed(1)}%`
}

/** Human label for an author status. */
export function statusLabel(status: AuthorStatus): string {
  switch (status) {
    case 'connected':
      return 'Connected'
    case 'approved':
      return 'Approved'
    case 'suspended':
      return 'Suspended'
    default:
      return String(status || 'Connected')
  }
}

/** Tone color for a status pill. A literal union so it is assignable to the
 *  @hanzo/gui `color` prop (a widened `string` is not). */
export function statusTone(status: AuthorStatus): '#3fb950' | '#d29922' | '#f85149' | '#8b949e' {
  switch (status) {
    case 'approved':
      return '#3fb950' // active — green
    case 'connected':
      return '#d29922' // awaiting review — amber
    case 'suspended':
      return '#f85149' // suspended — red
    default:
      return '#8b949e'
  }
}

/** Human label for how a repo was verified. */
export function verifyMethodLabel(method: RepoVerifyMethod): string {
  switch (method) {
    case 'oauth':
      return 'GitHub OAuth'
    case 'file':
      return 'hanzo.json file'
    case '':
      return 'Unverified'
    default:
      return String(method || 'Unverified')
  }
}

/** Unix seconds → a short local date; em-dash when unset (0). */
export function shortDate(unixSeconds: number): string {
  if (!unixSeconds) return '—'
  try {
    return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return '—'
  }
}

/** Human label for a payout method (title-cased; `credits` is the grant method). */
export function payoutMethodLabel(method: string): string {
  const m = (method || '').trim().toLowerCase()
  switch (m) {
    case 'credits':
      return 'Cloud credit'
    case 'paypal':
      return 'PayPal'
    case 'wire':
      return 'Wire'
    case 'ach':
      return 'ACH'
    case 'check':
      return 'Check'
    case '':
      return '—'
    default:
      return m.charAt(0).toUpperCase() + m.slice(1)
  }
}

/**
 * Dollars typed in a form → integer cents, or null when the input is blank/invalid
 * (so the caller can disable the action). Rounds to the nearest cent.
 */
export function dollarsToCents(input: string): number | null {
  const t = (input ?? '').trim().replace(/^\$/, '')
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}
