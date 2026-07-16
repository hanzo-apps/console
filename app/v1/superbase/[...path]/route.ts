/**
 * Per-user proxy to the Hanzo Base control plane (base.hanzo.ai) — the embedded
 * Base module's ONE transport. The browser calls console2's OWN origin
 * (`/v1/superbase/...`) with just the session cookie; `forwardWithUserBearer`
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
 * Least privilege on the path too: only the Base DATA PLANE is proxied — the
 * collection schemas (read) and any collection's records (list/get/create/update/
 * delete), via `allowBaseSurface`. Base's admin/settings/backup/log surfaces 404,
 * so this stays a data-plane proxy, not a general Base tunnel. Base still authorizes
 * every read/write per-user and per-collection itself, so a non-admin sees only what
 * a collection's rules permit and gets Base's own honest 403 on a denied mutation.
 * (The tenants manager rides this same proxy — records/tenants is one such path.)
 */
import { type NextRequest } from 'next/server'

import { forwardWithUserBearer } from '~/lib/server/bearer-proxy'
import { allowBaseSurface } from '~/lib/server/proxy-allow'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** The Base control plane the proxied calls are forwarded to. */
const BASE_URL = trim(process.env.BASE_DASHBOARD_URL ?? 'https://base.hanzo.ai')

type Ctx = { params: Promise<{ path: string[] }> }

function handle(req: NextRequest, ctx: Ctx) {
  return (async () => {
    // This handler lives under `app/v1/superbase/[...path]`, so the catch-all captures
    // ONLY the sub-path after `/v1/superbase/` (e.g. `collections/...`). Base serves its
    // data plane under `/v1/collections`, so re-root the upstream path at `v1/` — the same
    // path `allowBaseSurface` and `forwardWithUserBearer` see (`v1/collections/...`).
    const path = `v1/${(await ctx.params).path.join('/')}`
    return forwardWithUserBearer(req, {
      target: BASE_URL,
      path,
      allow: allowBaseSurface,
      unauthorizedMessage: 'Sign in to manage Base records.',
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
