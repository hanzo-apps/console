/**
 * Cloudflare Turnstile server-side verification — the bot wall on `/auth/signup`.
 *
 * The public open-signup path is the console's one unauthenticated account-minting
 * surface (account + org + $5 welcome grant), so a bot guard is the primary
 * cost/abuse defense. Turnstile is already the codebase's captcha of record (the
 * waitlist Base plugin uses it); this mirrors that verifier exactly — a single POST
 * to Cloudflare's siteverify, NO new dependency, NO client SDK.
 *
 * CONFIG-GATED, fail-safe: when `TURNSTILE_SECRET_KEY` is unset (dev / a deployment
 * that has not provisioned Turnstile) verification is a no-op and returns ok, so the
 * feature is simply inert rather than blocking every signup. When the secret IS set,
 * a missing/invalid token is refused. The public site key travels to the browser as
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (the widget); the secret stays server-only (KMS).
 */
import { fetchWithTimeout } from './fetch-timeout'

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const SECRET = (process.env.TURNSTILE_SECRET_KEY ?? '').trim()

/** True when Turnstile is provisioned (secret present) and therefore enforced. */
export const turnstileEnabled = (): boolean => SECRET !== ''

export type TurnstileResult = { ok: true } | { ok: false; reason: string }

/**
 * Verify a Turnstile token for a client IP. No-op success when the secret is unset.
 * A missing token (with the secret set) is refused without a network round-trip.
 * Any transport/parse failure is reported as a refusal (fail-CLOSED for the bot wall
 * once Turnstile is enabled — the whole point is to stop unverified traffic).
 */
export async function verifyTurnstile(token: string, remoteIp: string): Promise<TurnstileResult> {
  if (!SECRET) return { ok: true }
  if (!token) return { ok: false, reason: 'missing-token' }
  try {
    const res = await fetchWithTimeout(SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ secret: SECRET, response: token, remoteip: remoteIp || undefined }),
      cache: 'no-store',
    })
    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; ['error-codes']?: string[] }
      | null
    if (json?.success) return { ok: true }
    return { ok: false, reason: json?.['error-codes']?.join(',') || 'verification-failed' }
  } catch {
    return { ok: false, reason: 'verify-unavailable' }
  }
}
