/**
 * Disposable-email hygiene — a public-signup abuse guard.
 *
 * Open signup mints an account + org + a $5 welcome grant, so throwaway-domain
 * addresses are the cheapest credit-farming vector. This is a PURE, dependency-free
 * blocklist of the most common disposable providers (mirrors the waitlist Base
 * plugin's guard). Deliberately small + high-precision — it blocks the obvious farms,
 * not every possible domain (Turnstile + the per-IP rate limit are the general
 * guards). Extend at the boundary via `SIGNUP_BLOCKED_EMAIL_DOMAINS` if ever needed.
 */

const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com',
  '10minutemail.com', '10minutemail.net', 'temp-mail.org', 'tempmail.com',
  'tempmailo.com', 'throwawaymail.com', 'yopmail.com', 'yopmail.net',
  'getnada.com', 'nada.email', 'dispostable.com', 'trashmail.com',
  'maildrop.cc', 'mailnesia.com', 'fakeinbox.com', 'mohmal.com',
  'emailondeck.com', 'tempinbox.com', 'discard.email', 'mailcatch.com',
  'spamgourmet.com', 'mytemp.email', 'temp-mail.io', 'moakt.com',
])

/** The domain part of a normalized email (already trimmed + lowercased upstream). */
function domainOf(email: string): string {
  const at = email.lastIndexOf('@')
  return at >= 0 ? email.slice(at + 1) : ''
}

/**
 * True when `email` is on a known disposable/throwaway domain. The boundary (the
 * signup route) rejects these with a 400.
 */
export function isDisposableEmail(email: string): boolean {
  const d = domainOf(email)
  if (!d) return false
  return DISPOSABLE_DOMAINS.has(d)
}
