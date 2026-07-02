/**
 * Embed status — is a brand's embedded app (Content Studio / ERP / Help Center)
 * provisioned and reachable, so the console can decide embed-vs-provision-CTA?
 *
 * The console embeds these REAL apps over the brand's own IAM SSO (never a
 * fabricated surface). A cross-origin browser can't read another origin's status
 * (SOP + CORS), so this SERVER route probes it once and returns an honest verdict:
 * `reachable:false` while an app is 502/unrouted, so the module shows the truthful
 * "not available / deploy" state instead of framing an error page.
 *
 * NO god-mode: unlike `/paas` (which forwards the control-plane service token and
 * is admin-gated), this route holds NO privileged credential. It resolves the
 * app's brand ORIGIN from the request host CLAMPED to the known brand domains
 * (`embed-probe.ts`, unit-tested) — so a forged Host header can never steer it into
 * an SSRF probe of an arbitrary host — and does a plain, time-boxed reachability
 * check. Session-gated so it is not an open relay. The exact origin + deep-link it
 * probed/derived are RETURNED, and the module embeds precisely that.
 *
 *   GET /embed-status?app=cms|erp|help → { app, origin, embedUrl, reachable, phase }
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser } from '~/lib/server/identity'
import { embedTarget, embedOrigin, isEmbedApp, isUp, brandOrgForHost, isEntitled } from '~/lib/server/embed-probe'

export const runtime = 'nodejs'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await resolveUser(req)
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })

  const appParam = (req.nextUrl.searchParams.get('app') ?? '').trim().toLowerCase()
  if (!isEmbedApp(appParam)) {
    return NextResponse.json({ error: 'Unknown embed app.' }, { status: 400 })
  }
  const host = req.headers.get('host')
  const { origin, embedUrl } = embedTarget(appParam, host)

  // SERVER-SIDE entitlement gate: these apps are single shared per-BRAND instances,
  // so only the owning brand org (or a global admin) may frame them. The org is the
  // TOKEN OWNER (server-resolved, never a browser claim). A non-entitled caller
  // NEVER receives the embed URL and we don't even probe — the module shows the
  // honest provision panel. This is the authoritative gate; the client check is only
  // to avoid a flash.
  const brandOrg = brandOrgForHost(host)
  if (!isEntitled(appParam, user.owner, brandOrg, user.isGlobalAdmin)) {
    return NextResponse.json(
      { app: appParam, origin, embedUrl: '', reachable: false, entitled: false, phase: 'not-entitled' },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  let up = false
  try {
    // Time-boxed reachability probe of the origin root. `redirect: 'manual'` so an
    // SSO 302 counts as "up" (we don't follow it — only need the liveness signal).
    const res = await fetch(embedOrigin(appParam, host), {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(4500),
      headers: { Accept: 'text/html' },
    })
    up = isUp(res.status)
  } catch {
    up = false // DNS failure / connection refused / timeout → not provisioned yet.
  }

  return NextResponse.json(
    { app: appParam, origin, embedUrl, reachable: up, entitled: true, phase: up ? 'ready' : 'not-provisioned' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
