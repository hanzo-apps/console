/**
 * Same-origin user-bearer proxy to Visor (vm.hanzo.ai) — the compute control plane
 * (regions / gpus / machines / instances). The browser calls this OWN-origin route
 * (`/vm/v1/...`) with just its session cookie; `forwardWithUserBearer` resolves the
 * user, mints a short-lived user-bound IAM token, and forwards to visor with that
 * Bearer. Visor mints org + user from the JWT claims, so compute is org-scoped
 * server-side — a caller only ever sees their own org's machines. No token reaches
 * the browser.
 *
 * NOT the `/paas` pattern: `/paas` forwards a god-mode control-plane SERVICE token
 * and is gated to brand admins. Compute is a TENANT action (any signed-in org user
 * may list/manage their own machines), so this is user-scoped (resolveUser), and
 * visor itself authorizes the forwarded user bearer.
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
 *  egress is CF-403'd. Override with VISOR_URL (the CR sets visor.hanzo.svc:19000). */
const VISOR_URL = trim(process.env.VISOR_URL ?? 'http://visor.hanzo.svc:19000')

type Ctx = { params: Promise<{ path: string[] }> }

function handle(req: NextRequest, ctx: Ctx) {
  return (async () => {
    const path = (await ctx.params).path.join('/')
    return forwardWithUserBearer(req, {
      target: VISOR_URL,
      path,
      allow: allowVisorSurface,
      forwardScope: true,
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
