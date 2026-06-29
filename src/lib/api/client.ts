/**
 * Core client for the unified Hanzo Cloud `/v1` backend (the casibase API).
 *
 * One `request` function: every endpoint goes through it. Cookie credentials are
 * always included (the backend sets a session cookie at `/v1/signin`), and the
 * Accept-Language header is forwarded so server-side messages localize.
 *
 * The backend wraps every response as `{ status, msg, data, data2 }`. We unwrap
 * it here and throw `ApiError` on `status !== "ok"`, so callers get the payload
 * directly or a typed failure — never a half-checked envelope.
 */
import { config } from '~/config'
import { currentOrg } from '~/lib/org-scope'

export type ApiResponse<T> = {
  status: 'ok' | 'error'
  msg: string
  data: T
  /** Secondary payload — total row count for list endpoints. */
  data2?: unknown
}

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const acceptLanguage = (): string => {
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language
  return 'en'
}

/**
 * Headers sent on every cloud call. Besides locale, we stamp `X-Org-Id` with the
 * ACTIVE org scope (`currentOrg()` — the brand org by default, or the org a global
 * admin switched to in the OrgSwitcher). The casibase endpoints scope by the
 * session's org claim, but the sub-services mounted on the same backend that
 * speak plain REST (the provisioning service) require an explicit tenant header
 * and reject the request with 403 "X-Org-Id required" without it — this is what
 * lets the data-product modules resolve their tenant on the direct cloud-api
 * path, and re-scope when the operator switches org. When a gateway sits in front
 * and re-injects the header from the JWT, the stamped value is simply overwritten,
 * so sending it is correct in both topologies.
 */
const baseHeaders = (hasBody: boolean): Record<string, string> => ({
  'Accept-Language': acceptLanguage(),
  'X-Org-Id': currentOrg(),
  ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
})

type Query = Record<string, string | number | boolean | undefined | null>

const buildUrl = (path: string, query?: Query): string => {
  const url = new URL(`${config.cloudUrl}/v1/${path.replace(/^\/+/, '')}`)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  opts: { query?: Query; body?: unknown } = {},
): Promise<ApiResponse<T>> {
  let res: Response
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      credentials: 'include',
      headers: baseHeaders(opts.body !== undefined),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'Network request failed')
  }

  if (res.status === 401 || res.status === 403) {
    throw new ApiError('Not authorized', res.status)
  }

  let json: ApiResponse<T>
  try {
    json = (await res.json()) as ApiResponse<T>
  } catch {
    throw new ApiError(`Invalid response from server (HTTP ${res.status})`, res.status)
  }

  if (!res.ok && json?.status !== 'ok') {
    throw new ApiError(json?.msg || `Request failed (HTTP ${res.status})`, res.status)
  }
  return json
}

/** GET that unwraps `data` and throws on a non-ok envelope. */
export async function get<T>(path: string, query?: Query): Promise<T> {
  const r = await request<T>('GET', path, { query })
  if (r.status !== 'ok') throw new ApiError(r.msg || 'Request failed')
  return r.data
}

/** GET that returns the full envelope (for list endpoints needing `data2` total). */
export async function getList<T>(path: string, query?: Query): Promise<{ rows: T; total: number }> {
  const r = await request<T>('GET', path, { query })
  if (r.status !== 'ok') throw new ApiError(r.msg || 'Request failed')
  const total = typeof r.data2 === 'number' ? r.data2 : Array.isArray(r.data) ? r.data.length : 0
  return { rows: r.data, total }
}

/** POST a JSON body; returns the `msg` (most mutations return ok/affected). */
export async function post<T = string>(path: string, body?: unknown, query?: Query): Promise<ApiResponse<T>> {
  const r = await request<T>('POST', path, { query, body })
  if (r.status !== 'ok') throw new ApiError(r.msg || 'Request failed')
  return r
}

/** Owner/name -> the `id` query param the backend expects (`owner/name`). */
export const idOf = (owner: string, name: string): string => `${owner}/${encodeURIComponent(name)}`

// ── Plain-REST layer ────────────────────────────────────────────────────────
// Some sub-services mounted on the same backend speak plain REST (raw JSON,
// 2xx / 201 / 204, DELETE) instead of the casibase `{status,msg,data}` envelope
// — the provisioning service (POST/GET/DELETE /v1/<kind>) and the platform DOKS
// control plane. Same cookie credentials and `ApiError` as the envelope path;
// only the body shape and verbs differ, so the transport stays in this one file.
//
// Tenancy is server-side: the gateway validates the session cookie and injects
// `X-Org-Id` from the JWT (and strips any client-supplied identity header), so
// the browser sends credentials only — never an org header.

/** Build a `/v1/<path>` URL on an arbitrary base (cloud backend by default). */
export const v1Url = (path: string, base: string = config.cloudUrl): string =>
  `${base.replace(/\/+$/, '')}/v1/${path.replace(/^\/+/, '')}`

/**
 * The console's OWN same-origin keyless AI proxy base (`<origin>/ai`). The gateway
 * model/inference endpoints REQUIRE an `Authorization: Bearer` token (a session
 * cookie is rejected — the "models missing" bug), so the browser never calls the
 * gateway directly: it calls this proxy with just the cookie and the server route
 * (`app/ai/[...path]`) resolves the user + forwards with a short-lived user token.
 * ONE place defines this origin — the model catalog and the playground both use it.
 */
export const aiBase = (): string => (typeof window !== 'undefined' ? `${window.location.origin}/ai` : '/ai')

/** Build a `/v1/<path>` URL on the AI proxy (`<origin>/ai/v1/<path>`). */
export const aiV1Url = (path: string): string => v1Url(path, aiBase())

async function restRequest<T>(
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T | undefined> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { ...baseHeaders(body !== undefined), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'Network request failed')
  }

  if (res.status === 401 || res.status === 403) throw new ApiError('Not authorized', res.status)
  if (res.status === 204) return undefined

  const text = await res.text()
  let json: unknown
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      if (!res.ok) throw new ApiError(`Request failed (HTTP ${res.status})`, res.status)
      throw new ApiError(`Invalid response from server (HTTP ${res.status})`, res.status)
    }
  }

  if (!res.ok) {
    // The OpenAI-compatible endpoints return `{ error: { message } }` (e.g. the
    // 402 billing gate); plain REST returns `{ msg }` or `{ error: "…" }`. Pull
    // the human message from whichever shape so callers never see "[object Object]".
    let m: string | undefined
    if (json && typeof json === 'object') {
      const j = json as { msg?: unknown; error?: unknown }
      if (typeof j.msg === 'string' && j.msg) m = j.msg
      else if (typeof j.error === 'string') m = j.error
      else if (j.error && typeof j.error === 'object') {
        const em = (j.error as { message?: unknown }).message
        if (typeof em === 'string') m = em
      }
    }
    throw new ApiError(m || `Request failed (HTTP ${res.status})`, res.status)
  }
  return json as T
}

/** REST GET on a full URL (build it with `v1Url`). */
export const restGet = <T>(url: string): Promise<T> => restRequest<T>('GET', url) as Promise<T>

/** REST POST a JSON body on a full URL, with optional extra request headers. */
export const restPost = <T>(url: string, body?: unknown, headers?: Record<string, string>): Promise<T> =>
  restRequest<T>('POST', url, body, headers) as Promise<T>

/** REST DELETE on a full URL; resolves on 204. */
export const restDelete = (url: string): Promise<void> =>
  restRequest<void>('DELETE', url).then(() => undefined)
