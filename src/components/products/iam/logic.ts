/**
 * Pure IAM admin helpers — new-record templates + display mappings. No I/O, no
 * React, so the views stay declarative and the labels stay in one place.
 */
import type { IamUser, IamApplication } from '~/lib/api'

/** A blank org-scoped user (password is collected separately in the create form). */
export function newUser(owner: string): IamUser {
  return { owner, name: '', displayName: '', email: '', type: 'normal-user', isAdmin: false }
}

/** A blank application — casdoor apps are owned by the built-in `admin`, scoped to the org. */
export function newApplication(owner: string): IamApplication {
  return { owner: 'admin', name: '', displayName: '', organization: owner, description: '' }
}

/** Human-readable 2FA channel — "TOTP" / "SMS" / "Email" / "none". */
export function mfaLabel(u: Pick<IamUser, 'preferredMfaType' | 'mfaPhoneEnabled' | 'mfaEmailEnabled'>): string {
  const t = (u.preferredMfaType || '').toLowerCase()
  if (t === 'app' || t === 'totp') return 'TOTP'
  if (t === 'sms') return 'SMS'
  if (t === 'email') return 'Email'
  if (u.mfaPhoneEnabled) return 'SMS'
  if (u.mfaEmailEnabled) return 'Email'
  return 'none'
}

/** Role label for the Users/Memberships table. */
export const roleLabel = (u: Pick<IamUser, 'isAdmin' | 'type'>): string =>
  u.isAdmin ? 'admin' : u.type || 'member'
