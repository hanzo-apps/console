/**
 * Same-origin READ-ONLY proxy to VictoriaMetrics — the live platform telemetry
 * store (Prometheus-compatible TSDB, `vmsingle-victoria-metrics-single-server`).
 *
 * The browser calls this OWN-origin route (`/telemetry/api/v1/query?query=up`) with
 * just its first-party session cookie; this handler resolves the caller
 * (`resolveUser`) and — only for a signed-in user — forwards the READ query to
 * VictoriaMetrics. It powers Status (real `up{}` service health) and Metrics (real
 * infra time-series), replacing the empty `/paas/apps` board and the unwired
 * Metrics overview. VictoriaMetrics has no per-request auth of its own (it is an
 * internal ClusterIP service), so this route IS the access boundary — hence three
 * hard limits, all fail-closed:
 *
 *   1. Authenticated only — `resolveUser` (401 otherwise). Platform status/metrics
 *      is not tenant-customer data; it is the health of the Hanzo Cloud platform the
 *      user is signed into (a status-page concern), appropriate for any signed-in
 *      console user and strictly READ-ONLY — no service token, far weaker than the
 *      admin `/paas` control plane.
 *   2. READ-only — GET only, and only the allow-listed VictoriaMetrics query
 *      endpoints (`allowTelemetrySurface`): `/api/v1/query`, `/query_range`,
 *      `/series`, `/labels`, `/label/<name>/values`, `/status/tsdb`, `/metadata`.
 *      Never `/api/v1/write`, `/import`, `/-/reload`, or any admin/mutating path.
 *   3. Traversal-hardened — `pathIsClean` rejects `.`/`..`/`%XX`/`;` segments and the
 *      forward re-validates the WHATWG-normalized path, exactly like the bearer
 *      proxies.
 *
 * Honest 501 when `VM_URL` is unset, so the UI shows a truthful "telemetry not
 * configured" state — never fabricated metrics.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser } from '~/lib/server/identity'
import { pathIsClean } from '~/lib/server/bearer-proxy'
import { allowTelemetrySurface } from '~/lib/server/proxy-allow'
import { fetchWithTimeout } from '~/lib/server/fetch-timeout'

export const runtime = 'nodejs'

const trimR = (s: string) => s.replace(/\/+$/, '')
const trimL = (s: string) => s.replace(/^\/+/, '')
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** VictoriaMetrics single-node read API. In-cluster ClusterIP :8428 (headless).
 *  Override with VM_URL. `|| default` (not `??`) so a blank/whitespace env still
 *  resolves the in-cluster service (the same env-drift guard the /vm proxy uses). */
const VM_URL = trimR(
  process.env.VM_URL?.trim() || 'http://vmsingle-victoria-metrics-single-server.hanzo.svc:8428',
)

const json = (body: unknown, status: number) => NextResponse.json(body, { status })

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const rawPath = trimL((await ctx.params).path.join('/')).replace(/\/+$/, '')

  // Traversal + least-privilege on the RAW path (literal `.`/`..`/`%XX`/`;` rejected).
  if (!pathIsClean(rawPath) || !allowTelemetrySurface(rawPath)) {
    return json({ status: 'error', errorType: 'not_allowed', error: 'Not a telemetry read endpoint.' }, 404)
  }

  if (!process.env.VM_URL?.trim() && !VM_URL) {
    return json(
      { status: 'error', errorType: 'not_configured', error: 'Telemetry store is not configured (VM_URL missing).' },
      501,
    )
  }

  // Authenticated only — the query surface is the access boundary (VM has no auth).
  const user = await resolveUser(req)
  if (!user) {
    return json({ status: 'error', errorType: 'unauthenticated', error: 'Sign in to view platform telemetry.' }, 401)
  }

  // Re-validate the WHATWG-normalized destination (undici resolves %2e/double-encoded
  // dot-segments a raw check can't see) — validate AND fetch the exact same URL.
  let dest: URL
  try {
    dest = new URL(`${VM_URL}/${rawPath}${req.nextUrl.search}`)
  } catch {
    return json({ status: 'error', errorType: 'not_allowed', error: 'Bad telemetry path.' }, 404)
  }
  const normPath = trimL(dest.pathname).replace(/\/+$/, '')
  if (!pathIsClean(normPath) || !allowTelemetrySurface(normPath)) {
    return json({ status: 'error', errorType: 'not_allowed', error: 'Not a telemetry read endpoint.' }, 404)
  }

  try {
    const res = await fetchWithTimeout(dest, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: req.signal,
    })
    return new NextResponse(res.body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-cache, no-transform',
      },
    })
  } catch (e) {
    console.error('telemetry-proxy: VictoriaMetrics unreachable:', msgOf(e))
    return json({ status: 'error', errorType: 'upstream_error', error: 'Telemetry store is unavailable.' }, 502)
  }
}
