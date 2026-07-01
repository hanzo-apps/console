/**
 * Same-origin user-bearer proxy to the unified cloud-api `/v1/*` — the ONE path the
 * browser uses to reach the cloud surfaces that authorize on a Bearer JWT.
 *
 * The managed data resources (vector/sql/kv/s3/docdb/datastore/search) and the
 * serverless / prompt / agent surfaces resolve the org from the token's `owner`
 * claim and 403 a cookie-only call ("X-Org-Id required"). So — exactly like the
 * `/ai` proxy — the browser calls this OWN-origin route with just its session
 * cookie; `forwardWithUserBearer` resolves the user, mints a short-lived user-bound
 * IAM token (shared per-user cache), and forwards to cloud-api with that Bearer. No
 * credential reaches the browser, org is server-authoritative (never the browser's
 * claim), and every read/write is billed + scoped to the user's own org.
 *
 * Least privilege: only the data + serverless HEADS are reachable (`allowCloudSurface`);
 * `v1/iam/*`, `v1/admin/*`, etc. 404 here — this is not a general cloud-api tunnel.
 */
import { type NextRequest } from 'next/server'

import { forwardWithUserBearer } from '~/lib/server/bearer-proxy'
import { allowCloudSurface } from '~/lib/server/proxy-allow'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** The unified cloud backend (hanzoai/cloud). In-cluster ClusterIP — public egress is CF-403'd. */
const CLOUD_API_URL = trim(process.env.CLOUD_API_URL ?? 'http://cloud-api.hanzo.svc.cluster.local:8000')

type Ctx = { params: Promise<{ path: string[] }> }

function handle(req: NextRequest, ctx: Ctx) {
  return (async () => {
    const path = (await ctx.params).path.join('/')
    return forwardWithUserBearer(req, {
      target: CLOUD_API_URL,
      path,
      allow: allowCloudSurface,
      forwardScope: true,
      unauthorizedMessage: 'Sign in to use Hanzo Cloud.',
    })
  })()
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
