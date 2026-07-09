/**
 * GET /brand?host=<h> — PUBLIC brand resolver (the data-driven replacement for
 * the console's hardcoded BRANDS/HOST_BRANDS map).
 *
 * Forwards to the platform's `GET /v1/brand?host=` (which resolves the brand for
 * a host from DATA: whitelabel_domain + organization + org_brand) and returns
 * ONLY the public brand-display fields the login/shell need:
 * `{ org, brandName, logoUrl, faviconUrl, iamUrl, iamApp, iamOrgName, accentColor }`.
 *
 * PUBLIC by design (unlike the admin-gated /paas proxy): brand name/logo/accent
 * are what an UNauthenticated first-paint / login page shows, so this must resolve
 * before any session exists. It carries NO secret to the browser — the platform
 * service token stays server-side, and the response is public brand metadata only
 * (never IAM secrets, never per-tenant data). Read-only (GET); a mutation is a 405.
 *
 * Cached briefly at the edge — brand config changes rarely and a stale value is
 * harmless (worst case a slightly-old logo until the next resolve).
 */
import { type NextRequest, NextResponse } from 'next/server'

import { fetchWithTimeout } from '~/lib/server/fetch-timeout'

export const runtime = 'nodejs'

const PLATFORM_URL = (process.env.PLATFORM_URL ?? 'https://platform.hanzo.ai').replace(/\/+$/, '')
const TOKEN = process.env.PAAS_SERVICE_TOKEN ?? ''

/** Only the public brand-display fields — never forward anything else. */
function publicBrand(raw: unknown): Record<string, string> {
  const r = (raw ?? {}) as Record<string, unknown>
  const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
  const out: Record<string, string> = {}
  const org = s(r.org) ?? s(r.iamOrgName)
  if (!org) return {} // no record → empty (client falls back to its build-time default)
  out.org = org
  const put = (k: string, v: string | undefined) => {
    if (v) out[k] = v
  }
  put('brandName', s(r.brandName))
  put('logoUrl', s(r.logoUrl))
  put('faviconUrl', s(r.faviconUrl))
  put('iamUrl', s(r.iamUrl))
  put('iamApp', s(r.iamApp))
  put('iamOrgName', s(r.iamOrgName) ?? org)
  put('accentColor', s(r.accentColor))
  return out
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const host = req.nextUrl.searchParams.get('host')
  if (!host) {
    return NextResponse.json({ error: 'missing host' }, { status: 400 })
  }
  if (!TOKEN) {
    // Not configured → honest empty (the client falls back to its default map).
    return NextResponse.json({}, { status: 200 })
  }
  const url = `${PLATFORM_URL}/v1/brand?host=${encodeURIComponent(host)}`
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })
    if (!res.ok) {
      // Upstream miss/error → honest empty; never break first paint.
      return NextResponse.json({}, { status: 200 })
    }
    const body = await res.json().catch(() => ({}))
    return NextResponse.json(publicBrand(body), {
      status: 200,
      // Brand config is public + slow-changing; let the edge cache it briefly.
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
    })
  } catch {
    return NextResponse.json({}, { status: 200 })
  }
}
