/**
 * AI-accounts NON-SECRET preferences — the org/user settings route.
 *
 *   GET v1/settings  → { settings: { routingEnabled } }
 *   PUT v1/settings  → persist { routingEnabled } (sealed), returns the new settings
 *
 * The one preference today is `routingEnabled` — the org's `model: "auto"` smart-
 * routing default that Hanzo surfaces read. Persisted with the SAME sealed-cookie
 * store as the credential blob (`lib/server/ai-accounts`); there is no secret here,
 * so the seal is for integrity, not confidentiality. Session-gated; the mutating
 * verb is CSRF-guarded (auto-sent cookie → refuse cross-origin first).
 *
 * A static route, so it wins over the sibling `[...path]` catch-all for this exact
 * path (same rule as `/ai-accounts/v1/usage`).
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser } from '~/lib/server/identity'
import { csrfRefusal } from '~/lib/server/bearer-proxy'
import { applyCookies } from '~/lib/server/session'
import { readSettings, settingsCookie, normalizeSettings } from '~/lib/server/ai-accounts'

export const runtime = 'nodejs'

const unauthorized = () => NextResponse.json({ error: 'Sign in to manage AI settings.' }, { status: 401 })

export async function GET(req: NextRequest) {
  const user = await resolveUser(req)
  if (!user) return unauthorized()
  return NextResponse.json({ settings: readSettings(req) })
}

export async function PUT(req: NextRequest) {
  const csrf = csrfRefusal(req)
  if (csrf) return csrf
  const user = await resolveUser(req)
  if (!user) return unauthorized()

  const body = (await req.json().catch(() => null)) as { routingEnabled?: unknown } | null
  if (typeof body?.routingEnabled !== 'boolean') {
    return NextResponse.json({ error: 'routingEnabled (boolean) is required.' }, { status: 400 })
  }
  const settings = normalizeSettings(body)
  return applyCookies(NextResponse.json({ settings }), [settingsCookie(settings)])
}
