/**
 * Same-origin user-bearer proxy to commerce for the PLATFORM CATALOG admin surface
 * (`/v1/commerce/catalog/entries` + `/v1/commerce/catalog/seed`) — the SuperAdmin CMS for the product
 * + pricing catalog (the 17 infra tiers increment 1 seeded, plus every product
 * surface docs/pricing/the console read from).
 *
 * The browser calls this OWN-origin route (`/v1/commerce/catalog/...`) with just its session
 * cookie; `forwardWithUserBearer` resolves the user, mints a short-lived user-bound
 * IAM token, and forwards to commerce with that Bearer. Commerce's `requireSuperAdmin`
 * (owner=="admin", the `IsSuperAdmin()` home-org predicate) is the AUTHORITATIVE gate:
 * the platform catalog is cross-tenant `system`-namespace data, so an org-level admin
 * is refused 403 — a tenant can never read cost/margin or edit the catalog. The org is
 * server-authoritative (the Bearer owner), never browser-supplied.
 *
 * This is the ADMIN twin of the tenant `/v1/commerce/*` store proxy: a DISTINCT
 * least-privilege boundary (`allowCatalogSurface`) that admits ONLY the catalog
 * entries + seed paths, so it can never tunnel commerce's `/v1/billing`, `/v1/checkout`,
 * `/_/commerce/tenants`, or the merchant store models. It lives at
 * `app/v1/commerce/catalog/[...path]` — MORE SPECIFIC than the `app/v1/commerce/[...path]`
 * store proxy, so Next resolves `/v1/commerce/catalog/*` here. Commerce's own mount is
 * `/v1/catalog/*`, which is what the upstream path below re-roots at.
 */
import { type NextRequest } from 'next/server'

import { forwardWithUserBearer } from '~/lib/server/bearer-proxy'
import { allowCatalogSurface } from '~/lib/server/proxy-allow'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** Commerce API (commerce.hanzo.ai). In-cluster ClusterIP on :8001; the CR wires
 *  `COMMERCE_URL` (public egress is CF-gated). Override per-deploy / for local dev. */
const COMMERCE_URL = trim(process.env.COMMERCE_URL ?? 'http://commerce.hanzo.svc:8001')

type Ctx = { params: Promise<{ path: string[] }> }

function handle(req: NextRequest, ctx: Ctx) {
  return (async () => {
    // This handler lives under `app/v1/commerce/catalog/[...path]`, so the catch-all captures
    // ONLY the sub-path after `/v1/commerce/catalog/` (e.g. `entries`, `entries/cloud-dev`,
    // `seed`). Commerce serves the catalog admin CRUD at `/v1/catalog/*`, so re-root the
    // upstream path at `v1/catalog/` — the same path `allowCatalogSurface` and
    // `forwardWithUserBearer` see (`v1/catalog/entries`).
    const path = `v1/catalog/${(await ctx.params).path.join('/')}`
    return forwardWithUserBearer(req, {
      target: COMMERCE_URL,
      path,
      allow: allowCatalogSurface,
      // Org is authoritative (Bearer owner). Do NOT forward browser X-Project-Id/
      // X-Environment — the catalog is platform-global and commerce gates on the
      // SuperAdmin home-org from the token.
      unauthorizedMessage: 'Sign in as an administrator to edit the catalog.',
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
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
