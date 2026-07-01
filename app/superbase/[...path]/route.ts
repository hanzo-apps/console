/**
 * Per-user proxy to the Hanzo Base control plane (base.hanzo.ai) — the embedded
 * Base module's ONE transport. The browser calls console2's OWN origin
 * (`/superbase/v1/...`) with just the session cookie; `forwardWithUserBearer`
 * resolves the user, mints a short-lived user-bound IAM token (shared per-user
 * cache), and forwards to base.hanzo.ai with that token. No token ever reaches the
 * browser, and the SAME @hanzo/superbase-dashboard screens render here and standalone.
 *
 * NOT the PaaS pattern: PaaS forwards a god-mode SERVICE token and is gated to brand
 * admins. Base authorizes PER USER itself — the `tenants` collection's
 * `ListRule = "owner_iam_user = @request.auth.id"` and admin-only mutations are
 * enforced by Base against the forwarded user identity. So here we forward the
 * USER's own minted bearer (least privilege, tenant-scoped by Base), and the only
 * gate is "must be signed in" (resolveUser → 401). A non-admin simply sees their own
 * tenants and gets Base's 403 on a mutation — honest, not faked.
 *
 * Least privilege on the path too: only the `tenants` collection records surface is
 * proxied; anything else 404s, so this is not a general Base tunnel.
 */
import { type NextRequest } from 'next/server'

import { forwardWithUserBearer } from '~/lib/server/bearer-proxy'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** The Base control plane the proxied calls are forwarded to. */
const BASE_URL = trim(process.env.BASE_DASHBOARD_URL ?? 'https://base.hanzo.ai')

/** Only the tenants collection records surface (list/get/create/update/delete). */
const RECORDS = 'v1/collections/tenants/records'
const allow = (rel: string): boolean => rel === RECORDS || rel.startsWith(`${RECORDS}/`)

type Ctx = { params: Promise<{ path: string[] }> }

function handle(req: NextRequest, ctx: Ctx) {
  return (async () => {
    const path = (await ctx.params).path.join('/')
    return forwardWithUserBearer(req, {
      target: BASE_URL,
      path,
      allow,
      unauthorizedMessage: 'Sign in to manage Base tenants.',
    })
  })()
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
