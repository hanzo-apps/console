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
 * Organization objects are owned by IAM's built-in `admin`, and the org
 * list/get endpoints scope results to the caller's org server-side — so `admin`
 * is an acceptable owner THERE (never for tenant data like users/roles).
 */
const ORG_ENDPOINTS = new Set(['get-organizations', 'get-organization'])

const forbidden = () => NextResponse.json({ error: 'forbidden' }, { status: 403 })

async function handle(req: NextRequest, path: string[], method: 'GET' | 'POST'): Promise<NextResponse> {
  const gate = await getAdminGate(req)
  if (!gate) return forbidden()
  return forwardIam(
    req,
    { user: gate.user, isGlobalAdmin: gate.user.isGlobalAdmin, orgScope: gate.orgScope },
    {
      segment: path.join('/'),
      method,
      allowed: method === 'GET' ? GET_SEGMENTS : POST_SEGMENTS,
      orgMetaSegments: ORG_ENDPOINTS,
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
