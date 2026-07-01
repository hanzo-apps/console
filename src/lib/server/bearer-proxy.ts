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
export async function forwardWithUserBearer(req: NextRequest, opts: BearerProxyOpts): Promise<NextResponse> {
  const shape = opts.errorShape ?? 'plain'
  const path = trimL(opts.path)

  if (opts.allow && !opts.allow(path)) {
    return NextResponse.json(errorBody(shape, opts.notFoundMessage ?? 'Not found', 'not_found'), { status: 404 })
  }

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
    return NextResponse.json(errorBody(shape, `Could not authorize the request: ${msgOf(e)}`, 'auth_error'), {
      status: 502,
    })
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const headers = upstreamHeaders(req, user.owner, hasBody, opts)
  headers.Authorization = `Bearer ${bearer}`

  const url = `${trimR(opts.target)}/${path}${req.nextUrl.search}`
  const init: RequestInit = { method: req.method, headers, cache: 'no-store', signal: req.signal }
  if (hasBody) init.body = await req.text()

  try {
    const res = await fetch(url, init)
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
    return NextResponse.json(errorBody(shape, `Upstream unreachable: ${msgOf(e)}`, 'upstream_error'), { status: 502 })
  }
}
