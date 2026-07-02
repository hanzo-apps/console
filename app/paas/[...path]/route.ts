/**
 * Same-origin proxy to the platform.hanzo.ai control plane (Job 3 — embedded
 * PaaS). The browser calls console2's OWN origin (`/paas/...`); this server-side
 * handler forwards to `platform.hanzo.ai/v1/...`, injecting the service token
 * from server-only env (sourced via KMS — never `NEXT_PUBLIC_`, never in the
 * browser bundle). This is the real control-plane API, not an iframe stub.
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
import { fetchWithTimeout } from '~/lib/server/fetch-timeout'

export const runtime = 'nodejs'

const PLATFORM_URL = (process.env.PLATFORM_URL ?? 'https://platform.hanzo.ai').replace(/\/+$/, '')
const TOKEN = process.env.PAAS_SERVICE_TOKEN ?? ''

async function forward(req: NextRequest, path: string[]): Promise<NextResponse> {
  // Brand-admin gate FIRST — the service token below is control-plane god-mode.
  const gate = await getAdminGate(req)
  if (!gate) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!TOKEN) {
    return NextResponse.json(
      { error: 'PaaS control plane is not configured (PAAS_SERVICE_TOKEN missing).' },
      { status: 501 },
    )
  }
  // Resolve the authoritative tenant path. Org: the admin policy honors a global
  // admin's switched org (the X-Org-Id the browser sends = currentOrg()) and pins
  // a brand admin to their own — so we forward the resolved org, never the raw
  // claim. Project + environment are sub-scopes within that org, forwarded as-is.
  const org = policyOrgFor(
    { isGlobalAdmin: gate.user.isGlobalAdmin, orgScope: gate.orgScope },
    req.headers.get('X-Org-Id'),
  )
  const projectId = req.headers.get('X-Project-Id')
  const environment = req.headers.get('X-Environment')

  const search = req.nextUrl.search
  const url = `${PLATFORM_URL}/v1/${path.join('/')}${search}`
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
