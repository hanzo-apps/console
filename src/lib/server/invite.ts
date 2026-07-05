/**
 * Team-invite acceptance token — a sealed, TTL-bound capability that lets a
 * NOT-yet-authenticated invitee set their initial password and join the org.
 *
 * Why this exists: an org admin invites a teammate (a real IAM member row is
 * created in their org with the chosen role, but NO password — the member can't
 * sign in yet), and email/OTP delivery (`hanzoai/notify`) is not wired on this
 * deployment (IAM `send-invitation` is a documented stub). So the ONE honest,
 * no-email delivery is a shareable ACCEPT LINK the admin hands to the teammate.
 *
 * The token is sealed with the SAME AES-256-GCM key the console session uses
 * (`seal`/`open`, HKDF of the confidential client secret) — unforgeable, tamper-
 * evident, and needing no new KMS entry. It authorizes setting the password of
 * exactly ONE user (`org/name`); the accept route additionally refuses once that
 * user already has a password, so the link is effectively single-use for
 * activation and can never reset an active member's credential.
 */
import { seal, open } from './session'

/** Invite links are valid for 14 days — long enough to hand off out-of-band,
 *  short enough that a leaked link expires on its own. */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000

/** The sealed payload. Short keys keep the token compact; `k` tags the kind so a
 *  session blob can never be mistaken for an invite (and vice-versa). */
type InvitePayload = { k: 'inv'; o: string; n: string; m: string; e: number }

/** The identity an invite authorizes: the member (`org/name`) + their email. */
export type Invite = { org: string; name: string; email: string }

/** Seal an invite into a shareable token (base64url). `now` is injectable for tests. */
export function signInvite(inv: Invite, now: number = Date.now()): string {
  const payload: InvitePayload = { k: 'inv', o: inv.org, n: inv.name, m: inv.email, e: now + INVITE_TTL_MS }
  return seal(payload)
}

/** Open + validate an invite token; null on tamper, wrong kind, missing fields, or
 *  expiry (fail-closed). `now` is injectable for tests. */
export function readInvite(token: string | undefined | null, now: number = Date.now()): Invite | null {
  const p = open<InvitePayload>(token)
  if (!p || p.k !== 'inv') return null
  if (typeof p.o !== 'string' || typeof p.n !== 'string' || typeof p.m !== 'string') return null
  if (typeof p.e !== 'number' || p.e <= now) return null
  if (!p.o || !p.n) return null
  return { org: p.o, name: p.n, email: p.m }
}

/** The `<owner>/<name>` IAM id a token targets. */
export function inviteUserId(inv: Invite): string {
  return `${inv.org}/${inv.name}`
}

/** Build the shareable accept link for an origin + token. */
export function acceptLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/accept?t=${encodeURIComponent(token)}`
}
