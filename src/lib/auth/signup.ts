'use client'

/**
 * Client wire for email self-serve signup. POSTs to the same-origin `/auth/signup`
 * BFF (which mints the account + org as the confidential console client); the
 * browser only sends its request. On success the caller signs in with the same
 * credentials via the normal `loginWithPassword` flow.
 */

export type SignupResult = { kind: 'ok' } | { kind: 'exists' } | { kind: 'error'; message: string }

export async function signUp(email: string, password: string): Promise<SignupResult> {
  let res: Response
  try {
    res = await fetch('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    })
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'Network error.' }
  }
  if (res.ok) return { kind: 'ok' }
  if (res.status === 409) return { kind: 'exists' }
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return { kind: 'error', message: body?.error || `Sign-up failed (HTTP ${res.status}).` }
}
