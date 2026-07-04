/**
 * Per-product Billing / Usage / Metrics quick links — the ONE pure decision layer
 * behind the reusable `ProductQuickLinks` band every product overview renders. Pure
 * (no GUI), so the destinations + the honest stat derivation are unit-testable and
 * the band stays presentational.
 *
 * DRY by construction — a product does NOT hand-declare its billing/usage/metrics
 * targets; they are DERIVED from its catalog id:
 *   - Billing → the Cost Reports surface (`/billing/reports`) pre-filtered to THIS
 *     product's meters (its `metadata.product` tag). The raw model-serving surface
 *     (inference/models/api/gateway) has no discrete tag — its spend IS the whole
 *     inference ledger — so it links to the unfiltered Cost Reports (honest, real).
 *   - Usage   → the product's own Metrics sub-page (`/<id>/metrics`), which is the
 *     REAL commerce usage ledger (`GET /v1/billing/usage`) scoped to the product by
 *     `metricsScopeFor` — the SAME source + the SAME product filter the Metrics
 *     dashboard uses (never a second, divergent way to attribute usage).
 *   - Metrics → the same per-product Metrics/observability dashboard.
 *
 * The product → meter mapping lives in exactly ONE place — `metricsScopeFor`
 * (subpage/sources.ts) — so "Usage for Models shows model usage, Usage for GPUs
 * shows GPU usage" is guaranteed to agree with the Metrics sub-page. Reused here
 * (not re-derived) so there is one, and only one, product→tag decision.
 */
import type { CatalogEntry } from '~/lib/products/registry'
import type { CloudUsageOverview } from '~/lib/api/usage'
import { metricsScopeFor } from '~/components/products/subpage/sources'

export type QuickLinkKind = 'billing' | 'usage' | 'metrics'

/** The resolved in-console destinations for a product's three quick links. */
export type QuickLinkTargets = Record<QuickLinkKind, string>

/**
 * Products with no per-product billing/usage/metrics quick links: the money
 * surfaces themselves (linking Billing→Billing is circular), pure account/org
 * administration (no metered usage of their own), and the aggregate god-view
 * dashboards (they ARE the rollup, not a single product). Admin-gated entries,
 * `soon` products, and non-module (`external`) entries are excluded separately in
 * `showsQuickLinks`, so this set only names the enabled, customer-visible products
 * that still shouldn't carry the band.
 */
export const QUICK_LINKS_EXCLUDE = new Set<string>([
  // The billing / plan money surfaces themselves.
  'billing',
  'plans',
  'cost',
  // Pure account / org administration — no metered usage of their own.
  'settings',
  'profile',
  'team',
  'api-keys',
  'wallet',
  'referrals',
  // Aggregate dashboards (not a single product's meter).
  'overview',
  'ai-metrics',
  'overlord',
])

/**
 * Whether a product's Overview should render the Billing/Usage/Metrics quick-links
 * band. Only enabled, customer-visible, in-console product modules qualify — an
 * `external` launch, a `soon` placeholder, an admin god-view, or a money/account
 * surface does not.
 */
export function showsQuickLinks(entry: CatalogEntry): boolean {
  if (entry.kind !== 'module') return false
  if (entry.status !== 'enabled') return false
  if (entry.admin) return false
  return !QUICK_LINKS_EXCLUDE.has(entry.id)
}

/**
 * The product's usage/billing meter filter — its `metadata.product` tag, or `null`
 * for the raw model-serving surface (whose spend is the whole inference ledger).
 * A thin, DRY accessor over the ONE scope decision (`metricsScopeFor`).
 */
export function usageProductFilter(id: string): string | null {
  return metricsScopeFor(id).product
}

/**
 * The three real, working destinations for a product's quick links, derived from
 * its id. Billing goes to the Cost Reports surface pre-filtered to the product's
 * meter (unfiltered for the whole-ledger inference surfaces); Usage and Metrics
 * both open the product's own Metrics sub-page — the one real per-product usage +
 * metrics dashboard (`/v1/billing/usage` scoped to the product). Every target is a
 * live in-console route, so none can 404.
 */
export function quickLinkTargetsFor(entry: CatalogEntry): QuickLinkTargets {
  const tag = usageProductFilter(entry.id)
  const billing = tag ? `/billing/reports?product=${encodeURIComponent(tag)}` : '/billing/reports'
  const metrics = `/${entry.id}/metrics`
  return { billing, usage: metrics, metrics }
}

/** The honest, real per-card stats derived from ONE product-scoped usage overview. */
export type QuickLinkStats = {
  /** Total spend charged to this product in the window, in USD cents. */
  spendCents: number
  /** Total requests attributed to this product in the window. */
  requests: number
  /** Total tokens attributed to this product in the window. */
  tokens: number
  /**
   * Fraction of requests recorded as successful (0..1), or `null` when there is no
   * request in the window — an honest em dash, never a fabricated "100%".
   */
  successRate: number | null
}

/** A recorded status counts as "success" when it is 2xx or reads success/ok/complete. */
function isSuccessStatus(status: string): boolean {
  const s = status.trim().toLowerCase()
  return s.startsWith('2') || s === 'success' || s === 'ok' || s === 'complete' || s === 'completed'
}

/**
 * Derive the three real card figures from a single product-scoped
 * `UsageApi.overview` result. Honest by construction: a product with no attributed
 * usage yields zeros and a `null` success rate (the band still renders and its
 * links still work — never a fabricated number, never an "Access required").
 */
export function statsFromOverview(ov: CloudUsageOverview): QuickLinkStats {
  const totalReq = ov.byStatus.reduce((a, s) => a + s.requests, 0)
  const okReq = ov.byStatus.filter((s) => isSuccessStatus(s.status)).reduce((a, s) => a + s.requests, 0)
  return {
    spendCents: ov.totals.spendCents,
    requests: ov.totals.requests,
    tokens: ov.totals.tokens,
    successRate: totalReq > 0 ? okReq / totalReq : null,
  }
}
