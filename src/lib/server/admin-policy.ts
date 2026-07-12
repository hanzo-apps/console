/**
 * Admin-console authorization policy — PURE predicates, no Next/transport.
 *
 * Decomplected from the gated proxies (`getAdminGate` + the IAM/KMS route
 * handlers) so the policy is one testable thing and each handler stays in its
 * lane. Two concerns:
 *   - the GATE: may this caller reach this brand's admin console at all?
 *     (`gateAllows` = verified `@<adminDomain>` email AND an IAM admin flag).
 *   - tenant SCOPING: which org may an authorized caller act on? A SuperAdmin
 *     → any org; a brand admin is pinned to their own (`ownerAllowed`/`orgFor`),
 *     which is what closes the cross-tenant read gap and stops a brand
 *     admin from targeting another org's KMS.
 */

/** The identity claims a gate decision is made from. */
export type AdminPrincipal = { email: string; emailVerified: boolean; isAdmin: boolean; isSuperAdmin: boolean }

/** The SuperAdmin metadata org ('admin') — acceptable only on org-list endpoints. */
const ORG_METADATA_OWNERS = new Set(['admin'])

/** Email is on the brand's admin domain (case-insensitive). */
export function emailOnBrand(email: string, adminDomain: string): boolean {
  return !!email && email.toLowerCase().endsWith('@' + adminDomain.toLowerCase())
}

/** IAM marks the caller an admin (org-level or SuperAdmin). */
export function isAdminGranted(p: { isAdmin: boolean; isSuperAdmin: boolean }): boolean {
  return p.isAdmin || p.isSuperAdmin
}

/**
 * The admin gate for admin.hanzo.ai — CROSS-TENANT ops (IAM/KMS/orgs across every
 * tenant). It must be SuperAdmins only (members of the `admin` org). An
 * org-level admin — a tenant org owner like Dave/maxpower with org-scoped
 * `isAdmin` — is NOT enough, even with a verified @<adminDomain> email. So gate on
 * `isSuperAdmin`, NEVER `isAdminGranted` (which also accepts org-level isAdmin and
 * was the leak). The verified brand-email requirement stays as a second factor
 * (defense in depth). Fail-closed on any miss.
 */
export function gateAllows(p: AdminPrincipal, adminDomain: string): boolean {
  return emailOnBrand(p.email, adminDomain) && p.emailVerified && p.isSuperAdmin
}

/**
 * A non-SuperAdmin may reference ONLY their own org. IAM read endpoints
 * do not enforce this, so the proxy must: SuperAdmin → any org; brand admin →
 * `orgScope`; the `admin` metadata owner is allowed only where the
 * endpoint itself scopes to the caller (the org list/get — `orgMetadataOk`).
 */
export function ownerAllowed(
  owner: string | null,
  opts: { isSuperAdmin: boolean; orgScope: string; orgMetadataOk?: boolean },
): boolean {
  if (!owner) return true
  if (opts.isSuperAdmin) return true
  if (opts.orgMetadataOk && ORG_METADATA_OWNERS.has(owner)) return true
  return owner === opts.orgScope
}

/** Org an operator acts on — the requested org only for a SuperAdmin, else scope. */
export function orgFor(opts: { isSuperAdmin: boolean; orgScope: string }, requested: string | null): string {
  return opts.isSuperAdmin && requested ? requested : opts.orgScope
}

// ── Org member proxy (/org/iam) — self-service, own-org only ──────────────────
// The org proxy admits any authenticated member (reads) but must (a) require an
// ORG ADMIN for writes and (b) pin every reference to the caller's own org. These
// pure predicates are the decision; the route handler wires transport around them.

/**
 * May this caller WRITE to org members (invite / change-role / remove)? A
 * SuperAdmin may (owner checks then scope the target org); a non-SuperAdmin must be an
 * admin of their own org. A plain member → read-only (false).
 */
export function orgWriteAllowed(p: { isSuperAdmin: boolean; isAdmin: boolean }): boolean {
  return p.isSuperAdmin || p.isAdmin
}

/**
 * May this caller reference an org by NAME (get-organization `id=admin/<name>`)?
 * Organization objects are owned by the `admin` metadata org, so the owner check
 * alone (`ownerAllowed` with `orgMetadataOk`) would let a brand admin read ANOTHER
 * org's settings — this closes that by requiring the requested name to equal the
 * caller's scope, unless they are a SuperAdmin.
 */
export function orgNameAllowed(
  requested: string | null,
  p: { isSuperAdmin: boolean; orgScope: string },
): boolean {
  if (!requested) return true
  if (p.isSuperAdmin) return true
  return requested === p.orgScope
}
