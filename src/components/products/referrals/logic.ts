/**
 * Pure, unit-tested helpers for the Referrals product — money/label/tone
 * formatting so the view stays declarative and the logic is node-testable
 * (registry/React never imported here).
 */
import type { MyReferral, ReferralStatus } from '~/lib/api/referrals'
import { toneColor, type Tone } from '~/components/ui/tone'

/** USD cents → "$10.00" (em-dash for a non-finite value — honest, never NaN). */
export function usd(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

/** Human label for a referral status. */
export function statusLabel(status: ReferralStatus): string {
  switch (status) {
    case 'signup':
      return 'Signed up'
    case 'qualified':
      return 'Qualified'
    case 'credited':
      return 'Credited'
    default:
      return String(status || 'Signed up')
  }
}

/** The tone a referral status carries (muted → warning → positive). Domain
 *  knowledge lives here; the appearance comes from the one console-wide map in
 *  `~/components/ui/tone`. */
export function statusTone(status: ReferralStatus): Tone {
  switch (status) {
    case 'credited':
      return 'positive' // granted
    case 'qualified':
      return 'warning' // qualified, grant pending
    default:
      return 'muted' // signed up
  }
}

/** Greyscale token for a status pill — `toneColor ∘ statusTone`. */
export function statusColor(status: ReferralStatus) {
  return toneColor(statusTone(status))
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
