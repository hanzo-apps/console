'use client'

/**
 * Client-side super-admin signal — the ONE place the browser decides whether the
 * signed-in user is a SUPER admin (platform / Hanzo-managed, cross-tenant).
 *
 * This mirrors the authoritative server gate (`lib/server/admin-policy.gateAllows`)
 * and the `Scope` host redirect: membership in the reserved `admin` org IS super
 * admin (its whole purpose is the seeded superuser), or an explicit super-admin
 * claim on the account. A tenant org owner — a customer like `maxpower`, even one
 * who is `isAdmin` of their OWN org — is NEVER a super admin.
 *
 * ONE predicate, one way: SuperAdmin ⟺ the account's org (`owner`) IS the reserved
 * `admin` org — isSuperAdminOwner, the same equality IAM's User.IsSuperAdmin() uses
 * (`user.Owner == conf.AdminOrg`). No claim is read: IAM derives its `isSuperAdmin`
 * claim from this very equality, so reading it too would be two signals for one fact.
 *
 * The nav/launcher/palette use this to HIDE admin-only surfaces (cross-tenant IAM /
 * KMS / provider + routing config) from customers, and the catch-all uses it to
 * render a graceful "managed by Hanzo" notice instead of a hostile 403 red error
 * if a customer reaches an admin URL directly. Access is ALWAYS enforced
 * server-side too — this is the matching UI gate, never the only one.
 */
import { useSession } from './session'
import { isSuperAdminOwner } from '~/config'
import type { Account } from '~/lib/api'

/** True when the account is a SuperAdmin (cross-tenant) — pure, testable. */
export function isSuperAdminAccount(account: Account | null | undefined): boolean {
  if (!account) return false
  return isSuperAdminOwner(account.owner)
}

/** Whether the signed-in user is a super (platform) admin. */
export function useIsSuperAdmin(): boolean {
  const { account } = useSession()
  return isSuperAdminAccount(account)
}
