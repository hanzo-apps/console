/**
 * Admin-only product ids — the single, GUI-free source of truth for which
 * console surfaces require an admin session.
 *
 * The catalog (`registry.tsx`) marks the same entries `admin: true` for the
 * nav/home hiding, but the registry pulls in the whole GUI module graph, so it
 * can't be imported by lean server code or a route guard. This list is the lean
 * mirror; `test/unit/admin-authz.test.ts` asserts the two never drift.
 */
export const ADMIN_PRODUCT_IDS: ReadonlySet<string> = new Set([
  'iam',
  'kms',
  'secrets',
  'audit',
  'clusters',
  'kubernetes',
])

/** True when a product id is an admin-only surface. */
export const isAdminProductId = (id: string): boolean => ADMIN_PRODUCT_IDS.has(id)
