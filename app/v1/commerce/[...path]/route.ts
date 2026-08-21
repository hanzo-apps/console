/**
 * Same-origin user-bearer proxy to commerce (`commerce.hanzo.svc`) — everything cloud
 * answers under `/v1/commerce/*`: the store / merchant admin surface (products / orders
 * / customers / collections / variants / discounts / store settings), the PLATFORM
 * CATALOG (`catalog/{entries,seed}`) and the PLAN authority (`plans/{entries,seed}`).
 * The browser calls this OWN-origin route with just its session cookie;
 * `forwardWithUserBearer` resolves the user, mints a short-lived user-bound IAM token,
 * and forwards to commerce with that Bearer. Commerce's EdgeAuth validates the JWT and
 * resolves the org from its `owner` claim (`middleware.TokenRequired` fast-paths IAM
 * auth), so the store is org-scoped SERVER-SIDE — a merchant only ever sees their OWN
 * org's catalog/orders/customers. No token reaches the browser, and the org is never
 * browser-supplied. The catalog and plan CMS are cross-tenant `system`-namespace data
 * behind commerce's own `requireSuperAdmin` (owner=="admin"), which stays the
 * authoritative gate — an org-level admin is refused 403 and can never read cost/margin.
 *
 * ONE proxy, because commerce is ONE backend: catalog and plans used to have their own
 * `/v1/{catalog,plans}` doors, which were three addresses for one binary.
 *
 * This is the TENANT store surface (any signed-in org member acts on their own org's
 * store), so it is user-scoped (`resolveUser`), NOT the god-mode service-token path. It
 * is also DISTINCT from the `/billing` proxy: money (balance/usage/invoices/Square)
 * stays on `/billing` with its own per-tenant subject scoping. Least privilege on the
 * path: `allowCommerceSurface` admits only the merchant REST heads (product/order/user/…)
 * plus the exact catalog + plan entry/seed routes, so `/v1/billing`, `/v1/checkout` and
 * `/_/commerce/tenants` are NOT reachable here.
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
    // This handler lives under `app/v1/commerce/[...path]`, so the catch-all captures
    // ONLY the sub-path after `/v1/commerce/` (e.g. `product`, `catalog/entries`).
    // Commerce serves its REST models under `/v1/<model>` and the two CMS surfaces under
    // `/v1/{catalog,plans}/*`, so re-root the upstream path at `v1/` — the same path
    // `allowCommerceSurface` and `forwardWithUserBearer` see (`v1/product`).
    const path = `v1/${(await ctx.params).path.join('/')}`
    return forwardWithUserBearer(req, {
      target: COMMERCE_URL,
      path,
      allow: allowCommerceSurface,
      // Org is authoritative (Bearer owner). Do NOT forward browser X-Project-Id/
      // X-Environment — the store is org-keyed and commerce re-scopes on the token.
      unauthorizedMessage: 'Sign in to manage commerce.',
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
