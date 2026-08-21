/**
 * The org's own postings, signed — `GET /v1/billing/ledger?range=`.
 *
 * A static route, so it wins over the sibling `[...path]` catch-all for this exact path,
 * and it must: the catch-all forwards `/v1/billing/*` to commerce with the service token,
 * and commerce does not answer this one. The ledger is cloud's own typed op — it PROJECTS
 * commerce's wallet rather than holding a second one — so it is read from cloud with the
 * caller's short-lived user bearer, org resolved from the token owner. Same wallet, same
 * subject pinning, one hop fewer, and no commerce credential in the path.
 *
 * It answered at `/v1/finance/ledger` until the five addresses beside it were deleted
 * rather than moved; the shape is unchanged, so `@hanzo/finance-ui` reads it as it stands.
 */
import { type NextRequest } from 'next/server'

import { forwardWithUserBearer } from '~/lib/server/bearer-proxy'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** The unified cloud backend (hanzoai/cloud) — same in-cluster target as the `/v1` proxy. */
const CLOUD_API_URL = trim(process.env.CLOUD_API_URL?.trim() || 'http://cloud-api.hanzo.svc.cluster.local:8000')

const UPSTREAM_PATH = 'v1/billing/ledger'

export async function GET(req: NextRequest) {
  return forwardWithUserBearer(req, {
    target: CLOUD_API_URL,
    path: UPSTREAM_PATH,
    allow: (p) => p === UPSTREAM_PATH,
    unauthorizedMessage: 'Sign in to read your billing ledger.',
  })
}
