/**
 * forwardBilling — the per-tenant billing DATA proxy → commerce, extracted here (in
 * `src/lib/server`, the `bearer-proxy.ts` pattern) so the tenant-scoping + binary
 * passthrough it enforces are unit-tested directly, without importing the `app/`
 * route. The route handler (`app/billing/v1/[...path]/route.ts`) is a thin wrapper
 * that calls this for GET / POST / DELETE.
 *
 * The browser calls console2's OWN origin (`/billing/v1/...`); this forwards to
 * commerce's `/v1/billing/...`, injecting the commerce SERVICE token from server-only
 * env (never `NEXT_PUBLIC_`, never in the browser bundle) AND scoping every request to
 * the caller's OWN org:
 *   - the org is resolved server-side from the validated session (`resolveUser`) and
 *     stamped as `X-Org-Id` (commerce's service-token path reads this —
 *     `commerce/middleware/accesstoken.go`),
 *   - the server-resolved billing subject is pinned onto the FULL commerce subject-key
 *     set (`user`/`userId`/`customerId`, via `scopedBillingSearch`) while `?org=` is
 *     dropped, and onto a WRITE body (`scopedBillingBody`),
 * so the client CANNOT widen scope: a forged `?userId=`/`?customerId=`/`?org=` (or the
 * same in a JSON body) is overwritten, and because EVERY subject param is pinned, no
 * billing endpoint is left unfiltered regardless of which one it reads. No session → 401.
 *
 * CSRF: a mutating write authenticates from the auto-sent cookie, so a cross-origin
 * POST/DELETE is refused (`csrfRefusal`) before any work (safe reads pass).
 *
 * Binary passthrough: a non-JSON/text upstream (e.g. an invoice PDF,
 * `application/pdf`) is streamed through as RAW BYTES with its `Content-Type` +
 * `Content-Disposition` forwarded — reading it as `text()` would corrupt it. The PDF
 * GET is tenant-scoped exactly like every other GET (it flows through the same
 * session-auth + `X-Org-Id` + `scopedBillingSearch` path; commerce also 404s a foreign
 * invoice id, defense in depth).
 *
 * `COMMERCE_TOKEN` unset → honest 501 (the UI shows a truthful "not configured" state;
 * it never fabricates a balance).
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser } from './identity'
import { billingSubject, scopedBillingSearch, scopedBillingBody } from './billing-scope'
import { csrfRefusal } from './bearer-proxy'
import { fetchWithTimeout } from './fetch-timeout'

const isSafeSegment = (s: string): boolean =>
  s.length > 0 && s !== '.' && s !== '..' && !s.includes('/') && !s.includes('\\') && !s.includes('\0')

function commerceBaseUrl(): string {
  return (process.env.COMMERCE_URL ?? 'http://commerce.hanzo.svc:8001').replace(/\/+$/, '')
}

/**
 * True when an upstream `Content-Type` is JSON or text — safe to read as `text()`.
 * Everything else (application/pdf, octet-stream, images, …) is BINARY and MUST be
 * passed through as raw bytes, never `text()`-decoded (which mangles the bytes on a
 * lossy UTF-8 round-trip). An absent/empty header defaults to JSON (textual) — the
 * same default `res.headers.get('content-type') ?? 'application/json'` the response
 * builder uses. Pure — unit-tested.
 */
export function isTextualContentType(contentType: string): boolean {
  const ct = contentType.trim().toLowerCase()
  if (ct === '') return true
  return (
    ct.startsWith('text/') ||
    ct.includes('application/json') ||
    ct.includes('+json') ||
    ct.includes('application/xml') ||
    ct.includes('+xml') ||
    ct.includes('application/javascript') ||
    ct.includes('application/x-www-form-urlencoded')
  )
}

/** The no-store cache headers every per-tenant money response carries. */
const NO_STORE = 'no-store, must-revalidate'

export async function forwardBilling(req: NextRequest, path: string[]): Promise<NextResponse> {
  // CSRF: a mutating billing write (create/detach a method, cancel a subscription,
  // spend-alert/top-up) authenticates from the auto-sent cookie, so refuse a
  // cross-origin one before any work (safe reads pass).
  const csrf = csrfRefusal(req)
  if (csrf) return csrf

  // Per-tenant authz: any valid session may see/act on ITS OWN billing (no admin gate).
  const user = await resolveUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Sign in to view billing.' }, { status: 401 })
  }
  if (!path.every(isSafeSegment)) {
    return NextResponse.json({ error: 'Invalid billing path.' }, { status: 400 })
  }

  const token = process.env.COMMERCE_TOKEN ?? process.env.COMMERCE_SERVICE_TOKEN ?? ''
  if (!token) {
    return NextResponse.json({ error: 'Billing is not configured (COMMERCE_TOKEN missing).' }, { status: 501 })
  }

  // Scope to the caller's OWN org — server-resolved, never client-supplied.
  const org = user.owner.trim()
  const subject = billingSubject(org, user.name)

  // Pin the FULL billing-subject key set to the server-resolved subject, and strip
  // `org`, so the browser can never read another tenant's ledger (subscriptions filter
  // `userId`, payment-methods `customerId`, usage `user` — pinning only one leaves the
  // rest unfiltered). Mirrors commerce's own `billingSubjectKeys`.
  const qs = scopedBillingSearch(req.nextUrl.search, subject)
  const url = `${commerceBaseUrl()}/v1/billing/${path.join('/')}${qs ? `?${qs}` : ''}`

  const init: RequestInit = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${token}`,
      // Commerce resolves the tenant namespace from `X-Org-Id` on the service-token
      // path; it does NOT read `X-Hanzo-Org`. Send `X-Org-Id`, matching the `/ai` proxy.
      'X-Org-Id': org,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    cache: 'no-store',
    signal: req.signal,
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // Scope the WRITE body to the caller's OWN subject too (not just the query). Only
    // set a body when the request actually carries one — a bodyless DELETE/POST sends
    // none (never an empty-string body).
    const raw = await req.text()
    if (raw) init.body = scopedBillingBody(raw, subject)
  }

  try {
    const res = await fetchWithTimeout(url, init)
    const contentType = res.headers.get('content-type') ?? 'application/json'

    if (!isTextualContentType(contentType)) {
      // Binary (e.g. an invoice PDF) — pass the RAW bytes through unmodified. Forward
      // Content-Type + Content-Disposition so the browser opens/saves it correctly.
      // Invoice PDFs are small; buffering is bounded and keeps the read within the
      // timeout. Still tenant-scoped: this GET used the SAME auth + X-Org-Id +
      // scopedBillingSearch path above; the status flows through verbatim.
      const bytes = await res.arrayBuffer()
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Cache-Control': NO_STORE,
      }
      const disposition = res.headers.get('content-disposition')
      if (disposition) headers['Content-Disposition'] = disposition
      return new NextResponse(bytes, { status: res.status, headers })
    }

    // JSON / text — read as text, forward verbatim. An empty body is passed as `null`
    // (not `''`) so a no-content DELETE (204) doesn't trip undici's "204 cannot have a
    // body" guard — the detach verb returns 204 with no payload.
    const text = await res.text()
    return new NextResponse(text.length === 0 ? null : text, {
      status: res.status,
      headers: {
        'Content-Type': contentType,
        // A per-tenant money response must NEVER be cached by the browser or any
        // intermediary — otherwise the wallet shows a stale number after a top-up.
        'Cache-Control': NO_STORE,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: `Billing upstream unreachable: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }
}
