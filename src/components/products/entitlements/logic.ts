/**
 * Entitlements admin — pure decisions for the super-admin per-org editor (which
 * products an org has enabled, toggling one on/off). No React, no I/O — the module
 * is a thin render of this + `EntitlementsApi`.
 */
import { isAlwaysOn, type EntitlementPatch } from '~/lib/entitlements'

/** One row in the editor — a product and whether the org currently has it. */
export type EntitlementRow<E extends { id: string }> = {
  entry: E
  /** True when the org can see this product (always-on, or in `enabled`). */
  enabled: boolean
  /** Always-on essentials can't be turned off (implicit for every org). */
  locked: boolean
}

/**
 * Build the editor rows for a set of catalog entries against the org's `enabled`
 * ids. Always-on essentials are `enabled` + `locked` (shown as included, no toggle).
 */
export function entitlementRows<E extends { id: string }>(
  entries: readonly E[],
  enabled: readonly string[],
): EntitlementRow<E>[] {
  const set = new Set(enabled)
  return entries.map((entry) => {
    const locked = isAlwaysOn(entry.id)
    return { entry, enabled: locked || set.has(entry.id), locked }
  })
}

/**
 * The patch to flip a product's enabled state. An always-on id is a no-op (it can
 * never be disabled). Otherwise: currently-on → remove; currently-off → add.
 */
export function togglePatch(id: string, currentlyEnabled: boolean): EntitlementPatch {
  if (isAlwaysOn(id)) return {}
  return currentlyEnabled ? { remove: [id] } : { add: [id] }
}

/** How many products the org has enabled beyond the always-on essentials. */
export function enabledCount(enabled: readonly string[]): number {
  return enabled.filter((id) => !isAlwaysOn(id)).length
}
