/**
 * Same-origin user-bearer proxy to commerce (`commerce.hanzo.svc`) — the store /
 * merchant admin surface (products / orders / customers / collections / variants /
 * discounts / store settings). The browser calls this OWN-origin route
 * (`/commerce/v1/...`) with just its session cookie; `forwardWithUserBearer` resolves
 * the user, mints a short-lived user-bound IAM token, and forwards to commerce with
 * that Bearer. Commerce's EdgeAuth validates the JWT and resolves the org from its
 * `owner` claim (`middleware.TokenRequired` fast-paths IAM auth), so the store is
 * org-scoped SERVER-SIDE — a merchant only ever sees their OWN org's catalog/orders/
 * customers. No token reaches the browser, and the org is never browser-supplied.
 *
 * This is the TENANT store surface (any signed-in org member acts on their own org's
 * store), so it is user-scoped (`resolveUser`), NOT the `/paas` god-mode service-token
 * path. It is also DISTINCT from the `/billing` proxy: money (balance/usage/invoices/
 * Square) stays on `/billing` with its own per-tenant subject scoping — this proxy
 * carries only the store catalog/orders/customers. Least privilege on the path:
 * `allowCommerceSurface` admits only the merchant REST heads (product/order/user/…),
 * so `/v1/billing`, `/v1/checkout`, `/_/commerce/tenants` are NOT reachable here.
 */
import { type NextRequest } from 'next/server'

import { forwardWithUserBearer } from '~/lib/server/bearer-proxy'
import { allowCommerceSurface } from '~/lib/server/proxy-allow'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** Commerce API (commerce.hanzo.ai). In-cluster ClusterIP on :8001; the CR already
 *  wires `COMMERCE_URL` (public egress is CF-gated). Override per-deploy with COMMERCE_URL. */
const COMMERCE_URL = trim(process.env.COMMERCE_URL ?? 'http://commerce.hanzo.svc:8001')

type Ctx = { params: Promise<{ path: string[] }> }

function handle(req: NextRequest, ctx: Ctx) {
  return (async () => {
    const path = (await ctx.params).path.join('/')
    return forwardWithUserBearer(req, {
      target: COMMERCE_URL,
      path,
      allow: allowCommerceSurface,
      // Org is authoritative (Bearer owner). Do NOT forward browser X-Project-Id/
      // X-Environment — the store is org-keyed and commerce re-scopes on the token.
      unauthorizedMessage: 'Sign in to manage your store.',
    })
  })()
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
