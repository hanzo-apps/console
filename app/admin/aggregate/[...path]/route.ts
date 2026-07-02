/**
 * Server-gated GLOBAL admin aggregate proxy — the cross-tenant business/platform
 * reads (`/v1/admin/{overview,usage,orgs,audit,products}`).
 *
 * The admin business board is an ALL-ORGS god view (`?org=all`) over IAM + commerce
 * + o11y. So — unlike the per-tenant `/cloud` proxy, which authorizes on the bearer
 * `owner` claim and is safe for any authenticated user — this MUST be gated to a
 * GLOBAL admin BEFORE anything is forwarded: a tenant customer (even one who is
 * `isAdmin` of their own org) must NOT read another org's revenue/spend/customers,
 * and must NOT be able to trigger the `org=all` aggregate at all.
 *
 * Defense in depth (RED H1 — the cloud-side gate for `/v1/admin/*` is a separate
 * backend contract we cannot see or test from this repo): `getAdminGate` enforces the
 * SAME policy the IAM/KMS admin proxies use — a VERIFIED `@<brand.adminDomain>` email
 * AND an IAM global-admin flag, fail-closed (→ 403) on any miss. Only then does the
 * shared `forwardWithUserBearer` mint a short-lived user bearer and forward to
 * cloud-api, applying the usual path-traversal + same-origin-CSRF hardening. The
 * browser holds no cloud credential and cannot reach this endpoint without passing
 * the gate; the client-side `admin: true` nav gate + `AdminManagedNotice` is UI-only
 * defense-in-depth, never the boundary.
 *
 * Least privilege: only the admin READ heads are reachable (GET), NOT `iam`/`kms`
 * (those keep their own gated proxies with their own tenant-scoping semantics) — this
 * is not a general cloud-api tunnel. `next.config.mjs` rewrites `/v1/admin/<head>`
 * (head ∈ ALLOWED) here; the client calls the clean same-origin `/v1/admin/*` form.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { getAdminGate } from '~/lib/server/identity'
import { forwardWithUserBearer } from '~/lib/server/bearer-proxy'
import { allowAdminSurface } from '~/lib/server/admin-aggregate'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** The unified cloud backend (hanzoai/cloud). In-cluster ClusterIP — public egress is CF-403'd.
 *  `|| default` (not `??`) so an env reconciled to an EMPTY string still resolves the service. */
const CLOUD_API_URL = trim(process.env.CLOUD_API_URL?.trim() || 'http://cloud-api.hanzo.svc.cluster.local:8000')

const forbidden = () => NextResponse.json({ status: 'error', msg: 'forbidden' }, { status: 403 })

type Ctx = { params: Promise<{ path: string[] }> }

async function handle(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  // AUTHORIZE FIRST — global-admin only, fail-closed. A non-global-admin (tenant
  // customer, org-level isAdmin) gets a 403 and never triggers the org=all aggregate.
  const gate = await getAdminGate(req)
  if (!gate) return forbidden()

  // The rewrite feeds the tail after `/v1/admin/` (e.g. `overview`, `audit`); rebuild
  // the cloud path. `forwardWithUserBearer` re-validates via `allow` + `pathIsClean`.
  const path = `admin/${(await ctx.params).path.join('/')}`.replace(/\/+$/, '')
  return forwardWithUserBearer(req, {
    target: CLOUD_API_URL,
    path,
    allow: allowAdminSurface,
    // The AdminApi client unwraps the casibase `{status,msg,data}` envelope, so this
    // proxy's own 401/404 must speak the same shape (an honest state, never a throw).
    errorShape: 'casibase',
    unauthorizedMessage: 'Sign in as an administrator.',
  })
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
