/**
 * Plan promo — the ONE place the limited-time discount is interpreted. The plan
 * catalog (/v1/plan) carries `promoPercent` (off the list price) through
 * `promoUntil` (RFC3339); every surface derives the effective price from here so
 * there is no second discount source of truth.
 */

export type PlanPromo = {
  priceMonthly?: number
  priceAnnual?: number
  promoPercent?: number
  promoUntil?: string
}

/** True when a plan has a live promo (a positive percent, not past its window). */
export function promoActive(p: PlanPromo, now: Date = new Date()): boolean {
  if (!p.promoPercent || p.promoPercent <= 0) return false
  if (!p.promoUntil) return false
  const until = Date.parse(p.promoUntil)
  return Number.isFinite(until) && until > now.getTime()
}

/** The effective monthly price after the promo (whole dollars, rounded), or the
 *  list price when no promo is active. */
export function effectiveMonthly(p: PlanPromo, now?: Date): number | undefined {
  if (p.priceMonthly == null) return p.priceMonthly
  if (!promoActive(p, now)) return p.priceMonthly
  return Math.round(p.priceMonthly * (1 - (p.promoPercent as number) / 100))
}

/** A short badge label, e.g. "50% off · limited time" (empty when no promo). */
export function promoLabel(p: PlanPromo, now?: Date): string {
  return promoActive(p, now) ? `${p.promoPercent}% off · limited time` : ''
}
