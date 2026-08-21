/**
 * Same-origin user-bearer proxy to commerce for the PLATFORM PLAN admin surface
 * (`/v1/commerce/plans/entries` + `/v1/commerce/plans/seed`) — the SuperAdmin CMS for the subscription/DNS
 * plan authority (`models/plan`, the source of truth `GET /v1/billing/plans` and the
 * internal-ledger renewal charge derive from).
 *
 * The browser calls this OWN-origin route (`/v1/commerce/plans/...`) with just its session
 * cookie; `forwardWithUserBearer` resolves the user, mints a short-lived user-bound IAM
 * token, and forwards to commerce with that Bearer. Commerce's `requireSuperAdmin`
 * (owner=="admin") is the AUTHORITATIVE gate: the plan authority is cross-tenant
 * `system`-namespace PRICING data — a plan's price is the real renewal charge — so an
 * org-level admin is refused 403. The org is server-authoritative (the Bearer owner).
 *
 * The ADMIN twin of the tenant `/v1/commerce/*` store proxy and the sibling
 * `/v1/commerce/catalog/*` proxy: a DISTINCT least-privilege boundary (`allowPlansSurface`) that
 * admits ONLY the plan entries + seed paths, so it can never tunnel commerce's
 * `/v1/billing`, `/v1/checkout`, `/_/commerce/tenants`, or the merchant store models. It
 * lives at `app/v1/commerce/plans/[...path]` — MORE SPECIFIC than the
 * `app/v1/commerce/[...path]` store proxy, so Next resolves `/v1/commerce/plans/*` here.
 * Commerce's own mount is `/v1/plans/*`, which is what the upstream path below re-roots at.
 */
import { type NextRequest } from 'next/server'

import { forwardWithUserBearer } from '~/lib/server/bearer-proxy'
import { allowPlansSurface } from '~/lib/server/proxy-allow'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** Commerce API (commerce.hanzo.ai). In-cluster ClusterIP on :8001; the CR wires
 *  `COMMERCE_URL` (public egress is CF-gated). Override per-deploy / for local dev. */
const COMMERCE_URL = trim(process.env.COMMERCE_URL ?? 'http://commerce.hanzo.svc:8001')

type Ctx = { params: Promise<{ path: string[] }> }

function handle(req: NextRequest, ctx: Ctx) {
  return (async () => {
    // This handler lives under `app/v1/commerce/plans/[...path]`, so the catch-all captures
    // ONLY the sub-path after `/v1/commerce/plans/` (e.g. `entries`, `entries/pro`, `seed`).
    // Commerce serves the plan admin CRUD at `/v1/plans/*`, so re-root the upstream path at
    // `v1/plans/` — the same path `allowPlansSurface` and `forwardWithUserBearer` see.
    const path = `v1/plans/${(await ctx.params).path.join('/')}`
    return forwardWithUserBearer(req, {
      target: COMMERCE_URL,
      path,
      allow: allowPlansSurface,
      // Org is authoritative (Bearer owner). Do NOT forward browser X-Project-Id/
      // X-Environment — the plan authority is platform-global and commerce gates on the
      // SuperAdmin home-org from the token.
      unauthorizedMessage: 'Sign in as an administrator to edit plans.',
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
