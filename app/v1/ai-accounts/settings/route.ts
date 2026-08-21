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
 * path (same rule as `/v1/ai-accounts/usage`).
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
    return NextResponse.json({ error: 'Say whether routing should be on or off — the request carried neither.' }, { status: 400 })
  }
  const settings = normalizeSettings(body)

  // Cookie-only, deliberately. cloud-api now enforces per-org auto-routing via
  // `OrgSettings.AutoRouting` (hanzoai/ai), toggled through
  // `PUT /v1/ai/org/settings`. But that endpoint is `RequireGlobalAdmin`-gated
  // (like every /v1/*-model-route admin route) and is NOT gateway-exposed — it is
  // reachable only on the direct api.cloud.hanzo.ai ingress with a global-admin
  // session. This Routing tab is a CUSTOMER surface: `resolveUser` here is a tenant
  // user whose minted `hanzo-console` bearer is NOT global-admin, and the console's
  // only admin proxy (`/admin/aggregate`) fail-closed-403s a non-global-admin. So
  // there is NO clean authenticated path for a customer to write cloud-side
  // OrgSettings, and forging one (a console service token asserting admin authority
  // for a client-supplied org) would be a confused-deputy privilege escalation —
  // refused per "do not bodge auth". The toggle therefore stays the sealed-cookie
  // org preference the Hanzo surfaces read; API `model:"auto"` still honors the
  // GLOBAL router flag. To make this write real, a global-admin must set the org's
  // AutoRouting via the admin console (the OrgSettings CRUD), OR cloud-api must add a
  // self-serve, org-scoped (owner-from-JWT, non-global-admin) auto-routing toggle the
  // `/ai` proxy can reach — at which point wire that call in here.
  return applyCookies(NextResponse.json({ settings }), [settingsCookie(settings)])
}
