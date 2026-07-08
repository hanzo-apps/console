/**
 * Server-gated GLOBAL IAM admin proxy — cross-tenant IAM ops (any org).
 *
 * The browser holds no IAM credential. It calls this SAME-ORIGIN route with just
 * its session cookie; the handler enforces the GLOBAL admin gate (`getAdminGate`:
 * verified @<adminDomain> email AND a global-admin flag), then the shared
 * `forwardIam` applies the allow-list + tenant scoping (a global admin may act on
 * any org) and forwards to IAM as the user. A CUSTOMER managing their OWN org uses
 * `/org/iam` instead — this route is global-only.
 *
 * Least privilege: only an explicit allow-list of admin segments is reachable
 * (GET reads / POST mutations); every owner the request references — including
 * the mutation BODY owner — is validated by `forwardIam`.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { getAdminGate } from '~/lib/server/identity'
import { forwardIam } from '~/lib/server/iam-proxy'

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
  // Waitlist approval queue (iam#104) — the Pending-Users board reads this. The
  // /admin/iam gate is already global-admin-only, matching IAM's own
  // GetPendingUsers auth (global admin or org admin). REUSED, not rebuilt.
  'get-pending-users',
])

/**
 * Mutation segments — reachable via POST only (JSON body forwarded).
 *
 * The org-metadata WRITES (`add-organization`/`update-organization`/`delete-organization`)
 * are the DATA-DRIVEN white-label backbone: a tenant IS an org record, and its BRAND
 * (logo / favicon / themeData) is a real writable IAM field on that record. This is
 * how the Tenants board CREATES a tenant and WRITES its brand — no hardcoded brand map.
 * These are safe on THIS proxy because the gate is already GLOBAL-ADMIN-ONLY and
 * `forwardIam` pins the org NAME (`orgNameSegments` below) so the write is scoped
 * (a non-global caller — who can't reach this route anyway — could never retarget
 * another tenant's org via the id or the body `name`).
 */
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
  'add-role',
  'update-role',
  'delete-role',
  'add-organization',
  'update-organization',
  'delete-organization',
  // Waitlist approval actions (iam#104) — approve/reject a pending user. Body is
  // `{id:"owner/name"}`; the global-admin gate + forwardIam's owner scoping apply.
  'approve-user',
  'reject-user',
])

/**
 * Organization objects are owned by IAM's built-in `admin`, and the org
 * list/get endpoints scope results to the caller's org server-side — so `admin`
 * is an acceptable owner THERE (never for tenant data like users/roles). The
 * org-metadata WRITES join it: they operate on the `admin`-owned org record.
 */
const ORG_ENDPOINTS = new Set([
  'get-organizations',
  'get-organization',
  'add-organization',
  'update-organization',
  'delete-organization',
])

/**
 * Segments carrying an org NAME to guard — a non-global admin can't read/write
 * another org's settings via the `admin` metadata owner. (This route's gate is
 * already global-only, so this is defense-in-depth: it keeps the org-name scoping
 * identical to the `/org/iam` self-service proxy, one policy for both.)
 */
const ORG_NAME_SEGMENTS = new Set([
  'get-organization',
  'update-organization',
  'delete-organization',
])

const forbidden = () => NextResponse.json({ error: 'forbidden' }, { status: 403 })

async function handle(req: NextRequest, path: string[], method: 'GET' | 'POST'): Promise<NextResponse> {
  const gate = await getAdminGate(req)
  if (!gate) return forbidden()
  return forwardIam(
    req,
    { user: gate.user, isSuperAdmin: gate.user.isSuperAdmin, orgScope: gate.orgScope },
    {
      segment: path.join('/'),
      method,
      allowed: method === 'GET' ? GET_SEGMENTS : POST_SEGMENTS,
      orgMetaSegments: ORG_ENDPOINTS,
      orgNameSegments: ORG_NAME_SEGMENTS,
      // The gate is already global-only; global admins may write to any org.
      requireAdminForWrite: false,
    },
  )
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path, 'GET')
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path, 'POST')
}
