/**
 * Per-tenant billing DATA proxy → commerce. Thin route wrapper: the trust boundary,
 * tenant scoping, CSRF guard, and binary (PDF) passthrough all live in the tested
 * `~/lib/server/billing-proxy` (`forwardBilling`) — this file only maps the HTTP verbs.
 *
 * Rooted at `/v1/billing/` (the /v1-first law) — this handler lives at
 * `app/v1/billing/[...path]`, MORE SPECIFIC than the cloud BFF catch-all
 * `app/v1/[...path]`, so `/v1/billing/*` (data) resolves here while `/v1/<other>/*`
 * falls through to the catch-all. And `/v1/billing/*` (data) never collides with the
 * billing UI tab URLs (`/billing/reports`, `/billing/invoices`, …) — they differ at
 * the FIRST path segment, so the tab slugs fall through to the SPA.
 *
 * Verbs: GET (reads: balance/usage/invoices/subscriptions/methods, and the
 * per-invoice PDF), POST (writes: top-up, alerts, save-a-method, cancel/
 * reactivate a subscription), PATCH (edit a budget/spend-alert), DELETE (detach a
 * saved payment method, remove a budget). Each is scoped to the caller's OWN org
 * server-side; a mutating verb is CSRF-guarded (`forwardBilling`).
 */
import { type NextRequest } from 'next/server'

import { forwardBilling } from '~/lib/server/billing-proxy'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return forwardBilling(req, (await ctx.params).path)
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return forwardBilling(req, (await ctx.params).path)
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return forwardBilling(req, (await ctx.params).path)
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return forwardBilling(req, (await ctx.params).path)
}
