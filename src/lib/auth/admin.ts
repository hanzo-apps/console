'use client'

/**
 * Client-side admin signal — the ONE place the browser decides whether the
 * signed-in user is a GLOBAL (platform / Hanzo-managed) admin.
 *
 * This mirrors the authoritative server gate (`lib/server/admin-policy.gateAllows`,
 * which requires `isGlobalAdmin`) and the `OrgGate` host redirect: membership in
 * the reserved `admin` org IS global admin (its whole purpose is the seeded
 * superuser), or an explicit `isGlobalAdmin` claim. A tenant org owner — a
 * customer like `maxpower`, even one who is `isAdmin` of their OWN org — is NEVER
 * a global admin.
 *
 * The nav/launcher/palette use this to HIDE admin-only surfaces (cross-tenant IAM
 * / KMS / provider + routing config) from customers, and the catch-all uses it to
 * render a graceful "managed by Hanzo" notice instead of a hostile 403 red error
 * if a customer reaches an admin URL directly. Access is ALWAYS enforced
 * server-side too — this is the matching UI gate, never the only one.
 */
import { useSession } from './session'
import type { Account } from '~/lib/api'

/** True when the account is a global (cross-tenant) admin — pure, testable. */
export function isGlobalAdminAccount(account: Account | null | undefined): boolean {
  if (!account) return false
  return Boolean((account as { isGlobalAdmin?: boolean }).isGlobalAdmin) || account.owner === 'admin'
}

/** Whether the signed-in user is a global (platform) admin. */
export function useIsGlobalAdmin(): boolean {
  const { account } = useSession()
  return isGlobalAdminAccount(account)
}
