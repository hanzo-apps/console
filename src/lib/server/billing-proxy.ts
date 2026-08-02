/**
 * forwardBilling — the per-tenant billing DATA proxy → commerce, extracted here (in
 * `src/lib/server`, the `bearer-proxy.ts` pattern) so the tenant-scoping + binary
 * passthrough it enforces are unit-tested directly, without importing the `app/`
 * route. The route handler (`app/v1/billing/[...path]/route.ts`) is a thin wrapper
 * that calls this for GET / POST / DELETE.
 *
 * The browser calls console2's OWN origin (`/v1/billing/...`); this forwards to
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
 * Path safety (the ONE guard, shared with the bearer proxies — DRY): the catch-all
 * segments are validated by `pathIsClean` (rejects empty, `.`/`..`, ANY `%XX`
 * percent-escape, and matrix-param `;`) BEFORE the fetch, and — the authoritative
 * check — the NORMALIZED upstream `URL.pathname` is re-validated to still live under
 * `/v1/billing/` AFTER undici resolves it (an encoded `%2e%2e`/double-encoded
 * `%252e%252e→%2e%2e` that a raw check can't see, undici would pop out of `/v1/billing/`
 * to reach the whole commerce API carrying the service token). Either check fails →
 * 400 and NO upstream fetch. This mirrors `bearer-proxy.ts` exactly.
 *
 * Binary passthrough: a non-JSON/text upstream (e.g. an invoice PDF,
 * `application/pdf`) is STREAMED through as RAW BYTES (bounded memory — never buffered)
 * with a FORCED `Content-Disposition: attachment` (sanitized filename — never the
 * upstream's verbatim) and `X-Content-Type-Options: nosniff`, so a compromised/MITM'd
 * commerce hop (the hop is plaintext) can never render active content at our origin.
 * The PDF GET is tenant-scoped exactly like every other GET.
 *
 * `COMMERCE_TOKEN` unset → honest 501 (the UI shows a truthful "not configured" state;
 * it never fabricates a balance).
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser } from './identity'
import { billingSubject, scopedBillingSearch, scopedBillingBody } from './billing-scope'
import { csrfRefusal, pathIsClean } from './bearer-proxy'
import { fetchWithTimeout } from './fetch-timeout'

/** The upstream prefix every billing request MUST stay under — the tenant boundary. */
const BILLING_PREFIX = '/v1/billing/'

/** Commerce base URL (in-cluster ClusterIP). Exported so the server-to-server
 *  billing-grant helper hits the SAME backend (DRY — one commerce address). */
export function commerceBaseUrl(): string {
  return (process.env.COMMERCE_URL ?? 'http://commerce.hanzo.svc:8001').replace(/\/+$/, '')
}

/** The commerce SERVICE token from server-only env ('' when unset → honest 501).
 *  Shared by `forwardBilling` and the signup-time `grant-starter` call (DRY). */
export function commerceServiceToken(): string {
  return process.env.COMMERCE_TOKEN ?? process.env.COMMERCE_SERVICE_TOKEN ?? ''
}

/**
 * True when an upstream `Content-Type` is JSON or text — safe to read/stream as textual
 * DATA. Everything else (application/pdf, octet-stream, images, …) is BINARY and MUST be
 * streamed through as raw bytes, never `text()`-decoded (which mangles the bytes on a
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

/**
 * The Content-Type to serve a TEXTUAL upstream body under at OUR origin. Legitimate
 * billing data (application/json, text/csv, +json/+xml problem docs, application/xml)
 * keeps its type; an ACTIVE type (text/html, xhtml, svg — which can carry `<script>` —
 * or javascript) is coerced to inert `text/plain`. Commerce billing NEVER returns
 * active content, so an html/svg/js response can only be a compromised or MITM'd hop;
 * serving it inert (plus `X-Content-Type-Options: nosniff`, so it also can't be sniffed
 * back to html) means `window.open`-ing a billing URL can never execute script or
 * markup at the console origin. Pure — unit-tested.
 */
export function inertTextualType(contentType: string): string {
  const c = contentType.trim().toLowerCase()
  if (
    c.startsWith('text/html') ||
    c.startsWith('application/xhtml') ||
    c.includes('svg') ||
    c.includes('javascript') ||
    c.includes('ecmascript')
  ) {
    return 'text/plain; charset=utf-8'
  }
  return contentType
}

/**
 * A filename safe to place in `Content-Disposition: attachment; filename="…"` — strips
 * header-injection (CR/LF/quote/semicolon) and path (`/`, `\`, leading dots) characters,
 * plus control chars, so a hostile upstream can neither break out of the header nor
 * suggest a traversal name. Empty after cleaning → `download`. Pure — unit-tested.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\r\n"';\\/]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/^\.+/, '')
    .trim()
  return cleaned || 'download'
}

/**
 * The download filename for a binary billing response: the upstream `Content-Disposition`
 * filename when present (SANITIZED — never trusted verbatim), else the last path segment,
 * else `download`.
 */
export function downloadFilename(disposition: string | null, path: string[]): string {
  if (disposition) {
    const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition)
    if (m && m[1]) {
      let raw = m[1].replace(/"/g, '')
      try {
        raw = decodeURIComponent(raw)
      } catch {
        /* keep raw when it isn't valid percent-encoding */
      }
      return sanitizeFilename(raw)
    }
  }
  return sanitizeFilename(path[path.length - 1] ?? '')
}

/** The no-store cache headers every per-tenant money response carries. */
const NO_STORE = 'no-store, must-revalidate'

/** Status codes that MUST NOT carry a body (undici throws if handed one). */
function isBodyless(res: Response): boolean {
  return res.status === 204 || res.status === 205 || res.status === 304 || res.body === null
}

export async function forwardBilling(req: NextRequest, path: string[]): Promise<NextResponse> {
  // CSRF (FIRST — before any work): a mutating billing write (create/detach a method,
  // cancel a subscription, spend-alert/top-up) authenticates from the auto-sent cookie,
  // so refuse a cross-origin one before resolving the user (safe reads pass).
  const csrf = csrfRefusal(req)
  if (csrf) return csrf

  // Per-tenant authz: any valid session may see/act on ITS OWN billing (no admin gate).
  const user = await resolveUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Sign in to view billing.' }, { status: 401 })
  }

  // Path safety — the shared boundary guard (DRY with the bearer proxies). Reject empty,
  // `.`/`..`, ANY `%XX` (single-, double-, N-encoded, overlong) and matrix-param `;`
  // segments on the RAW (pre-normalization) path. A legitimate decoded billing segment
  // (invoices, pdf, pm_1, subscriptions, methods, inv_123) carries none of these.
  const rawPath = path.join('/')
  if (!pathIsClean(rawPath)) {
    return NextResponse.json({ error: 'Invalid billing path.' }, { status: 400 })
  }

  const token = commerceServiceToken()
  if (!token) {
    return NextResponse.json({ error: 'Billing is not configured (COMMERCE_TOKEN missing).' }, { status: 501 })
  }

  // Scope to the caller's OWN org — server-resolved, never client-supplied.
  const org = user.owner.trim()
  const subject = billingSubject(org, user.name)

  // Pin the FULL billing-subject key set to the server-resolved subject, and strip
  // `org`, so the browser can never read another tenant's ledger (subscriptions filter
  // `userId`, methods `customerId`, usage `user` — pinning only one leaves the
  // rest unfiltered). Mirrors commerce's own `billingSubjectKeys`.
  const qs = scopedBillingSearch(req.nextUrl.search, subject)

  // Build the upstream URL and re-validate the NORMALIZED pathname — the AUTHORITATIVE
  // gate. undici's WHATWG parser resolves `%2e%2e` / double-encoded `%252e%252e→%2e%2e`
  // dot-segments a raw-string check can't see, so a segment that slipped past a weaker
  // check would pop out of `/v1/billing/` and reach the whole commerce API with the
  // service token. We validate — and fetch — the normalized URL (RED-1).
  let dest: URL
  try {
    dest = new URL(`${commerceBaseUrl()}${BILLING_PREFIX}${rawPath}${qs ? `?${qs}` : ''}`)
  } catch {
    return NextResponse.json({ error: 'Invalid billing path.' }, { status: 400 })
  }
  const normRel = dest.pathname.startsWith(BILLING_PREFIX) ? dest.pathname.slice(BILLING_PREFIX.length) : ''
  if (!pathIsClean(normRel)) {
    return NextResponse.json({ error: 'Invalid billing path.' }, { status: 400 })
  }

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
    // Scope the WRITE body to the caller's OWN subject AND (for a binding write) its
    // OWN holder — the browser names a holder KIND, the server says which holder that
    // is. Only set a body when the request actually carries one — a bodyless DELETE/
    // POST sends none (never an empty-string body).
    const raw = await req.text()
    if (raw) init.body = scopedBillingBody(raw, subject, org)
  }

  try {
    // Fetch the NORMALIZED dest (exactly what we validated) — never a raw string.
    const res = await fetchWithTimeout(dest, init)
    const contentType = res.headers.get('content-type') ?? 'application/json'
    const bodyless = isBodyless(res)

    if (!isTextualContentType(contentType)) {
      // Binary (e.g. an invoice PDF) — STREAM the RAW bytes through unmodified (bounded
      // memory — never `arrayBuffer()`-buffered). FORCE `Content-Disposition: attachment`
      // with a SANITIZED filename (not the upstream's verbatim) and `nosniff`, so a
      // compromised/MITM'd upstream can never render active content at our origin. Still
      // tenant-scoped: this GET used the SAME auth + X-Org-Id + scopedBillingSearch path.
      return new NextResponse(bodyless ? null : res.body, {
        status: res.status,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${downloadFilename(res.headers.get('content-disposition'), path)}"`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': NO_STORE,
        },
      })
    }

    // JSON / text — STREAM through (bounded memory). A null-body status (204 detach)
    // carries NO body so undici's "204 cannot have a body" guard is not tripped. An
    // active content type (a compromised commerce hop returning text/html/svg/js) is
    // served inert; `nosniff` blocks MIME-sniffing on every response.
    return new NextResponse(bodyless ? null : res.body, {
      status: res.status,
      headers: {
        'Content-Type': inertTextualType(contentType),
        'X-Content-Type-Options': 'nosniff',
        // A per-tenant money response must NEVER be cached by the browser or any
        // intermediary — otherwise the wallet shows a stale number after a top-up.
        'Cache-Control': NO_STORE,
      },
    })
  } catch (e) {
    // Redact the exception (it carries the internal commerce host/port) — log server-side
    // only; return a generic client message (RED-4, mirrors bearer-proxy.ts).
    console.error('billing-proxy: upstream unreachable:', commerceBaseUrl(), e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Billing upstream is unavailable.' }, { status: 502 })
  }
}
