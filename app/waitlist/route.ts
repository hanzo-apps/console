/**
 * Waitlist join — the "Join waitlist" CTA on coming-soon products, server-side.
 *
 * Same-origin (`/waitlist`): the browser posts only its session cookie + the
 * waitlist slug and email; this handler forwards to the Hanzo Base waitlist
 * plugin (`POST /v1/waitlist/join`, the hanzoai/waitlist pattern — a per-product
 * SQLite-backed list). The backend URL is server-only env `WAITLIST_URL` (never
 * NEXT_PUBLIC_); when it is unset the route returns an honest 501 and the form
 * says the waitlist isn't open yet — no fake confirmation.
 *
 * The console UI is auth-gated, so we require a session (a signed-in user) to
 * keep this proxy from being an open relay to the waitlist backend, and forward
 * the client IP so the backend's per-IP rate limit still applies.
 *
 *   POST /waitlist { waitlist, email } → { ok, rank, total, alreadyJoined, … }
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser } from '~/lib/server/identity'
import { fetchWithTimeout } from '~/lib/server/fetch-timeout'

export const runtime = 'nodejs'

const WAITLIST_URL = (process.env.WAITLIST_URL ?? '').replace(/\/+$/, '')

/** Minimal email sanity check — the backend is authoritative (disposable, etc.). */
const looksLikeEmail = (s: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await resolveUser(req)
  if (!user) return NextResponse.json({ error: 'Sign in to join the waitlist.' }, { status: 401 })

  if (!WAITLIST_URL) {
    return NextResponse.json(
      { error: 'The waitlist is not open on this deployment yet.' },
      { status: 501 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { waitlist?: string; email?: string }
  const waitlist = (body.waitlist ?? '').trim()
  // BIND the recorded email to the SESSION: prefer the authenticated account email so
  // a signed-in user can't enroll someone else (victim@othercorp) or forge "org X
  // wants ERP". The client-supplied email is only a fallback for an account with no
  // email on file. (RED review.)
  const email = ((user.email && user.email.trim()) || (body.email ?? '').trim()).trim()
  if (!waitlist) return NextResponse.json({ error: 'Missing waitlist.' }, { status: 400 })
  if (!looksLikeEmail(email)) return NextResponse.json({ error: 'Enter a valid email.' }, { status: 400 })

  // Do NOT forward the client-controllable X-Forwarded-For — it's forgeable (a caller
  // could spoof a fresh source IP per request to defeat the backend's per-IP limit).
  // The backend sees this server's connection IP; per-user abuse is already bounded by
  // the session gate above. (RED review.)
  let res: Response
  try {
    res = await fetchWithTimeout(`${WAITLIST_URL}/v1/waitlist/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ waitlist, email }),
      cache: 'no-store',
    })
  } catch (e) {
    return NextResponse.json(
      { error: `Could not reach the waitlist: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  const text = await res.text()
  return new NextResponse(text, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
  })
}
