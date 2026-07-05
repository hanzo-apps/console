/**
 * Per-tenant billing DATA proxy → commerce. Thin route wrapper: the trust boundary,
 * tenant scoping, CSRF guard, and binary (PDF) passthrough all live in the tested
 * `~/lib/server/billing-proxy` (`forwardBilling`) — this file only maps the HTTP verbs.
 *
 * Namespaced under `/billing/v1/` (NOT bare `/billing/`) so the data plane never
 * shadows the billing UI tab URLs (`/billing/reports`, `/billing/invoices`, …): a
 * route handler always wins over the catch-all page for a matching path segment, so
 * the tab slugs and the data endpoints live in disjoint path space.
 *
 * Verbs: GET (reads: balance/usage/invoices/subscriptions/payment-methods, and the
 * per-invoice PDF), POST (writes: top-up, spend-alerts, save-a-method, cancel/
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
