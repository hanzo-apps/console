/**
 * Pure logic for the Plans admin editor — no React/gui imports, node-testable. The
 * generic pricing primitives (money dollars↔cents, the metadata key/value round-trip)
 * are REUSED from `catalog/logic` (one implementation, DRY); this module holds only the
 * plan-specific bits: the known plan categories and the money DISPLAY that honors the
 * free($0) vs custom(null, `contactSales`) distinction commerce preserves.
 */
import { formatUsd } from '~/components/products/catalog/logic'

/** The plan families commerce's plan authority uses (`GET /v1/billing/plans?category=`
 *  filters on this). Offered in the form select; the live filter chips are derived from
 *  the actual data, so a plan in a new category still lists. */
export const PLAN_CATEGORIES = ['personal', 'team', 'enterprise', 'world', 'social', 'dns'] as const

/**
 * The monthly-price headline for a plan. A `contactSales` plan is CUSTOM (price is
 * null, not $0) → "Contact sales"; a real $0 is "Free"; otherwise the monthly dollars.
 * Mirrors commerce's free-vs-custom rule (`price==0 && contactSales` ⇒ custom).
 */
export function priceDisplay(priceCents: number, contactSales: boolean): string {
  if (contactSales) return 'Contact sales'
  if (!priceCents) return 'Free'
  return `${formatUsd(priceCents)}/mo`
}

/** The annual per-month price sub-label ("$8.00/mo billed annually"), or '' when there
 *  is no distinct annual price. */
export function annualDisplay(priceAnnualCents: number): string {
  if (!priceAnnualCents) return ''
  return `${formatUsd(priceAnnualCents)}/mo billed annually`
}
