/**
 * Server-gated GLOBAL admin aggregate proxy — the cross-tenant business/platform
 * reads (`/v1/admin/{overview,usage,orgs,audit,products,finance,compute,providers}`)
 * AND the few GLOBAL-admin mutations that ride the same god-view gate
 * (`POST /v1/admin/providers/{toggle,primary}` — flip shared-gateway provider
 * routing that affects every org).
 *
 * The admin business board is an ALL-ORGS god view (`?org=all`) over IAM + commerce
 * + o11y. So — unlike the per-tenant `/v1` proxy, which authorizes on the bearer
 * `owner` claim and is safe for any authenticated user — this MUST be gated to a
 * GLOBAL admin BEFORE anything is forwarded: a tenant customer (even one who is
 * `isAdmin` of their own org) must NOT read another org's revenue/spend/customers,
 * must NOT trigger the `org=all` aggregate at all, and must NOT flip a shared
 * provider's enabled/primary state.
 *
 * Defense in depth (RED H1 — the cloud-side gate for `/v1/admin/*` is a separate
 * backend contract we cannot see or test from this repo): `getAdminGate` enforces the
 * SAME policy the IAM/KMS admin proxies use — a VERIFIED `@<brand.adminDomain>` email
 * AND an IAM global-admin flag, fail-closed (→ 403) on any miss. Only then does the
 * shared `forwardWithUserBearer` mint a short-lived user bearer and forward to
 * cloud-api, applying the usual path-traversal + same-origin-CSRF hardening. On a
 * mutating method (POST), that CSRF gate (Sec-Fetch-Site ≠ cross-site AND Origin/
 * Referer host == Host, fail-closed 403 BEFORE resolving the user) means a
 * cross-site page can never flip a provider on the victim admin's behalf. The
 * browser holds no cloud credential and cannot reach this endpoint without passing
 * the gate; the client-side `admin: true` nav gate + `AdminManagedNotice` is UI-only
 * defense-in-depth, never the boundary.
 *
 * Least privilege: only the admin aggregate heads are reachable, NOT `iam`/`kms`
 * (those keep their own gated proxies with their own tenant-scoping semantics) — this
 * is not a general cloud-api tunnel. `allowAdminSurface` admits `v1/admin/<head>[/...]`
 * (the exact forwarded upstream shape), so `providers` covers the GET list and the
 * `providers/{toggle,primary}` POSTs and nothing else. `next.config.mjs` rewrites
 * `/v1/admin/<head>[/...]` here for BOTH GET and POST (dropping the `/v1/` into the
 * internal Next route path); this handler re-adds `v1/` for the upstream cloud call,
 * and the client calls the clean same-origin `/v1/admin/*` form (unchanged).
 */
import { type NextRequest, NextResponse } from 'next/server'

import { cloudAudience } from '~/config'
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
  // the FULL cloud path, which is `/v1/admin/<head>` — cloud serves every admin route
  // under `/v1/admin/*` (the beego `/v1/*` glob in hanzoai/ai + cloud's own
  // `clients/admin` `app.Get("/v1/admin/…")`), and `forwardWithUserBearer` forwards to
  // `target/path` VERBATIM (no `/v1` prepend), so the `v1/` MUST be part of the path
  // here or the request lands on a non-existent bare `/admin/*` and 404s. The rewrite
  // destination (`app/admin/aggregate/<head>`) is the internal Next route, not the
  // upstream — it deliberately carries no `v1/`; this handler adds it.
  // `forwardWithUserBearer` re-validates the exact forwarded path via `allow`
  // (`allowAdminSurface`, keyed on the `v1/admin/<head>` shape) + `pathIsClean`.
  const path = `v1/admin/${(await ctx.params).path.join('/')}`.replace(/\/+$/, '')
  return forwardWithUserBearer(req, {
    target: CLOUD_API_URL,
    path,
    allow: allowAdminSurface,
    // Scope the minted user bearer to the brand's cloud audience (`<brand>-cloud`).
    // The operator is a member of the reserved `admin` org, whose OWN app is
    // `admin-console` — NOT in cloud's audience allowlist — so a default-audience
    // bearer is rejected (anonymous → 403 on every /v1/admin/*). With the cloud
    // audience, cloud validates the token and, seeing owner=admin + isAdmin=true,
    // sets X-User-IsAdmin=true. Host-aware so a lux/zoo admin host scopes to its own
    // brand cloud audience. (Tenant proxies are unchanged — they omit this.)
    audience: cloudAudience(req.headers.get('host')),
    // The AdminApi client unwraps the casibase `{status,msg,data}` envelope, so this
    // proxy's own 401/404 must speak the same shape (an honest state, never a throw).
    errorShape: 'casibase',
    unauthorizedMessage: 'Sign in as an administrator.',
  })
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}

/**
 * POST — the GLOBAL-admin mutations that ride the same god-view gate
 * (`/v1/admin/providers/{toggle,primary}`, `/v1/admin/caps` create). Identical
 * path through `getAdminGate` (fail-closed 403) → `forwardWithUserBearer`, which applies
 * the same-origin CSRF check to this mutating method BEFORE resolving the user, streams
 * the JSON body through, and re-validates the path against `allowAdminSurface` (so a POST
 * can only ever reach an allowed head — never `iam`/`kms`, never a traversal).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}

/**
 * PUT — the GLOBAL-admin upserts on the same god-view gate (`PUT /v1/admin/pricing/enablement`
 * flip an item off|beta|ga + grant orgs; `PUT /v1/admin/promos` upsert the single
 * platform plan promo). Same gate + same CSRF/traversal hardening as POST;
 * `allowAdminSurface` admits only the declared heads, nothing else.
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}

/**
 * PATCH — the GLOBAL-admin partial edits (`PATCH /v1/admin/caps/:id?org=<slug>`,
 * override an org's usage cap). Same gate + same CSRF/traversal hardening; the `:id`
 * sub-path passes because `allowAdminSurface` admits `v1/admin/caps[/...]`.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}

/**
 * DELETE — the GLOBAL-admin removals (`DELETE /v1/admin/caps/:id?org=<slug>`,
 * remove an org's usage cap). Same gate + CSRF/traversal hardening as the other
 * mutating verbs; only an allow-listed head/sub-path is ever reached.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
