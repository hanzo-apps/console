/**
 * Admin-console authorization policy — PURE predicates, no Next/transport.
 *
 * Decomplected from the gated proxies (`getAdminGate` + the IAM/KMS route
 * handlers) so the policy is one testable thing and each handler stays in its
 * lane. Two concerns:
 *   - the GATE: may this caller reach this brand's admin console at all?
 *     (`gateAllows` = verified `@<adminDomain>` email AND an IAM admin flag).
 *   - tenant SCOPING: which org may an authorized caller act on? A global admin
 *     → any org; a brand admin is pinned to their own (`ownerAllowed`/`orgFor`),
 *     which is what closes the cross-tenant read gap and stops a brand
 *     admin from targeting another org's KMS.
 */

/** The identity claims a gate decision is made from. */
export type AdminPrincipal = { email: string; emailVerified: boolean; isAdmin: boolean; isGlobalAdmin: boolean }

/** The global-admin metadata org ('admin') — acceptable only on org-list endpoints. */
const ORG_METADATA_OWNERS = new Set(['admin'])

/** Email is on the brand's admin domain (case-insensitive). */
export function emailOnBrand(email: string, adminDomain: string): boolean {
  return !!email && email.toLowerCase().endsWith('@' + adminDomain.toLowerCase())
}

/** IAM marks the caller an admin (org-level or global). */
export function isAdminGranted(p: { isAdmin: boolean; isGlobalAdmin: boolean }): boolean {
  return p.isAdmin || p.isGlobalAdmin
}

/**
 * The admin gate for admin.hanzo.ai — CROSS-TENANT ops (IAM/KMS/orgs across every
 * tenant). It must be GLOBAL admins only (members of the `admin` org). An
 * org-level admin — a tenant org owner like Dave/maxpower with org-scoped
 * `isAdmin` — is NOT enough, even with a verified @<adminDomain> email. So gate on
 * `isGlobalAdmin`, NEVER `isAdminGranted` (which also accepts org-level isAdmin and
 * was the leak). The verified brand-email requirement stays as a second factor
 * (defense in depth). Fail-closed on any miss.
 */
export function gateAllows(p: AdminPrincipal, adminDomain: string): boolean {
  return emailOnBrand(p.email, adminDomain) && p.emailVerified && p.isGlobalAdmin
}

/**
 * A non-global admin may reference ONLY their own org. IAM read endpoints
 * do not enforce this, so the proxy must: global admin → any org; brand admin →
 * `orgScope`; the `admin` metadata owner is allowed only where the
 * endpoint itself scopes to the caller (the org list/get — `orgMetadataOk`).
 */
export function ownerAllowed(
  owner: string | null,
  opts: { isGlobalAdmin: boolean; orgScope: string; orgMetadataOk?: boolean },
): boolean {
  if (!owner) return true
  if (opts.isGlobalAdmin) return true
  if (opts.orgMetadataOk && ORG_METADATA_OWNERS.has(owner)) return true
  return owner === opts.orgScope
}

/** Org an operator acts on — the requested org only for a global admin, else scope. */
export function orgFor(opts: { isGlobalAdmin: boolean; orgScope: string }, requested: string | null): string {
  return opts.isGlobalAdmin && requested ? requested : opts.orgScope
}
