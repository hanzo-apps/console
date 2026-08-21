/**
 * forwardWithUserBearer — the ONE server-side transport that lets the cookie-only
 * browser reach a backend that authorizes on a user-bound Bearer JWT.
 *
 * The trust boundary: the browser holds NO credential. It calls console2's OWN
 * origin (e.g. `/v1/provisioning/vector`, `/v1/vm/regions`) with just its first-party
 * session cookie. This handler resolves WHO the caller is from that cookie
 * (`resolveUser` → cloud `/v1/ai/account`), mints a SHORT-LIVED, user-bound IAM
 * token as the confidential `hanzo-console` client (`adminBearer`, cached per user
 * in `identity.ts` — ONE cache shared by every proxy), and forwards to the target
 * with `Authorization: Bearer <token>`. The backend resolves the ORG from the
 * token's `owner` claim, so tenancy is server-authoritative — a browser can never
 * supply its own org. This is the EXACT pattern the `/ai` + `/keys` proxies proved
 * live; every service proxy now shares this ONE implementation (DRY).
 *
 * Why a Bearer and not the cookie: the new provisioning/data + serverless surfaces
 * (vector/sql/kv/s3/docdb/datastore/search, functions/prompts/agents) authorize on
 * the JWT owner claim and 403 a cookie-only call ("X-Org-Id required"). And why the
 * cookie is NOT forwarded upstream: the mint call is in-cluster and sends the
 * Bearer alone (~one header), so it dodges the public-gateway 431 (header-too-large)
 * that a cookie + JWT together would trip.
 *
 * The response body is STREAMED straight through (`res.body`), so this one path
 * serves streaming SSE (chat/completions), JSON (data/functions), 204 (DELETE), and
 * an honest upstream 402/403/404/501 verbatim — the proxy never rewrites an
 * upstream status, only its OWN 401/404/502.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser, adminBearer } from './identity'
import { fetchWithTimeout } from './fetch-timeout'

const trimR = (s: string) => s.replace(/\/+$/, '')
const trimL = (s: string) => s.replace(/^\/+/, '')
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Error-envelope shape for THIS proxy's own 401/404/502 (never the upstream body,
 * which streams through verbatim). Matched to the client that reads it:
 *   - `openai`   → `{ error: { message, type } }` (the AI proxy / OpenAI-compatible)
 *   - `casibase` → `{ status: 'error', msg }`     (the `{status,msg,data}` envelope)
 *   - `plain`    → `{ error }`                     (plain-REST clients; the default)
 */
export type ErrorShape = 'openai' | 'casibase' | 'plain'

export function errorBody(shape: ErrorShape, message: string, code?: string): Record<string, unknown> {
  switch (shape) {
    case 'openai':
      return { error: { message, type: code ?? 'error', ...(code ? { code } : {}) } }
    case 'casibase':
      return { status: 'error', msg: message }
    default:
      return { error: message }
  }
}

export type BearerProxyOpts = {
  /** Upstream base URL, e.g. `CLOUD_API_URL` / `VISOR_URL` (trailing slash ok). */
  target: string
  /** Upstream path, already joined from the catch-all (e.g. `v1/provisioning/vector`, no leading `/`). */
  path: string
  /** Least-privilege gate: return true iff `path` is reachable. Omit = allow any. */
  allow?: (path: string) => boolean
  /** Extra allow-listed request headers to forward (e.g. the AI RAG retrieval switch). */
  extraHeaders?: Record<string, string>
  /** Forward the active tenant SUB-scope (`X-Project-Id` / `X-Environment`) when present.
   *  Org is ALWAYS the token owner (never browser-supplied); these are sub-scopes the
   *  backend re-validates under that org. Default false (AI/tasks/base don't scope). */
  forwardScope?: boolean
  /** RFC 8707 resource audience to scope the minted user bearer to (the `aud` claim).
   *  Set it to the value the TARGET resource server's audience allowlist accepts (e.g.
   *  the cloud API's `<brand>-cloud`) so the forwarded token validates regardless of
   *  which app the caller calls home — the admin-aggregate proxy needs this because the
   *  reserved-admin operator's own app (`admin-console`) is not in cloud's allowlist.
   *  Omitted → the mint uses IAM's default (target-app) audience, unchanged for tenants. */
  audience?: string
  /** Envelope shape for this proxy's own 401/404/502. Default `plain`. */
  errorShape?: ErrorShape
  /** 401 body message (not signed in). */
  unauthorizedMessage?: string
  /** 404 body message (path not allow-listed). */
  notFoundMessage?: string
}

/**
 * The upstream request headers, rebuilt from scratch (the browser cookie NEVER
 * leaks upstream). `Authorization` is added by the caller after the bearer mint.
 * X-Org-Id is the token owner — authoritative, never the browser's claim.
 */
export function upstreamHeaders(
  req: NextRequest,
  owner: string,
  hasBody: boolean,
  opts: { extraHeaders?: Record<string, string>; forwardScope?: boolean },
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Org-Id': owner,
  }
  // Preserve the caller's Content-Type when it carries a body: a JSON REST call
  // arrives (and forwards) as `application/json`, but a BINARY artifact upload
  // (a zip/tar.gz static build → the platform deploy endpoint) or a
  // `multipart/form-data` upload MUST forward its OWN Content-Type (incl. any
  // multipart boundary) so the backend content-sniffs correctly. Default to
  // `application/json` when the caller sent no Content-Type (every REST client does).
  if (hasBody) headers['Content-Type'] = req.headers.get('content-type') || 'application/json'
  if (opts.forwardScope) {
    const project = req.headers.get('X-Project-Id')
    const environment = req.headers.get('X-Environment')
    if (project) headers['X-Project-Id'] = project
    if (environment) headers['X-Environment'] = environment
  }
  if (opts.extraHeaders) Object.assign(headers, opts.extraHeaders)
  return headers
}

/**
 * Resolve the caller from their session cookie, mint a user-bound Bearer, and
 * forward the request to `target/path` as that user. Fails CLOSED: 401 with no
 * session, 502 when the bearer can't be minted or the upstream is unreachable.
 */
/**
 * A path is safe to allow-list + forward ONLY when every segment is a real name —
 * no empty (`//`), `.`/`..` dot-segment, or surviving encoded slash (`%2f`). Next
 * decodes `%2f` into the catch-all segment array WITHOUT re-normalizing dot-segments,
 * and `fetch()` collapses `..` AFTER the allow-list runs — so `functions%2f..%2f..%2fiam`
 * would slip a foreign head (`functions`) past `allowCloudSurface` and then be
 * rewritten to `/v1/iam` upstream. Gating on clean segments (before the allow-list)
 * makes the check operate on the exact path `fetch` will send. Leading/trailing
 * slashes are trimmed by the caller.
 */
/** The safe (non-mutating) HTTP methods — never a CSRF concern. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** The host of a URL string, or '' when it isn't a parseable absolute URL. */
function hostOf(url: string | null): string {
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/**
 * The fetch-metadata + Origin/Referer signals a CSRF check reads off a request.
 * `secFetchSite` is the browser-set `Sec-Fetch-Site` (`same-origin`/`same-site`/
 * `none`/`cross-site`) — unforgeable by page JS, so it is the strongest signal.
 */
export type OriginSignals = {
  host: string
  origin: string | null
  referer: string | null
  /** `Sec-Fetch-Site` header value (browser-set, JS-unforgeable). */
  secFetchSite: string | null
}

/**
 * CSRF guard for the cookie-authenticated proxy: a same-origin check on MUTATING
 * requests (POST/PUT/PATCH/DELETE). The proxy authenticates from the first-party
 * session cookie alone (`resolveUser`), and cookies are auto-sent cross-site — so a
 * cross-origin page could otherwise drive a state change (create/delete an agent,
 * run a paid eval) as the victim. Two independent signals, both fail-closed:
 *   1. `Sec-Fetch-Site` (browser-set, JS-unforgeable): `cross-site` is refused
 *      outright; `same-origin`/`same-site`/`none` (a user-typed URL / bookmark) pass
 *      the fetch-metadata gate.
 *   2. `Origin` host must equal `Host` (falling back to `Referer` host) — modern
 *      browsers send `Origin` on every mutating fetch/form-POST.
 * A mutating request that trips EITHER gate is refused. Safe methods (GET/HEAD/
 * OPTIONS) are never gated — they change nothing, and SameSite=Lax already covers
 * top-level cross-site navigation. Defense in depth ON TOP OF the session cookie's
 * own SameSite attribute. PURE.
 */
export function sameOriginOK(method: string, s: OriginSignals): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true
  // 1. Fetch-metadata: an explicit cross-site request is refused (unforgeable).
  const site = (s.secFetchSite ?? '').trim().toLowerCase()
  if (site === 'cross-site') return false
  // 2. Origin/Referer host must match Host.
  const h = (s.host ?? '').trim()
  if (!h) return false // no Host to compare against — refuse a mutating request
  const o = hostOf(s.origin)
  if (o) return o === h
  const r = hostOf(s.referer)
  if (r) return r === h
  // No Origin/Referer: allow ONLY when fetch-metadata already affirmed same-origin
  // (a same-origin fetch may omit Origin on some engines but sets Sec-Fetch-Site).
  return site === 'same-origin'
}

/**
 * THE ONE CSRF refusal for a cookie-authenticated route — null when the request is
 * same-origin (or a safe method), else a fail-closed 403. `forwardWithUserBearer`
 * applies this inline; every HAND-ROLLED cookie-auth route that mutates (POST/PUT/
 * PATCH/DELETE) must call it at its top too, so the ONE same-origin policy guards
 * the WHOLE BFF — not just the bearer proxies. Reads only request HEADERS (never the
 * body), so it composes safely before any `req.text()`/`req.json()`. `shape` picks the
 * error envelope the route's client expects (default `plain`). Fail-closed by
 * construction: on a mutating request with no trustworthy same-origin signal it 403s.
 */
export function csrfRefusal(req: NextRequest, shape: ErrorShape = 'plain'): NextResponse | null {
  const ok = sameOriginOK(req.method, {
    host: req.headers.get('host') ?? '',
    origin: req.headers.get('origin'),
    referer: req.headers.get('referer'),
    secFetchSite: req.headers.get('sec-fetch-site'),
  })
  return ok ? null : NextResponse.json(errorBody(shape, 'Cross-origin request refused.', 'forbidden'), { status: 403 })
}

export function pathIsClean(path: string): boolean {
  if (!path) return false
  // Reject empty (`//`), `.`/`..` dot-segments, ANY surviving percent-escape (`%XX`),
  // and matrix-param (`;`) segments. Next decodes a catch-all segment exactly ONCE, so
  // a legitimate segment carries NO percent-escape here — a residual `%2e`/`%252e`/
  // `%c0%ae` is a multi-encoding/overlong tell that undici (or any re-decoding hop)
  // could still normalize into `/` or `..`; and `..;` is a matrix-param traversal on a
  // `;`-stripping upstream. Rejecting all `%XX`/`;` closes single-, double-, N-encoded,
  // overlong, and matrix-param traversal at the boundary, independent of upstream decode
  // behavior (RED). The forward path ALSO re-validates the post-normalization URL.
  return path
    .split('/')
    .every((s) => s !== '' && s !== '.' && s !== '..' && !/%[0-9a-f]{2}/i.test(s) && !s.includes(';'))
}

export async function forwardWithUserBearer(req: NextRequest, opts: BearerProxyOpts): Promise<NextResponse> {
  const shape = opts.errorShape ?? 'plain'
  const notFound = () =>
    NextResponse.json(errorBody(shape, opts.notFoundMessage ?? 'Not found', 'not_found'), { status: 404 })

  const rawPath = trimL(opts.path).replace(/\/+$/, '')
  // Fast reject on the raw (pre-normalization) path — literal traversal / %2e / %2f.
  if (!pathIsClean(rawPath) || (opts.allow && !opts.allow(rawPath))) return notFound()

  // Re-parse the destination so the AUTHORITATIVE gate runs on the EXACT path fetch
  // will send: WHATWG URL (undici) resolves %2e and double-encoded (%252e→%2e)
  // dot-segments a raw-string check can't see, turning `functions/%2e%2e/iam` into
  // `/iam` upstream (RED HIGH). We validate — and fetch — the normalized URL.
  let dest: URL
  try {
    dest = new URL(`${trimR(opts.target)}/${rawPath}${req.nextUrl.search}`)
  } catch {
    return notFound()
  }
  const basePath = new URL(trimR(opts.target)).pathname // '/' for an origin target (all ours are)
  const normPath = trimL(dest.pathname.slice(basePath.length)).replace(/\/+$/, '')
  if (!pathIsClean(normPath) || (opts.allow && !opts.allow(normPath))) return notFound()

  // CSRF: this proxy authenticates from the first-party session cookie (auto-sent
  // cross-site), so a MUTATING request must be same-origin (Sec-Fetch-Site not
  // cross-site AND Origin/Referer host == Host). Fail closed with a 403 BEFORE
  // resolving the user, so a cross-site POST can never create/delete/run anything on
  // the victim's behalf. Safe methods pass. ONE guard (`csrfRefusal`) — the same one
  // every hand-rolled cookie-auth route now calls.
  const csrf = csrfRefusal(req, shape)
  if (csrf) return csrf

  const user = await resolveUser(req)
  if (!user) {
    return NextResponse.json(
      errorBody(shape, opts.unauthorizedMessage ?? 'Sign in to continue.', 'unauthenticated'),
      { status: 401 },
    )
  }

  let bearer: string
  try {
    bearer = await adminBearer(user, opts.audience)
  } catch (e) {
    // Redact the exception (it carries internal IAM host/port) — log server-side only.
    console.error('bearer-proxy: could not mint user bearer:', msgOf(e))
    return NextResponse.json(errorBody(shape, 'Could not authorize the request.', 'auth_error'), {
      status: 502,
    })
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const headers = upstreamHeaders(req, user.owner, hasBody, opts)
  headers.Authorization = `Bearer ${bearer}`

  const init: RequestInit = { method: req.method, headers, cache: 'no-store', signal: req.signal }
  if (hasBody) {
    // JSON/text bodies forward as a string (the vast majority — every REST client).
    // A NON-text body — a zip/tar.gz deploy artifact, or a multipart/form-data upload —
    // MUST forward its bytes VERBATIM: reading it via `req.text()` would UTF-8-corrupt
    // the binary. ONE proxy, both body kinds; the Content-Type (with any multipart
    // boundary) already rode through `upstreamHeaders` above.
    const ct = (req.headers.get('content-type') || '').toLowerCase()
    const isText = ct === '' || ct.includes('application/json') || ct.startsWith('text/')
    init.body = isText ? await req.text() : new Uint8Array(await req.arrayBuffer())
  }

  try {
    // Fetch the NORMALIZED dest (exactly what we validated) — never the raw string.
    // Bounded: the timeout is composed with `init.signal` (req.signal), so a silent
    // upstream aborts instead of wedging the request (→ the 502 below).
    const res = await fetchWithTimeout(dest, init)
    // Stream the upstream body straight through — correct for SSE, JSON, binary,
    // and empty (204). The upstream status flows verbatim so an honest 402/403/501
    // reaches the UI unchanged.
    return new NextResponse(res.body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-cache, no-transform',
      },
    })
  } catch (e) {
    // Redact the exception (it carries the internal service host/port) — log server-side.
    console.error('bearer-proxy: upstream unreachable:', opts.target, msgOf(e))
    return NextResponse.json(errorBody(shape, 'Upstream service is unavailable.', 'upstream_error'), { status: 502 })
  }
}
