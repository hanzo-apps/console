/**
 * Same-origin user-bearer proxy at the console's OWN `/v1/*` — the ONE prefix-free
 * path the browser uses to reach the unified cloud-api surfaces that authorize on a
 * Bearer JWT. CTO contract: every cloud API path is `/v1/`-rooted, ZERO prefix (no
 * `/cloud/`, no `/api/`).
 *
 * The browser holds NO credential: it calls `<origin>/v1/<head>/...` with just its
 * first-party session cookie. This catch-all resolves WHO the caller is from that
 * cookie (`resolveUser`), mints a SHORT-LIVED, user-bound IAM token (shared per-user
 * cache in identity.ts — ONE cache across every proxy), and forwards to cloud-api's
 * `/v1/*` with `Authorization: Bearer <token>`. The backend resolves the ORG from the
 * token's `owner` claim, so tenancy is server-authoritative — a browser can never
 * supply its own org — and the raw session cookie NEVER reaches cloud-api (no
 * cookie-CSRF surface upstream). This is the EXACT transport the `/ai` proxy proved
 * live; every service proxy shares the ONE `forwardWithUserBearer` implementation.
 *
 * DISPATCH: the AI inference heads (`models`/`chat`/…) and the admin aggregate
 * (`/v1/admin/*`) are routed to their OWN backends by `next.config.mjs` `beforeFiles`
 * rewrites BEFORE they reach this catch-all; visor (`/v1/vm/*`), billing
 * (`/v1/billing/*`) and commerce (`/v1/commerce/*`) are filesystem routes more specific
 * than this one. So this handler owns exactly the cloud-api `/v1/*` surface.
 *
 * Least privilege: only the allow-listed cloud HEADS are reachable
 * (`allowCloudSurface`); `v1/iam/*`, `v1/admin/*`, etc. 404 here — this is not a
 * general cloud-api tunnel. The mutating same-origin (CSRF) guard, the path-traversal
 * rejection, and the bearer mint all live in `forwardWithUserBearer`.
 */
import { type NextRequest } from 'next/server'

import { forwardWithUserBearer } from '~/lib/server/bearer-proxy'
import { allowCloudSurface } from '~/lib/server/proxy-allow'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** The unified cloud backend (hanzoai/cloud). In-cluster ClusterIP — public egress is CF-403'd.
 *  `|| default` (not `??`) so an env accidentally reconciled to an EMPTY string still falls
 *  back to the in-cluster service (a blank CLOUD_API_URL would otherwise break every cloud page). */
const CLOUD_API_URL = trim(process.env.CLOUD_API_URL?.trim() || 'http://cloud-api.hanzo.svc.cluster.local:8000')

type Ctx = { params: Promise<{ path: string[] }> }

function handle(req: NextRequest, ctx: Ctx) {
  return (async () => {
    // The `[...path]` catch-all sits UNDER `/v1`, so it captures the segments AFTER
    // `/v1`. Re-prepend the `v1/` root so the allow-list (matches `v1/<head>`) and the
    // upstream URL (`CLOUD_API_URL/v1/<head>/...`) both see the cloud-api contract path.
    const path = `v1/${(await ctx.params).path.join('/')}`
    return forwardWithUserBearer(req, {
      target: CLOUD_API_URL,
      path,
      allow: allowCloudSurface,
      // Org is authoritative (Bearer owner). Do NOT forward the browser-controlled
      // X-Project-Id/X-Environment sub-scopes — the data/serverless resources are
      // org-keyed, and forwarding an unvalidated project id is an attack surface
      // (RED MEDIUM). A project-scoped feature must validate membership first.
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
