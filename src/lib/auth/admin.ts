'use client'

/**
 * Client-side super-admin signal — the ONE place the browser decides whether the
 * signed-in user is a SUPER admin (platform / Hanzo-managed, cross-tenant).
 *
 * This mirrors the authoritative server gate (`lib/server/admin-policy.gateAllows`)
 * and the `OrgGate` host redirect: membership in the reserved `admin` org IS super
 * admin (its whole purpose is the seeded superuser), or an explicit super-admin
 * claim on the account. A tenant org owner — a customer like `maxpower`, even one
 * who is `isAdmin` of their OWN org — is NEVER a super admin.
 *
 * The account signal is read from the canonical `isSuperAdmin` field, which the
 * console projects from the session server-side (`accountOf`) — the browser never
 * sees the legacy IAM wire claim (the server owns that back-compat, in
 * `lib/server/identity`). Membership in the `admin` org (`owner === 'admin'`) is the
 * owner-canonical signal and needs no claim at all.
 *
 * The nav/launcher/palette use this to HIDE admin-only surfaces (cross-tenant IAM /
 * KMS / provider + routing config) from customers, and the catch-all uses it to
 * render a graceful "managed by Hanzo" notice instead of a hostile 403 red error
 * if a customer reaches an admin URL directly. Access is ALWAYS enforced
 * server-side too — this is the matching UI gate, never the only one.
 */
import { useSession } from './session'
import type { Account } from '~/lib/api'

/** True when the account is a super (cross-tenant) admin — pure, testable. */
export function isSuperAdminAccount(account: Account | null | undefined): boolean {
  if (!account) return false
  // Read the canonical `isSuperAdmin` field the console projects (server `accountOf`),
  // OR the owner-canonical `admin`-org membership. No legacy claim on the client.
  const a = account as { isSuperAdmin?: boolean }
  return Boolean(a.isSuperAdmin) || account.owner === 'admin'
}

/** Whether the signed-in user is a super (platform) admin. */
export function useIsSuperAdmin(): boolean {
  const { account } = useSession()
  return isSuperAdminAccount(account)
}
