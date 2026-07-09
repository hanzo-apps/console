/**
 * Server-gated GLOBAL-admin proxy for the commerce SaaS-operations god-view
 * (`GET /v1/metrics/saas`) — the cross-tenant revenue / subscription / customer
 * snapshot computed IN commerce (the money system of record). This is the exact
 * console→commerce pattern commerce's own `api/costs` gate documents: the console's
 * OWN global-admin gate runs FIRST, then it forwards with the `COMMERCE_SERVICE_TOKEN`
 * and NO user identity — commerce's `RequirePlatformAdmin` admits that trusted M2M
 * token (Admin bit, empty Subject) for the fleet god-view.
 *
 * Gated fail-closed BEFORE any cross-tenant row is read: `getAdminGate` requires a
 * VERIFIED `@<brand.adminDomain>` email AND an IAM global-admin flag (the SAME gate
 * the IAM/KMS/aggregate admin proxies use), → 403 on any miss. A tenant customer —
 * even one who is `isAdmin` of their OWN org — can never read another org's revenue.
 * The client-side `admin: true` nav gate + module `OperatorAccessRequired` are
 * UI-only defense-in-depth; this server gate is the boundary.
 *
 * The path is FIXED (`/v1/metrics/saas`) — there is no client-controlled path
 * segment, so no traversal surface. Only the allow-listed `window`/`limit` query
 * params are forwarded (validated here), never the raw query string. The commerce
 * SERVICE token comes from server-only env (never `NEXT_PUBLIC_`, never the browser
 * bundle); unset → honest 501 (the board shows "not configured", never a fabricated
 * MRR). The commerce raw JSON is wrapped in the casibase `{status,msg,data}`
 * envelope the admin client (`originGet`) unwraps.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { getAdminGate } from '~/lib/server/identity'
import { commerceBaseUrl, commerceServiceToken } from '~/lib/server/billing-proxy'
import { fetchWithTimeout } from '~/lib/server/fetch-timeout'

export const runtime = 'nodejs'

/** The commerce SaaS god-view — the internal `/v1` bundle path (cloud/costs siblings
 *  live here too), reached directly at the in-cluster commerce address. */
const METRICS_PATH = '/v1/metrics/saas'

/** The windows commerce accepts; anything else is dropped (commerce defaults 30d). */
const WINDOWS = new Set(['7d', '30d', '90d', 'mtd', 'all'])

const NO_STORE = 'no-store, must-revalidate'
const envelope = (msg: string, status: number) =>
  NextResponse.json({ status: 'error', msg, data: null }, { status, headers: { 'Cache-Control': NO_STORE } })

export async function GET(req: NextRequest): Promise<NextResponse> {
  // AUTHORIZE FIRST — global-admin only, fail-closed. A non-global-admin never
  // triggers the cross-tenant commerce walk.
  const gate = await getAdminGate(req)
  if (!gate) return envelope('forbidden', 403)

  const token = commerceServiceToken()
  if (!token) return envelope('SaaS metrics are not configured (COMMERCE_TOKEN missing).', 501)

  // Forward ONLY the allow-listed, validated params — never the raw query string.
  const q = new URLSearchParams()
  const window = (req.nextUrl.searchParams.get('window') ?? '').trim()
  if (WINDOWS.has(window)) q.set('window', window)
  const limit = Number(req.nextUrl.searchParams.get('limit'))
  if (Number.isInteger(limit) && limit > 0 && limit <= 200) q.set('limit', String(limit))

  const url = `${commerceBaseUrl()}${METRICS_PATH}${q.toString() ? `?${q}` : ''}`
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: req.signal,
    })
    if (!res.ok) {
      // Forward commerce's status class as an honest error; the board shows the
      // failure state (never a fabricated snapshot).
      return envelope(`SaaS metrics upstream returned ${res.status}.`, res.status === 403 ? 403 : 502)
    }
    const data = await res.json()
    return NextResponse.json({ status: 'ok', msg: '', data }, { headers: { 'Cache-Control': NO_STORE } })
  } catch (e) {
    // Redact the exception (it carries the internal commerce host/port) — log
    // server-side only; return a generic client message.
    console.error('saas-metrics proxy: upstream unreachable:', commerceBaseUrl(), e instanceof Error ? e.message : String(e))
    return envelope('SaaS metrics upstream is unavailable.', 502)
  }
}
