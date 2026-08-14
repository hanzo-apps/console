/**
 * Same-origin proxy to the PaaS control plane (Job 3 — embedded PaaS). The
 * browser calls console2's OWN origin (`/paas/...`); this server-side handler
 * forwards to the ONE Hanzo API endpoint at `/v1/paas/...`, injecting the
 * service token from server-only env (sourced via KMS — never `NEXT_PUBLIC_`,
 * never in the browser bundle). This is the real control-plane API, not an
 * iframe stub.
 *
 * ONE ENDPOINT: there is no per-service API host. `/v1/paas/*` is served by the
 * unified backend behind `api.hanzo.ai` (same `CLOUD_API_URL` every other server
 * proxy here uses — in-cluster in prod, the public gateway everywhere else). It
 * used to aim at `platform.hanzo.ai`, which serves NO `/v1/paas/*` route at all
 * and 401s every `/v1/*` path uniformly, so the board could never load.
 *
 * SECURITY: the forwarded token is a PLATFORM SERVICE token — full control-plane
 * authority, NOT tenant-scoped. So this route is gated to brand admins exactly
 * like the IAM/KMS admin proxies: `getAdminGate` resolves the caller from their
 * own session and requires a verified brand-admin (no gate → 403). Without this,
 * any authenticated browser could drive the whole control plane through the
 * service token. The gate is the control, NOT a deploy-time env toggle.
 *
 * When `PAAS_SERVICE_TOKEN` is unset the proxy returns an honest 501 so the UI
 * can show a truthful "not configured" state — it never fabricates apps/deploys.
 *
 * SCOPE: the browser stamps the active tenant path (X-Org-Id / X-Project-Id /
 * X-Environment) on every call. We forward it to the control plane so PaaS
 * resources scope by org → project → environment like the rest of the console —
 * but the ORG is re-resolved server-side through the admin policy (`orgFor`): a
 * global admin's switched org is honored, a brand admin is PINNED to their own,
 * so the forwarded X-Org-Id is authoritative and never the spoofable claim.
 * Project + environment are sub-scopes the admin picks WITHIN that org, passed
 * through verbatim.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { getAdminGate } from '~/lib/server/identity'
import { orgFor as policyOrgFor } from '~/lib/server/admin-policy'
import { csrfRefusal } from '~/lib/server/bearer-proxy'
import { fetchWithTimeout } from '~/lib/server/fetch-timeout'

export const runtime = 'nodejs'

const API_URL = (process.env.CLOUD_API_URL ?? 'https://api.hanzo.ai').replace(/\/+$/, '')
const TOKEN = process.env.PAAS_SERVICE_TOKEN ?? ''

async function forward(req: NextRequest, path: string[]): Promise<NextResponse> {
  // CSRF FIRST — the service token below is control-plane god-mode, so a cross-site
  // page carrying the admin's auto-sent cookie must never drive a deploy/scale/delete.
  // Refuse a cross-origin MUTATION before the admin gate or any body read (safe reads
  // pass). Defense in depth on top of the session cookie's own SameSite attribute.
  const csrf = csrfRefusal(req)
  if (csrf) return csrf

  // Brand-admin gate — the service token below is control-plane god-mode.
  const gate = await getAdminGate(req)
  if (!gate) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!TOKEN) {
    return NextResponse.json(
      { error: 'The PaaS control plane is not configured on this deployment, so app and project reads cannot be served. Your cloud operator configures it.' },
      { status: 501 },
    )
  }
  // Resolve the authoritative tenant path. Org: the admin policy honors a
  // SuperAdmin's switched org (the X-Org-Id the browser sends = currentOrg()) and pins
  // a brand admin to their own — so we forward the resolved org, never the raw
  // claim. Project + environment are sub-scopes within that org, forwarded as-is.
  const org = policyOrgFor(
    { isSuperAdmin: gate.user.isSuperAdmin, orgScope: gate.orgScope },
    req.headers.get('X-Org-Id'),
  )
  const projectId = req.headers.get('X-Project-Id')
  const environment = req.headers.get('X-Environment')

  const search = req.nextUrl.search
  // `/paas/<x>` → `/v1/paas/<x>`. The control plane mounts under `/v1/paas`; this
  // route prefixed only `/v1`, so every call landed on a path that does not exist
  // (`/paas/apps` → `/v1/apps` → 404) and the board rendered nothing. The name is
  // 1:1 on both sides: this proxy is the PaaS plane, so it forwards to the PaaS
  // plane. It aimed at `/v1/<x>` because that IS where the standalone Node platform
  // served apps; the plane moved into cloud under `/v1/paas` and the path did not.
  const url = `${API_URL}/v1/paas/${path.join('/')}${search}`
  const init: RequestInit = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Org-Id': org,
      ...(projectId ? { 'X-Project-Id': projectId } : {}),
      ...(environment ? { 'X-Environment': environment } : {}),
    },
    // Never cache control-plane reads.
    cache: 'no-store',
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text()
  }
  try {
    const res = await fetchWithTimeout(url, init)
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch (e) {
    return NextResponse.json(
      { error: `PaaS upstream unreachable: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
