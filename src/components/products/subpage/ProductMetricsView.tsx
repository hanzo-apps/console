'use client'

/**
 * Per-product Metrics — the shared, rich usage dashboard for EVERY product's Metrics
 * sub-page, rendered by the ONE `LivingOverview` over a product-parameterized config
 * (`productMetricsConfig`). It reads the REAL per-org commerce usage ledger scoped to
 * this product (`UsageApi.overview({ product })`) — 4 KPI cards (requests/tokens/spend/
 * P95, each with a prior-period delta + live sparkline), usage & spend over time, top
 * models by tokens, requests by status, spend by model, and a recent-usage feed.
 *
 * DRY: no bespoke per-product Metrics UI, no second overview system — the same tiles +
 * `ui/Charts` every overview uses. Honest by construction: a product with no attributed
 * usage shows honest zeros / em-dashes / empty breakdowns, never fabricated numbers, and
 * a ledger that isn't routed surfaces the shared error state.
 */
import type { CatalogEntry } from '~/lib/products/registry'
import { LivingOverview } from '../overview/living/LivingOverview'
import { productMetricsConfig } from '../overview/living/product-metrics'

export function ProductMetricsView({ entry }: { entry: CatalogEntry }) {
  return <LivingOverview config={productMetricsConfig(entry)} />
}
