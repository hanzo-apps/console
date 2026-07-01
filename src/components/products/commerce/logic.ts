/**
 * Pure, unit-tested helpers for the Commerce store dashboard. No React, no I/O —
 * every value is DERIVED from the real rows the `/commerce` proxy returns, so a metric
 * no row carries reads "—" (never a fabricated number).
 */
import type { CommerceProduct, CommerceOrder, CommerceCustomer } from '~/lib/api/commerce'

/** The store's headline numbers, all derived from real rows. */
export type StoreStats = {
  products: number
  activeProducts: number
  orders: number
  customers: number
  /** Gross revenue in cents summed over the orders that carry a total (else 0). */
  revenueCents: number
}

/** Roll up the store overview from the three real lists. */
export function deriveStoreStats(
  products: CommerceProduct[],
  orders: CommerceOrder[],
  customers: CommerceCustomer[],
): StoreStats {
  return {
    products: products.length,
    activeProducts: products.filter((p) => p.available && !p.hidden).length,
    orders: orders.length,
    customers: customers.length,
    revenueCents: orders.reduce((sum, o) => sum + (o.totalCents ?? 0), 0),
  }
}

/** Title-case a lower/kebab/snake status token (`fulfilled`, `payment_pending`) for display. */
export function humanizeStatus(status?: string): string {
  if (!status) return '—'
  return status
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Map a store/order status to a StatusTag tone. Unknown → neutral (never a fake OK). */
export function statusTone(status?: string): 'green' | 'yellow' | 'red' | 'gray' {
  const s = (status ?? '').toLowerCase()
  if (/(paid|complete|fulfilled|active|delivered|captured|succeeded)/.test(s)) return 'green'
  if (/(pending|processing|open|draft|await|partial)/.test(s)) return 'yellow'
  if (/(fail|cancel|refund|declin|error|void)/.test(s)) return 'red'
  return 'gray'
}

/** Render a discount value by its type: percent (`15%`) vs fixed amount (cents → `$X`). */
export function discountValue(type: string | undefined, value: number | undefined): string {
  if (value === undefined) return '—'
  const t = (type ?? '').toLowerCase()
  if (/(percent|pct|%)/.test(t)) return `${value}%`
  if (/(fixed|amount|flat)/.test(t)) return `$${(value / 100).toFixed(2)}`
  // No explicit type: a small integer reads as a percent, a large one as cents.
  return value <= 100 ? `${value}%` : `$${(value / 100).toFixed(2)}`
}
