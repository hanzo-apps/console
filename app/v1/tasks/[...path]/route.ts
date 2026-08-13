/**
 * Same-origin proxy to the durable task engine (hanzoai/tasks `tasksd`, the native
 * Temporal-style HTTP surface at `/v1/tasks/*`).
 *
 * `tasksd` runs `TASKSD_REQUIRE_IDENTITY=true`: it validates an IAM **Bearer JWT**
 * against the IAM JWKS, unconditionally STRIPS inbound `X-Org-Id`, and mints org +
 * user from the JWT claims (`owner`→org). So — like the `/ai` proxy — the console
 * calls its OWN origin with just the session cookie; `forwardWithUserBearer`
 * resolves the signed-in user, mints a short-lived user-bound IAM token (shared
 * per-user cache), and forwards it as the Bearer. No key in the browser, and every
 * read is org-scoped by the JWT server-side.
 *
 * Rooted at `/v1/tasks/` (the /v1-first law), like `app/v1/billing` and
 * `app/v1/commerce`: MORE SPECIFIC than the cloud BFF catch-all `app/v1/[...path]`,
 * so `/v1/tasks/*` resolves here and everything else falls through. It lived at
 * `/tasksd` on the theory that a proxy at the product's own word would shadow the
 * `/tasks/*` page URLs — but they differ at the FIRST segment and never could, and
 * `/tasksd` bought a private prefix at a real cost: the one-binary console has NO
 * server routes, so `/tasksd/*` was answered there by the SPA's own index.html and
 * every read came back as HTML. At `/v1/tasks/*` the SAME client URL reaches this
 * proxy on a split console and the embedded cloud's own tasks surface in the
 * one-binary build — one address, both topologies, which is the whole point of the
 * clean `/v1/<head>` the client builds.
 *
 * READ-ONLY: only GET is proxied (the console never mutates workflows here), scoped
 * to the `v1/tasks/*` subtree. When the engine is unreachable the UI shows an honest
 * BackendStateCard — never fabricated workflows.
 */
import { type NextRequest } from 'next/server'

import { forwardWithUserBearer } from '~/lib/server/bearer-proxy'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** The durable task engine. Public TLS is not live yet → default to the in-cluster
 *  service. The tasks Service exposes REST on :7243 (http port); there is NO :80,
 *  so target :7243 explicitly. Override with TASKS_URL. `|| default` (not `??`) so a
 *  blank env still falls back to the in-cluster service. */
const TASKS_URL = trim(process.env.TASKS_URL?.trim() || 'http://tasks.hanzo.svc.cluster.local:7243')

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const rel = (await ctx.params).path.join('/')
  return forwardWithUserBearer(req, {
    target: TASKS_URL,
    path: `v1/tasks/${rel}`,
    allow: (p) => p === 'v1/tasks' || p.startsWith('v1/tasks/'),
    unauthorizedMessage: 'Sign in to view tasks.',
  })
}
