/**
 * Server-gated SELF-SERVICE org member proxy — a CUSTOMER managing their OWN org.
 *
 * The `/admin/iam` proxy is GLOBAL-admin only, so a tenant org owner (e.g.
 * Dave/maxpower) could never manage their own members through it. This proxy
 * closes that: it admits ANY authenticated user with an org (`getOrgGate`), then
 * the shared `forwardIam`:
 *   - scopes every reference (query `owner`, `id` owner, and the mutation BODY
 *     owner) to the caller's OWN org — a global admin may cross, a customer never;
 *   - guards get-organization by org NAME (no reading another org's settings);
 *   - requires an ORG ADMIN for writes (invite / change-role / remove), while any
 *     member may READ the roster.
 * IAM enforces its own checks on the user-bound bearer too — this is the matching,
 * fail-closed server gate, not the only one.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { getOrgGate } from '~/lib/server/identity'
import { forwardIam } from '~/lib/server/iam-proxy'

export const runtime = 'nodejs'

/** Reads — any member of the org (own org only, unless global). */
const GET_SEGMENTS = new Set([
  'get-users',
  'get-user',
  'get-roles',
  'get-organization',
  // Projects live under the org (IAM-served); the console host's /v1 sends /v1/iam/*
  // to the cloud binary → 404, so the Projects page routes here (Bearer → IAM).
  'get-organization-projects',
])

/** Writes — org admin only, own org only (unless global). */
const POST_SEGMENTS = new Set([
  'add-user',
  'update-user',
  'delete-user',
  // Project CRUD — org-admin only (requireAdminForWrite), pinned to the caller's org.
  'add-project',
  'delete-project',
])

/** get-organization's owner is the `admin` metadata org (name guarded separately). */
const ORG_META = new Set(['get-organization'])
/** Segments carrying an org NAME to pin to the caller's scope. */
const ORG_NAME = new Set(['get-organization'])

const forbidden = () => NextResponse.json({ error: 'forbidden' }, { status: 403 })

async function handle(req: NextRequest, path: string[], method: 'GET' | 'POST'): Promise<NextResponse> {
  const gate = await getOrgGate(req)
  if (!gate) return forbidden()
  return forwardIam(req, gate, {
    segment: path.join('/'),
    method,
    allowed: method === 'GET' ? GET_SEGMENTS : POST_SEGMENTS,
    orgMetaSegments: ORG_META,
    orgNameSegments: ORG_NAME,
    requireAdminForWrite: true,
  })
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path, 'GET')
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path, 'POST')
}
