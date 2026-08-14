/**
 * AI-account credential store — the per-user connect/list/disconnect route.
 *
 *   GET    v1/accounts               → { providers: masked[] }  (existence + mode, NO secret)
 *   POST   v1/accounts/:providerId   → seal a pasted API key / OAuth token / cookie header
 *   DELETE v1/accounts/:providerId   → drop the sealed credential
 *
 * The secret is sealed into an httpOnly cookie server-side (`lib/server/ai-accounts`)
 * and NEVER echoed back or logged. Every request is session-gated (`resolveUser`); the
 * two mutating verbs are CSRF-guarded (auto-sent cookie → refuse cross-origin first).
 *
 * Namespaced under `/v1/ai-accounts/` so the data plane never shadows the UI tab URLs
 * (`/ai-accounts`, `/ai-accounts/accounts`) — a route handler always wins over the
 * catch-all page, so the two live in disjoint path space (same rule as `/v1/billing/`).
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser } from '~/lib/server/identity'
import { csrfRefusal } from '~/lib/server/bearer-proxy'
import { applyCookies } from '~/lib/server/session'
import {
  readAccounts,
  accountsCookie,
  maskAccounts,
  type AiAccountsStore,
  type StoredCredential,
} from '~/lib/server/ai-accounts'
import { isAiProvider, type ConnectMode } from '~/lib/products/ai-accounts'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ path: string[] }> }

const MODES: ConnectMode[] = ['api', 'oauth', 'web']
const unauthorized = () => NextResponse.json({ error: 'Sign in to manage AI accounts.' }, { status: 401 })
const notFound = () => NextResponse.json({ error: 'Not found.' }, { status: 404 })

export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await resolveUser(req)
  if (!user) return unauthorized()
  const seg = (await ctx.params).path
  if (seg[0] !== 'accounts' || seg.length !== 1) return notFound()
  return NextResponse.json({ providers: maskAccounts(readAccounts(req)) })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const csrf = csrfRefusal(req)
  if (csrf) return csrf
  const user = await resolveUser(req)
  if (!user) return unauthorized()

  const seg = (await ctx.params).path
  const id = seg[1]
  if (seg[0] !== 'accounts' || !id) return notFound()
  if (!isAiProvider(id)) return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 })

  const body = (await req.json().catch(() => null)) as { mode?: string; secret?: string; baseUrl?: string } | null
  const mode = body?.mode as ConnectMode
  const secret = typeof body?.secret === 'string' ? body.secret.trim() : ''
  if (!MODES.includes(mode) || !secret) {
    return NextResponse.json({ error: 'Connecting an account needs both how to connect it and the credential itself. One of the two was missing or empty.' }, { status: 400 })
  }

  const cred: StoredCredential = {
    mode,
    secret, // sealed at rest by accountsCookie; never logged.
    baseUrl: body?.baseUrl?.trim() || undefined,
    connectedAt: new Date().toISOString(),
  }
  const next: AiAccountsStore = { ...readAccounts(req), [id]: cred }
  return applyCookies(NextResponse.json({ providers: maskAccounts(next) }), [accountsCookie(next)])
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const csrf = csrfRefusal(req)
  if (csrf) return csrf
  const user = await resolveUser(req)
  if (!user) return unauthorized()

  const seg = (await ctx.params).path
  const id = seg[1]
  if (seg[0] !== 'accounts' || !id) return notFound()

  const store = readAccounts(req)
  delete store[id]
  return applyCookies(NextResponse.json({ providers: maskAccounts(store) }), [accountsCookie(store)])
}
