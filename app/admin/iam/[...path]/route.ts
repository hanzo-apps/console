/**
 * Server-gated IAM admin proxy — the ONLY way the browser reaches IAM admin ops.
 *
 * The browser holds no IAM credential and never calls IAM directly. It calls this
 * SAME-ORIGIN route with just its session cookie; the handler resolves the user,
 * enforces the brand-admin gate (`getAdminGate`: verified @<adminDomain> email AND
 * IAM admin), then forwards to `${IAM_URL}/v1/iam/<segment>` as the user (a
 * short-lived user-bound bearer) so IAM enforces tenant isolation from the
 * verified `owner` claim. The IAM `{status,msg,data,data2}` envelope is returned
 * verbatim with its status code.
 *
 * Least privilege: only an explicit allow-list of admin segments is reachable
 * (GET reads / POST mutations), and a non-global admin may reference ONLY their
 * own org — closing the casdoor `GetUsers(owner)` cross-tenant read gap, which is
 * NOT scoped by the caller server-side.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { getAdminGate, adminBearer, iamBaseUrl, type AdminGate } from '~/lib/server/identity'
import { ownerAllowed as policyOwnerAllowed } from '~/lib/server/admin-policy'

export const runtime = 'nodejs'

/** Read segments — reachable via GET only. */
const GET_SEGMENTS = new Set([
  'get-organizations',
  'get-organization',
  'get-users',
  'get-user',
  'get-applications',
  'get-application',
  'get-providers',
  'get-provider',
  'get-roles',
  'get-records',
])

/** Mutation segments — reachable via POST only (JSON body forwarded). */
const POST_SEGMENTS = new Set([
  'add-user',
  'update-user',
  'delete-user',
  'add-application',
  'update-application',
  'delete-application',
  'add-provider',
  'update-provider',
  'delete-provider',
])

/**
 * Organization objects are owned by casdoor's built-in `admin`, and the org
 * list/get endpoints scope results to the caller's org server-side — so `admin`
 * is an acceptable owner THERE. It is never acceptable for tenant data (users,
 * roles, ...), where the owner must be the caller's own org.
 */
const ORG_ENDPOINTS = new Set(['get-organizations', 'get-organization'])

const forbidden = () => NextResponse.json({ error: 'forbidden' }, { status: 403 })
const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 })

/** The `<owner>` in an `<owner>/<name>` id, or null. */
function idOwner(id: string | null): string | null {
  if (!id) return null
  const slash = id.indexOf('/')
  return slash > 0 ? id.slice(0, slash) : id
}

/**
 * A non-global admin may reference ONLY their own org. casdoor's read endpoints
 * (GetUsers/GetUser) do not enforce this, so the proxy must. The decision is the
 * pure `admin-policy` predicate (tested in admin-policy.test.ts); this wrapper
 * just supplies the per-segment org-metadata exception (`ORG_ENDPOINTS`).
 */
function ownerAllowed(segment: string, owner: string | null, gate: AdminGate): boolean {
  return policyOwnerAllowed(owner, {
    isGlobalAdmin: gate.user.isGlobalAdmin,
    orgScope: gate.orgScope,
    orgMetadataOk: ORG_ENDPOINTS.has(segment),
  })
}

async function forward(req: NextRequest, segment: string, allowed: Set<string>): Promise<NextResponse> {
  const gate = await getAdminGate(req)
  if (!gate) return forbidden()
  if (!allowed.has(segment)) return notFound()

  const url = req.nextUrl
  if (!ownerAllowed(segment, url.searchParams.get('owner'), gate)) return forbidden()
  if (!ownerAllowed(segment, idOwner(url.searchParams.get('id')), gate)) return forbidden()

  let bearer: string
  try {
    bearer = await adminBearer(gate.user)
  } catch (e) {
    return NextResponse.json(
      { status: 'error', msg: `Could not authorize the request: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${bearer}`, Accept: 'application/json' }
  const init: RequestInit = { method: req.method, headers, cache: 'no-store' }
  if (req.method === 'POST') {
    headers['Content-Type'] = 'application/json'
    init.body = await req.text()
  }

  try {
    const res = await fetch(`${iamBaseUrl()}/v1/iam/${segment}${url.search}`, init)
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch (e) {
    return NextResponse.json(
      { status: 'error', msg: `IAM unreachable: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path.join('/'), GET_SEGMENTS)
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path.join('/'), POST_SEGMENTS)
}
