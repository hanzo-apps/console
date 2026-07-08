'use client'

/**
 * Client wire for email self-serve signup. POSTs to the same-origin `/auth/signup`
 * BFF (which mints the account + org as the confidential console client); the
 * browser only sends its request. On success the caller signs in with the same
 * credentials via the normal `loginWithPassword` flow.
 *
 * `turnstileToken` (when Turnstile is provisioned) and `ref` (a `?ref=` referral
 * captured on the landing URL, which credits the referrer's waitlist position) ride
 * along in the body; both are optional and omitted when absent.
 */

export type SignupResult = { kind: 'ok' } | { kind: 'exists' } | { kind: 'error'; message: string }

export type SignupOpts = { turnstileToken?: string; ref?: string }

export async function signUp(email: string, password: string, opts: SignupOpts = {}): Promise<SignupResult> {
  let res: Response
  try {
    res = await fetch('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        email,
        password,
        turnstileToken: opts.turnstileToken || undefined,
        ref: opts.ref || undefined,
      }),
    })
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'Network error.' }
  }
  if (res.ok) return { kind: 'ok' }
  if (res.status === 409) return { kind: 'exists' }
  if (res.status === 429) {
    return { kind: 'error', message: 'Too many sign-up attempts. Please try again later.' }
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return { kind: 'error', message: body?.error || `Sign-up failed (HTTP ${res.status}).` }
}
