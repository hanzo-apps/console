/**
 * Vendor-cost (COGS) API — what WE pay our vendors, beside revenue, to show MARGIN
 * on the admin business board.
 *
 * SOURCE: commerce `GET /v1/costs` + `GET /v1/costs/margin`, reached through the
 * console's OWN same-origin `/costs/*` server proxy (`app/costs/[...path]/route.ts`),
 * which runs `getAdminGate` (global-admin only, fail-closed 403) BEFORE forwarding
 * with the commerce SERVICE token — so a tenant customer can never read platform
 * vendor spend, and the browser holds no credential.
 *
 * The client calls the CLEAN same-origin `/v1/costs/margin` (CTO "no prefix before
 * /v1" law); `next.config.mjs` rewrites `/v1/costs*` → the `/costs` proxy. Commerce
 * returns a PLAIN JSON body (not the casibase `{status,msg,data}` envelope), so we
 * read it with `restGet` (the plain-REST helper the `/billing` client uses), NOT
 * `originGet` (which would reject a non-`ok` envelope). Coded OPTIONAL-SAFE:
 * `normalizeMargin` maps whatever commerce
 * returns onto `Margin`, every missing field degrades to 0 / `[]` / `estimated`, and
 * a deployment where `/costs` isn't routed (or `COMMERCE_TOKEN` is unset → 501)
 * throws so the board renders honest-empty — never a fabricated cost. Money is USD
 * cents end to end.
 */
import { originV1Url, restGet } from './client'

/** Provenance of a vendor cost figure (mirrors commerce `costs.Source`). */
export type CostSource = 'actual' | 'estimated'

/** One vendor line — what we paid a vendor for a service in the period. */
export type VendorCost = {
  vendor: string
  service: string
  /** What WE pay, USD cents (>= 0). */
  amountCents: number
  source: CostSource
  /** Honest context (e.g. "no DO_API_TOKEN configured"), when commerce supplies it. */
  note?: string
}

/** Revenue − COGS for a period, with the per-vendor breakdown (commerce `/v1/costs/margin`). */
export type Margin = {
  period: string
  /** Revenue from the usage ledger, USD cents. */
  revenueCents: number
  /** Total vendor COGS, USD cents. */
  cogsCents: number
  /** revenueCents − cogsCents. */
  marginCents: number
  /** 100 × margin / revenue (0 when no revenue). */
  grossMarginPct: number
  vendors: VendorCost[]
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Normalize one vendor line; unknown source degrades to 'estimated' (never faked as actual). */
function normalizeVendor(raw: unknown): VendorCost {
  const r = (raw ?? {}) as Record<string, unknown>
  const v: VendorCost = {
    vendor: str(r.vendor),
    service: str(r.service),
    amountCents: Math.max(0, Math.round(num(r.amountCents))),
    source: r.source === 'actual' ? 'actual' : 'estimated',
  }
  const note = str(r.note)
  if (note) v.note = note
  return v
}

/** Map a `/v1/costs/margin` payload onto `Margin` (optional-safe). */
export function normalizeMargin(raw: unknown): Margin {
  const r = (raw ?? {}) as Record<string, unknown>
  const vendors = arr(r.vendors).map(normalizeVendor)
  const revenueCents = Math.round(num(r.revenueCents))
  // Derive cogs/margin from the vendor lines when the top-level fields are absent,
  // so the tiles stay self-consistent even against a partial payload.
  const cogsCents = r.cogsCents !== undefined ? Math.round(num(r.cogsCents)) : vendors.reduce((s, v) => s + v.amountCents, 0)
  const marginCents = r.marginCents !== undefined ? Math.round(num(r.marginCents)) : revenueCents - cogsCents
  const grossMarginPct =
    r.grossMarginPct !== undefined ? num(r.grossMarginPct) : revenueCents > 0 ? Math.round((marginCents / revenueCents) * 10000) / 100 : 0
  return { period: str(r.period), revenueCents, cogsCents, marginCents, grossMarginPct, vendors }
}

export const CostsApi = {
  /**
   * Revenue − COGS for a period (defaults to the current month when omitted). Throws
   * a typed error when `/costs` isn't routed (404) or `COMMERCE_TOKEN` is unset (501)
   * so the caller renders an honest state. `/v1/costs/margin` also carries the full
   * per-vendor breakdown, so ONE call feeds both the margin tiles and the vendor donut.
   */
  margin: async (period?: string): Promise<Margin> => {
    const q = period ? `?period=${encodeURIComponent(period)}` : ''
    return restGet<unknown>(`${originV1Url('costs/margin')}${q}`).then(normalizeMargin)
  },
}
