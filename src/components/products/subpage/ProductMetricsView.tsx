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
 * `ui/Charts` every overview uses. Honest by construction: a `product`-scoped surface
 * filters the ledger to its own `metadata.product` tag, so a product with no attributed
 * usage shows honest zeros / em-dashes / empty breakdowns (never the org total, never
 * fabricated). The raw model-serving surface (inference/models/api/gateway) IS the
 * org-wide inference ledger — every ledger row is one of its calls — so it reads the
 * whole ledger and says so plainly (an honest banner), rather than masquerading as a
 * narrow per-product slice.
 */
import { Card, Text, XStack } from '@hanzo/gui'
import { Info } from '@hanzogui/lucide-icons-2'

import type { CatalogEntry } from '~/lib/products/registry'
import { LivingOverview } from '../overview/living/LivingOverview'
import { productMetricsConfig } from '../overview/living/product-metrics'
import { metricsScopeFor } from './sources'

/** Honest scope banner — makes the whole-ledger (inference-surface) view unmistakable,
 *  so it is never read as an org-aggregate leak onto an unrelated product. */
function InferenceScopeNote({ label }: { label: string }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" bg="$color2" p="$3" gap="$2" mb="$3">
      <XStack items="center" gap="$2" flexWrap="wrap">
        <Info size={15} color="$color10" />
        <Text fontSize="$3" color="$color11">
          This is your organization&apos;s whole inference ledger — every model call flows through {label}.
          Higher-level products (Agents, Functions, …) show only their own attributed usage.
        </Text>
      </XStack>
    </Card>
  )
}

export function ProductMetricsView({ entry }: { entry: CatalogEntry }) {
  const { scope } = metricsScopeFor(entry.id)
  return (
    <>
      {scope === 'inference-all' ? <InferenceScopeNote label={entry.label} /> : null}
      <LivingOverview config={productMetricsConfig(entry)} />
    </>
  )
}
