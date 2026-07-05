/**
 * Pure, unit-tested helpers for the Referrals product — money/label/tone
 * formatting so the view stays declarative and the logic is node-testable
 * (registry/React never imported here).
 */
import type { MyReferral, ReferralStatus } from '~/lib/api/referrals'

/** USD cents → "$10.00" (em-dash for a non-finite value — honest, never NaN). */
export function usd(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

/** Human label for a referral status. */
export function statusLabel(status: ReferralStatus): string {
  switch (status) {
    case 'signed_up':
      return 'Signed up'
    case 'qualified':
      return 'Qualified'
    case 'credited':
      return 'Credited'
    default:
      return String(status || 'Signed up')
  }
}

/** Tone color for a status pill (neutral → amber → green). A literal union so it
 *  is assignable to the @hanzo/gui `color` prop (a widened `string` is not). */
export function statusTone(status: ReferralStatus): '#3fb950' | '#d29922' | '#8b949e' {
  switch (status) {
    case 'credited':
      return '#3fb950' // granted — green
    case 'qualified':
      return '#d29922' // qualified, grant pending — amber
    default:
      return '#8b949e' // signed up — neutral
  }
}

/** Unix seconds → a short local date; empty when unset (0). */
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

/**
 * How this referral is progressing, for the row caption. Honest: a signed-up
 * referee just hasn't used the product yet; a qualified one is mid-grant.
 */
export function progressCaption(r: MyReferral): string {
  switch (r.status) {
    case 'credited':
      return `You earned ${usd(r.creditsCents)}`
    case 'qualified':
      return 'Qualified — bonus landing'
    default:
      return 'Signed up — earns when they use Hanzo'
  }
}
