/**
 * forwardWithUserBearer — the ONE server-side transport that lets the cookie-only
 * browser reach a backend that authorizes on a user-bound Bearer JWT.
 *
 * The trust boundary: the browser holds NO credential. It calls console2's OWN
 * origin (e.g. `/cloud/v1/vector`, `/vm/v1/machines`) with just its first-party
 * session cookie. This handler resolves WHO the caller is from that cookie
 * (`resolveUser` → cloud `/v1/get-account`), mints a SHORT-LIVED, user-bound IAM
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
  /** Upstream path, already joined from the catch-all (e.g. `v1/vector`, no leading `/`). */
  path: string
  /** Least-privilege gate: return true iff `path` is reachable. Omit = allow any. */
  allow?: (path: string) => boolean
  /** Extra allow-listed request headers to forward (e.g. the AI RAG retrieval switch). */
  extraHeaders?: Record<string, string>
  /** Forward the active tenant SUB-scope (`X-Project-Id` / `X-Environment`) when present.
   *  Org is ALWAYS the token owner (never browser-supplied); these are sub-scopes the
   *  backend re-validates under that org. Default false (AI/tasks/base don't scope). */
  forwardScope?: boolean
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
  if (hasBody) headers['Content-Type'] = 'application/json'
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
export function pathIsClean(path: string): boolean {
  if (!path) return false
  // Reject empty (`//`), `.`/`..` dot-segments, AND URL-encoded dots/slashes
  // (`%2e`/`%2f`). Next decodes a catch-all segment exactly ONCE, so a double-encoded
  // `%252e%252e` arrives here as literal `%2e%2e`; a raw `..` check misses it, then
  // undici's URL parser normalizes `%2e%2e` into real `../` at fetch time (RED HIGH).
  // The forward path ALSO re-validates the post-normalization URL — this is the fast,
  // defense-in-depth first gate.
  return path.split('/').every((s) => s !== '' && s !== '.' && s !== '..' && !/%2[ef]/i.test(s))
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

  const user = await resolveUser(req)
  if (!user) {
    return NextResponse.json(
      errorBody(shape, opts.unauthorizedMessage ?? 'Sign in to continue.', 'unauthenticated'),
      { status: 401 },
    )
  }

  let bearer: string
  try {
    bearer = await adminBearer(user)
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
  if (hasBody) init.body = await req.text()

  try {
    // Fetch the NORMALIZED dest (exactly what we validated) — never the raw string.
    const res = await fetch(dest, init)
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
