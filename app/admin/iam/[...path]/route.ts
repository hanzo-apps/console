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

/**
 * Read routes — reachable via GET only. A listing is the bare entity and a single
 * read is `<entity>/get`, so both halves of a pair are named explicitly rather
 * than admitted by prefix: an entity opened for reading must not thereby open its
 * writes, which live under the same first segment.
 */
const GET_SEGMENTS = new Set([
  'organizations',
  'organizations/get',
  'users',
  'users/get',
  'applications',
  'applications/get',
  'providers',
  'roles',
  'audit-logs',
  // The Pending-Users board reads this. IAM serves NO approval surface — the route
  // does not exist there — so this answers 404 until one is built; see the note on
  // IamAdminApi.pendingUsers. Left listed so the board's own honest error state is
  // what a reader sees, rather than this proxy's.
  'get-pending-users',
])

/**
 * Write routes — reachable via POST only (JSON body forwarded). A create is the
 * bare entity; an update and a delete are `<entity>/update` and `<entity>/delete`.
 *
 * The org-metadata WRITES are the DATA-DRIVEN white-label backbone: a tenant IS an
 * org record, and its BRAND (logo / favicon / themeData) is a real writable IAM
 * field on that record. This is how the Tenants board CREATES a tenant and WRITES
 * its brand — no hardcoded brand map. These are safe on THIS proxy because the gate
 * is already GLOBAL-ADMIN-ONLY and `forwardIam` pins the org NAME
 * (`ORG_NAME_SEGMENTS` below) so the write is scoped — a non-global caller, who
 * cannot reach this route anyway, could never retarget another tenant's org
 * through the body `name`.
 *
 * `providers/get` and `roles/get` are single READS that IAM registers as POSTs, so
 * they belong on this side of the split. They are the entity's own read, not a
 * write, and carry no body beyond the key.
 */
const POST_SEGMENTS = new Set([
  'users',
  'users/update',
  'users/delete',
  'applications',
  'applications/update',
  'applications/delete',
  'providers',
  'providers/get',
  'providers/update',
  'providers/delete',
  'roles',
  'roles/get',
  'roles/update',
  'roles/delete',
  'organizations',
  'organizations/update',
  'organizations/delete',
  // Approve/reject a pending user. IAM serves neither — see GET_SEGMENTS.
  'approve-user',
  'reject-user',
])

/**
 * Organization rows are owned by IAM's built-in `admin` — the owner is the
 * registry the row lives in, not the tenant it describes — so `admin` is an
 * acceptable owner THERE (never for tenant data like users or roles). Every
 * organization route joins it, reads and writes alike.
 */
const ORG_ENDPOINTS = new Set([
  'organizations',
  'organizations/get',
  'organizations/update',
  'organizations/delete',
])

/**
 * Routes carrying an org NAME to guard — a non-global admin can't read or write
 * another org's settings via the `admin` metadata owner. (This route's gate is
 * already global-only, so this is defense-in-depth: it keeps the org-name scoping
 * identical to the `/org/iam` self-service proxy, one policy for both.)
 *
 * The bare `organizations` is NOT here: a listing names no org, so there is no
 * name to pin, and IAM decides that listing on the principal alone.
 */
const ORG_NAME_SEGMENTS = new Set([
  'organizations/get',
  'organizations/update',
  'organizations/delete',
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
