/**
 * Server-gated KMS admin proxy — the ONLY way the browser reaches Hanzo KMS.
 *
 * Same trust boundary as the IAM proxy: the browser sends only its session
 * cookie, this handler enforces the brand-admin gate, then forwards to kmsd as
 * the user (short-lived user-bound bearer) so KMS enforces org isolation from the
 * verified `owner` claim (`canActOnOrg`). Secrets are scoped to the brand org by
 * default; a global admin may target another org with `?org=`.
 *
 * Zero-knowledge discipline: this route NEVER logs a secret value or any request
 * body, and never derives or stores key material — it is a faithful pass-through
 * of kmsd's JSON + status code. One resource path (`/admin/kms/secrets`); the
 * verb + query select the operation:
 *   GET   ?path=&name=&env=   → reveal one value      → GET    .../secrets/<path>/<name>?env=
 *   GET   ?prefix=&env=       → list metadata          → GET    .../secrets?prefix=&env=
 *   POST  {path,name,env,value} → create/upsert        → POST   .../secrets
 *   PATCH ?path=&name= {value,version,env} → rotate    → PATCH  .../secrets/<path>/<name>
 *   DELETE ?path=&name=&env=  → delete                 → DELETE .../secrets/<path>/<name>?env=
 *
 * kmsd has no list endpoint yet — the list GET returns 404, which the KMS module
 * renders as an honest "listing requires kmsd ≥ next release" state.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { getAdminGate, adminBearer, kmsBaseUrl, type AdminGate } from '~/lib/server/identity'
import { orgFor as policyOrgFor } from '~/lib/server/admin-policy'
import { csrfRefusal } from '~/lib/server/bearer-proxy'
import { fetchWithTimeout } from '~/lib/server/fetch-timeout'

export const runtime = 'nodejs'

const forbidden = () => NextResponse.json({ error: 'forbidden' }, { status: 403 })
const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 })

/** `<path>/<name>` for the kmsd route, each segment encoded, slashes preserved. */
function secretRest(path: string, name: string): string {
  return [...path.split('/').filter(Boolean), name].map(encodeURIComponent).join('/')
}

/** Org the operator acts on — the brand org, unless a SuperAdmin passes ?org=
 *  (the pure `admin-policy` predicate, tested in admin-policy.test.ts). */
function orgFor(gate: AdminGate, req: NextRequest): string {
  return policyOrgFor(
    { isSuperAdmin: gate.user.isSuperAdmin, orgScope: gate.orgScope },
    req.nextUrl.searchParams.get('org'),
  )
}

async function handle(req: NextRequest, segments: string[]): Promise<NextResponse> {
  // CSRF: a cross-site page carrying the admin's auto-sent cookie must never be able
  // to create / rotate / delete a KMS secret. Refuse a cross-origin MUTATION before
  // the admin gate or any body read (safe GET reveals pass). Defense in depth on top
  // of the session cookie's own SameSite attribute.
  const csrf = csrfRefusal(req)
  if (csrf) return csrf

  const gate = await getAdminGate(req)
  if (!gate) return forbidden()
  if (segments.length !== 1 || segments[0] !== 'secrets') return notFound()

  const org = orgFor(gate, req)
  // The org travels on the IDENTITY channel, never the URL: cloud's KMS surface
  // is /v1/kms/secrets and reads the acted-on org from the validated principal
  // (X-Org-Id — for a SuperAdmin, the switched-into org; the same one-predicate
  // switch every other subsystem honors). URL-addressed orgs were removed
  // server-side because a path that names a tenant is caller-selectable.
  const base = `${kmsBaseUrl()}/v1/kms/secrets`
  const q = req.nextUrl.searchParams
  const name = q.get('name') ?? ''
  const path = q.get('path') ?? ''
  const env = q.get('env') ?? ''

  let target: string
  let body: string | undefined
  if (req.method === 'GET') {
    if (name) {
      const params = new URLSearchParams()
      if (env) params.set('env', env)
      target = `${base}/${secretRest(path, name)}${params.toString() ? `?${params}` : ''}`
    } else {
      const params = new URLSearchParams()
      const prefix = q.get('prefix')
      if (prefix) params.set('prefix', prefix)
      if (env) params.set('env', env)
      target = `${base}${params.toString() ? `?${params}` : ''}`
    }
  } else if (req.method === 'POST') {
    target = base
    body = await req.text() // {path,name,env,value} — forwarded verbatim, never logged
  } else if (req.method === 'PATCH') {
    if (!name) return notFound()
    target = `${base}/${secretRest(path, name)}`
    body = await req.text() // {value,version,env} — forwarded verbatim, never logged
  } else if (req.method === 'DELETE') {
    if (!name) return notFound()
    const params = new URLSearchParams()
    if (env) params.set('env', env)
    target = `${base}/${secretRest(path, name)}${params.toString() ? `?${params}` : ''}`
  } else {
    return notFound()
  }

  let bearer: string
  try {
    bearer = await adminBearer(gate.user)
  } catch (e) {
    return NextResponse.json(
      { message: `Could not authorize the request: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${bearer}`, Accept: 'application/json', 'X-Org-Id': org }
  const init: RequestInit = { method: req.method, headers, cache: 'no-store' }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = body
  }

  try {
    const res = await fetchWithTimeout(target, init)
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch (e) {
    // Surface only the transport failure — never the request body/value.
    return NextResponse.json(
      { message: `KMS unreachable: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path)
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path)
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path)
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path)
}
