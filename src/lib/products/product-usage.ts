/**
 * In-use product ids — the pure derivation behind the "In use" badge + filter in
 * the All-products directory (`AddProductPanel`).
 *
 * A product is IN USE when the org's charged usage ledger attributes at least one
 * row to it (`UsageRecord.product`, from the commerce `metadata.product` tag).
 * Org-scoped by construction: the records come from the per-tenant
 * `/v1/billing/usage` proxy, so this Set is exactly the caller's OWN org's real
 * usage — never fabricated, never cross-tenant.
 *
 * Kept dependency-free (a `type`-only import, erased at runtime — no React, no
 * registry, no api client) so the derivation is unit-testable in isolation;
 * `AddProductPanel` fetches the records and calls this.
 */
import type { UsageRecord } from '~/lib/api/aimetrics'

/**
 * The set of product ids that have REAL usage in `records`. A row with an empty
 * `product` tag (a bare inference call the ledger didn't attribute to a surface) is
 * DROPPED — honest over guessy: it contributes to no product's "in use" badge. The
 * ids are the raw ledger `metadata.product` values, which are catalog entry ids
 * (`agents`/`chat`/`search`/…); a tag matching no catalog entry is harmless (nothing
 * renders it). An org with no usage yet yields an empty Set (honest-empty).
 */
export function inUseProductIds(records: readonly Pick<UsageRecord, 'product'>[]): Set<string> {
  const ids = new Set<string>()
  for (const r of records) {
    const id = r.product.trim()
    if (id) ids.add(id)
  }
  return ids
}
