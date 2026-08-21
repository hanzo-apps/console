/**
 * Same-origin user-bearer proxy to Visor (vm.hanzo.ai) — the compute control plane
 * (regions / gpus / machines / instances). The browser calls this OWN-origin route
 * (`/v1/vm/...`) with just its session cookie; `forwardWithUserBearer` resolves the
 * user, mints a short-lived user-bound IAM token, and forwards to visor with that
 * Bearer. Visor mints org + user from the JWT claims, so compute is org-scoped
 * server-side — a caller only ever sees their own org's machines. No token reaches
 * the browser.
 *
 * Compute is a TENANT action (any signed-in org user may list/manage their own
 * machines), so this is user-scoped (resolveUser) and visor itself authorizes the
 * forwarded user bearer. No service token, no brand-admin gate — the caller's own
 * identity is the whole authorization story.
 *
 * Least privilege on the path: only the visor `v1/*` surface is reachable
 * (`allowVisorSurface`); anything else 404s.
 */
import { type NextRequest } from 'next/server'

import { forwardWithUserBearer } from '~/lib/server/bearer-proxy'
import { allowVisorSurface } from '~/lib/server/proxy-allow'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** Visor (vm.hanzo.ai). In-cluster ClusterIP on :19000 (its Service has NO :80) — public
 *  egress is CF-403'd. Override with VISOR_URL (the CR sets visor.hanzo.svc:19000).
 *  `|| default` (not `??`): if the env is reconciled to an EMPTY string (observed drift on
 *  the live pod), `??` would keep the blank and every machines/GPUs call would fail —
 *  `|| default` treats blank/whitespace as unset so visor ALWAYS resolves. */
const VISOR_URL = trim(process.env.VISOR_URL?.trim() || 'http://visor.hanzo.svc:19000')

type Ctx = { params: Promise<{ path: string[] }> }

function handle(req: NextRequest, ctx: Ctx) {
  return (async () => {
    // This handler lives under `app/v1/vm/[...path]`, so the catch-all captures ONLY the
    // sub-path after `/v1/vm/` (e.g. `regions`). Visor serves its compute surface under
    // `/v1/<x>`, so re-root the upstream path at `v1/` — the same path `allowVisorSurface`
    // and `forwardWithUserBearer` see (`v1/regions`).
    const path = `v1/${(await ctx.params).path.join('/')}`
    return forwardWithUserBearer(req, {
      target: VISOR_URL,
      path,
      allow: allowVisorSurface,
      // Org is authoritative (Bearer owner). Don't forward browser X-Project-Id/
      // X-Environment (unvalidated sub-scopes) — RED MEDIUM.
      unauthorizedMessage: 'Sign in to manage compute.',
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
