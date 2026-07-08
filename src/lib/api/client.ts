/**
 * Core client for the unified Hanzo Cloud `/v1` backend (the casibase API).
 *
 * One `request` function: every endpoint goes through it. Cookie credentials are
 * always included (the backend sets a session cookie at `/v1/iam/signin`), and the
 * Accept-Language header is forwarded so server-side messages localize.
 *
 * The backend wraps every response as `{ status, msg, data, data2 }`. We unwrap
 * it here and throw `ApiError` on `status !== "ok"`, so callers get the payload
 * directly or a typed failure — never a half-checked envelope.
 */
import { activeApiBase } from '~/lib/network'
import { currentOrg } from '~/lib/org-scope'
import { currentActor } from '~/lib/actor-scope'
import { getScope } from '~/lib/scope'
import { refreshSession } from '~/lib/auth/refresh'

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
const baseHeaders = (hasBody: boolean): Record<string, string> => {
  // The full tenant path on every cloud call: X-Org-Id is the ACTIVE org
  // (`currentOrg()` — brand org by default, or the org a global admin switched
  // to); X-Project-Id is sent only when a project is selected (absent =
  // org-level); X-Environment defaults to mainnet. Org scope lives in
  // lib/org-scope.ts, project + environment in lib/scope.ts — orthogonal layers
  // that compose here, so this ONE stamp makes EVERY module (o11y, api-keys,
  // deploys, …) org + project + environment scoped with no per-module change.
  const s = getScope()
  const actor = currentActor()
  return {
    'Accept-Language': acceptLanguage(),
    // ONE canonical org header. Both the provisioning sub-service and the casibase
    // data-scoping filters (ai `GetEffectiveOrg`, controllers/org_resolver.go) read
    // `X-Org-Id`, honoring it only for the principal's own org or a global admin —
    // so a brand admin's stamp is a safe no-op and a global admin's OrgSwitcher
    // change re-scopes every endpoint. (`X-IAM-Org-Id` is NOT read inbound; cloud
    // mints it OUTBOUND toward commerce from the validated principal, so stamping
    // it from the browser was inert — dropped.)
    'X-Org-Id': currentOrg(),
    // Project sub-scope — the canonical `X-Project-Id` (evalsvc reads it; other
    // svcs as project scoping lands). Sent only when a project is selected.
    ...(s.project ? { 'X-Project-Id': s.project } : {}),
    // Actor sub-identity — the signed-in USER (`<owner>/<name>`), so org + project +
    // USER all pass on EVERY call. Present only when a session is resolved (absent
    // pre-sign-in / SSR); the gateway treats it as advisory, identity being
    // authoritative from the validated JWT — exactly like `X-Org-Id`.
    ...(actor ? { 'X-Actor-Id': actor } : {}),
    'X-Environment': s.environment,
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
  }
}

type Query = Record<string, string | number | boolean | undefined | null>

/** Upstream statuses that mean "the backend was momentarily unreachable" (a gateway/
 *  proxy 502, a rolling backend 503, a timeout 504) — the TRANSIENT class, safe to
 *  retry. A genuine 4xx (401/403/404/402) is NOT here: it is an honest answer, surfaced
 *  immediately. */
const TRANSIENT_STATUS = new Set([502, 503, 504])
/** Backoff schedule for the transient-retry loop: up to 3 retries after the first try
 *  (~300ms → 900ms → 2s). Worst-case added latency before the honest error card is ~3.2s. */
export const RETRY_BACKOFF_MS = [300, 900, 2000]
/** Only idempotent reads auto-retry — a POST/PUT/PATCH/DELETE that 5xx'd might have
 *  applied, so re-sending it could double-create; the user retries a mutation manually. */
export const isIdempotentMethod = (method?: string): boolean => {
  const m = (method ?? 'GET').toUpperCase()
  return m === 'GET' || m === 'HEAD'
}
/** True iff a `status` is the transient (retryable) class. */
export const isTransientStatus = (status: number): boolean => TRANSIENT_STATUS.has(status)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Injected dependencies for `resilientFetch` — real ones in `authedFetch`, fakes in tests. */
export interface ResilientDeps {
  doFetch: (url: string, init: RequestInit) => Promise<Response>
  /** Single-flight server-side session refresh (returns true if it rotated the cookie). */
  refresh: () => Promise<boolean>
  sleep: (ms: number) => Promise<void>
  /** Whether a 401 refresh may be attempted (browser only — no console session on the server). */
  canRefresh: boolean
}

/**
 * The resilient fetch orchestration (pure over its injected deps) — two orthogonal
 * resiliences so a momentary backend hiccup is INVISIBLE to the user, while a genuine
 * failure is honest:
 *
 *  1. TRANSIENT-RETRY (backend rolls). A single-replica `Recreate` backend has a brief
 *     downtime window on every deploy; a read that lands in it gets a 502/503/504 or a
 *     connection error. Rather than dump the user on a scary "Could not load" card, an
 *     idempotent read (GET/HEAD) is retried with a short exponential backoff
 *     (`RETRY_BACKOFF_MS`). So a deploy blip self-heals and the error card shows ONLY on
 *     a persistent outage (after the retries exhaust). Mutations are NOT auto-retried
 *     (a 5xx'd POST might have applied — re-sending could double-create). A genuine 4xx
 *     (403/404/402) is returned immediately for the caller's honest state.
 *  2. REACTIVE silent refresh (session lapse). On a 401 it runs `refresh()` ONCE and
 *     retries with the rotated session cookie, so a durable-but-momentarily-stale console
 *     session self-heals instead of surfacing "Not authorized".
 *
 * A caller-aborted request (its own `init.signal`) is never retried — it is honored.
 */
export async function resilientFetch(url: string, init: RequestInit, deps: ResilientDeps): Promise<Response> {
  const idempotent = isIdempotentMethod(init.method)
  // Destructure to a LOCAL so the invocation below is a BARE call (`doFetch(...)`,
  // this=undefined) — NOT a method call (`deps.doFetch(...)`, this=deps). The browser's
  // global `fetch` throws "Illegal invocation" when its `this` is anything but the global,
  // so calling it as a property of `deps` would break EVERY request. A bare call works for
  // a raw global `fetch` AND for a wrapped/mock one (regression-tested).
  const doFetch = deps.doFetch
  let refreshed = false
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await doFetch(url, init)
    } catch (e) {
      // Network-level failure (connection refused / reset / DNS) during a roll → retry
      // an idempotent read, unless the CALLER aborted or the budget is exhausted.
      if (!idempotent || init.signal?.aborted || attempt >= RETRY_BACKOFF_MS.length) throw e
      await deps.sleep(RETRY_BACKOFF_MS[attempt])
      continue
    }
    // 401 → one silent server-side refresh, then retry once with the rotated cookie.
    if (res.status === 401 && !refreshed && deps.canRefresh) {
      refreshed = true
      if (await deps.refresh()) continue
      return res // no console session / refresh failed → surface the 401
    }
    // Transient upstream (a backend roll) → retry an idempotent read with backoff.
    if (idempotent && isTransientStatus(res.status) && attempt < RETRY_BACKOFF_MS.length) {
      await deps.sleep(RETRY_BACKOFF_MS[attempt])
      continue
    }
    return res
  }
}

/** The ONE fetch every cloud/BFF call goes through — `resilientFetch` wired to the real
 *  `fetch` + server-side `refreshSession` (browser-only). */
async function authedFetch(url: string, init: RequestInit): Promise<Response> {
  return resilientFetch(url, init, {
    doFetch: fetch,
    refresh: refreshSession,
    sleep,
    canRefresh: typeof window !== 'undefined',
  })
}

const buildUrl = (path: string, query?: Query): string => {
  const url = new URL(`${activeApiBase()}/v1/${path.replace(/^\/+/, '')}`)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

/**
 * Apply a query map to an already-built URL string (same encoding as `buildUrl`).
 * Absolute URLs pass through `new URL`; a root-relative `/v1/...` (SSR, where there
 * is no origin) is resolved against a throwaway base and returned relative again, so
 * the caller keeps the same root-relative form (the rewrite still applies).
 */
const withQuery = (base: string, query?: Query): string => {
  if (!query) return base
  const relative = base.startsWith('/')
  const url = new URL(base, relative ? 'http://_' : undefined)
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  }
  return relative ? `${url.pathname}${url.search}` : url.toString()
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  opts: { query?: Query; body?: unknown; absoluteUrl?: string } = {},
): Promise<ApiResponse<T>> {
  let res: Response
  const url = opts.absoluteUrl ? withQuery(opts.absoluteUrl, opts.query) : buildUrl(path, opts.query)
  try {
    res = await authedFetch(url, {
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

/**
 * Envelope GET pinned to the console's OWN origin (`<origin>/v1/<path>`), so it
 * always hits a same-origin rewrite → hardened server proxy, NEVER the direct-cloud
 * `NEXT_PUBLIC_CLOUD_URL` override. Used by the admin AGGREGATE reads
 * (`/v1/admin/{overview,usage,…}`), which MUST terminate at the global-admin-gated
 * `app/admin/aggregate` proxy — a split-origin cloud URL would bypass that console
 * gate. Same casibase envelope unwrap + `ApiError` as `get`.
 */
export async function originGet<T>(path: string, query?: Query): Promise<T> {
  const r = await request<T>('GET', path, { query, absoluteUrl: originV1Url(path) })
  if (r.status !== 'ok') throw new ApiError(r.msg || 'Request failed')
  return r.data
}

/**
 * Envelope POST pinned to the console's OWN origin (`<origin>/v1/<path>`) — the
 * mutating twin of `originGet`. The admin AGGREGATE mutations (`/v1/admin/providers/
 * {toggle,primary}`) MUST terminate at the global-admin-gated `app/admin/aggregate`
 * proxy, which applies the same-origin CSRF check, so pinning the ORIGIN (not
 * `config.cloudUrl`) is load-bearing: a split-origin `NEXT_PUBLIC_CLOUD_URL` could
 * otherwise route the write around the console gate. Same casibase envelope unwrap +
 * `ApiError` as `post`; the browser sends its session cookie only — no credential.
 */
export async function originPost<T>(path: string, body?: unknown, query?: Query): Promise<T> {
  const r = await request<T>('POST', path, { query, body, absoluteUrl: originV1Url(path) })
  if (r.status !== 'ok') throw new ApiError(r.msg || 'Request failed')
  return r.data
}

/**
 * Envelope GET routed through the console's OWN same-origin `/v1` user-bearer BFF
 * (`<origin>/v1/<path>`) — the casibase-envelope twin of `originGet` for the cloud-api
 * STORE-ADMIN surfaces (`get-stores` / `get-store` / `get-store-names` /
 * `get-cloud-usages` / `get-files`). These heads REQUIRE a Bearer: the
 * `app/v1/[...path]` catch-all mints a short-lived user token from the session and
 * forwards it (org from the Bearer owner), so a signed-in user reads real data instead
 * of a FALSE "session expired". Same casibase envelope unwrap + `ApiError` as `get`.
 * The head must be allow-listed in `proxy-allow.ts` (`allowCloudSurface`).
 */
export async function cloudGet<T>(path: string, query?: Query): Promise<T> {
  const r = await request<T>('GET', path, { query, absoluteUrl: cloudProxyV1Url(path) })
  if (r.status !== 'ok') throw new ApiError(r.msg || 'Request failed')
  return r.data
}

/** Envelope POST routed through the same-origin `/v1` user-bearer BFF — the mutating twin of `cloudGet`. */
export async function cloudPost<T = string>(path: string, body?: unknown, query?: Query): Promise<ApiResponse<T>> {
  const r = await request<T>('POST', path, { query, body, absoluteUrl: cloudProxyV1Url(path) })
  if (r.status !== 'ok') throw new ApiError(r.msg || 'Request failed')
  return r
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
export const v1Url = (path: string, base: string = activeApiBase()): string =>
  `${base.replace(/\/+$/, '')}/v1/${path.replace(/^\/+/, '')}`

/**
 * The console's OWN same-origin `/v1/<path>` — the ONE client-visible form for EVERY
 * cloud API call, with NO prefix before `/v1/` (CTO contract: zero prefix). The browser
 * calls `<origin>/v1/prompts`; the console's `app/v1/[...path]` catch-all mints a
 * short-lived user bearer from the session and forwards to cloud-api `/v1/*` (org from
 * the Bearer owner) — so the client stays keyless and prefix-free while the bearer trust
 * boundary is unchanged. The NON-cloud heads (AI gateway, admin-aggregate, visor catalog,
 * billing, commerce) are dispatched to their own hardened proxy by a `next.config.mjs`
 * `beforeFiles` rewrite BEFORE the catch-all — invisibly to the client. On the server
 * (SSR / route handlers) there is no `window`, so this yields a root-relative `/v1/<path>`.
 */
export const originV1Url = (path: string): string => {
  const clean = path.replace(/^\/+/, '')
  return typeof window !== 'undefined' ? `${window.location.origin}/v1/${clean}` : `/v1/${clean}`
}

/**
 * Build the console's OWN same-origin `/v1/<path>` for a cloud-api head that must go
 * through the user-bearer BFF. Now IDENTICAL to `originV1Url` — every cloud path is
 * `/v1/`-rooted with ZERO prefix (CTO contract), and the `app/v1/[...path]` catch-all
 * mints a short-lived user bearer from the session and forwards to cloud-api `/v1/*`
 * (org from the Bearer owner). Kept as a named alias so the call sites that reach the
 * bearer BFF for a head that 403s on a cookie-only call (framework/s3/provisioning/
 * store-admin/…) read intentionally; the head is allow-listed in proxy-allow.ts.
 */
export const cloudProxyV1Url = originV1Url

/**
 * The console's OWN same-origin per-tenant billing proxy — the DIRECT route-handler
 * address (`<origin>/billing/v1/<path>`), NOT a bare `/v1/billing/*`.
 *
 * Billing is the SAME class as framework/s3 above (v8.4.70): on the live console
 * ingress `/v1/*` is routed to the gateway-fronted cloud binary (it does NOT reach
 * the Next server, so the `/v1/billing → /billing/v1` rewrite never runs), and the
 * cloud gateway rejects a cookie-only browser request with no bearer — a bare
 * `/v1/billing/usage` 403s ("sign in to view billing"). So the billing clients must
 * address the proxy route handler EXPLICITLY (a namespaced `/billing/v1` sub-proxy,
 * distinct from the cloud-api `/v1` bearer BFF because it injects a SERVICE token, not
 * a user bearer). `app/billing/v1/[...path]` injects the commerce SERVICE token and
 * pins the caller's OWN billing subject server-side (proven live: it returns the
 * org's real balance/usage), so tenant isolation is unchanged. On the server (SSR)
 * there is no `window`, so this yields a root-relative `/billing/v1/<path>`.
 */
export const billingProxyBase = (): string =>
  typeof window !== 'undefined' ? `${window.location.origin}/billing` : '/billing'

/** Build a `/v1/<path>` URL on the per-tenant billing proxy (`<origin>/billing/v1/<path>`). */
export const billingProxyV1Url = (path: string): string => v1Url(path, billingProxyBase())

/**
 * The console's OWN same-origin VISOR user-bearer proxy base (`<origin>/vm`).
 *
 * The public compute CATALOG (regions / CPU sizes / GPU accelerators) is served by
 * VISOR (`visor.hanzo.svc`), not cloud-api — a DISTINCT backend with a distinct shape.
 * A bare `/v1/<head>` from the browser is NOT reachable: the console host's ingress
 * routes `/v1/*` straight to hanzoai/gateway (→ cloud-api), BYPASSING Next — so the
 * `next.config` `/v1/{regions,sizes,gpu-sizes} → /vm` rewrite never runs and cloud-api
 * 403s (no visor catalog route there). Same class as the framework/s3 cloud bearer-BFF
 * fix (v8.4.70). So the visor catalog client addresses this `/vm` proxy EXPLICITLY:
 * `app/vm/[...path]` mints a short-lived user-bound token from the session and forwards
 * to visor (`allowVisorSurface`). Visor's catalog is un-scoped (any signed-in user), so
 * the minted bearer is accepted and the real DO region/size/GPU catalog loads.
 */
export const vmProxyBase = (): string =>
  typeof window !== 'undefined' ? `${window.location.origin}/vm` : '/vm'

/** Build a `/v1/<path>` URL on the visor user-bearer proxy (`<origin>/vm/v1/<path>`). */
export const vmProxyV1Url = (path: string): string => v1Url(path, vmProxyBase())

/**
 * The console's OWN same-origin COMMERCE user-bearer proxy base (`<origin>/commerce`).
 *
 * The store/merchant admin surface (product/order/user/variant/collection/discount/
 * store…) is served by commerce (`commerce.hanzo.svc`) and REQUIRES a Bearer — a
 * cookie-only browser call is rejected. Same class as the framework/s3/billing bearer-BFF
 * fixes: on the live console ingress `/v1/*` is routed straight to the
 * gateway-fronted cloud binary (it does NOT reach the Next server), so the `next.config`
 * `/v1/commerce/* → /commerce/v1/*` rewrite never runs and the bare call reaches the
 * gateway, which 403s ("Not enabled for your account"). So the commerce store clients
 * address this `/commerce` proxy EXPLICITLY: `app/commerce/[...path]` mints a short-lived
 * user-bound token from the session and forwards to commerce with the org resolved from
 * the token owner (`allowCommerceSurface`) — tenant isolation unchanged, no rewrite reliance.
 */
export const commerceProxyBase = (): string =>
  typeof window !== 'undefined' ? `${window.location.origin}/commerce` : '/commerce'

/** Build a `/v1/<path>` URL on the commerce user-bearer proxy (`<origin>/commerce/v1/<path>`). */
export const commerceProxyV1Url = (path: string): string => v1Url(path, commerceProxyBase())

async function restRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T | undefined> {
  let res: Response
  try {
    res = await authedFetch(url, {
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

/** REST PUT a JSON body on a full URL, with optional extra request headers. */
export const restPut = <T>(url: string, body?: unknown, headers?: Record<string, string>): Promise<T> =>
  restRequest<T>('PUT', url, body, headers) as Promise<T>

/** REST PATCH a JSON body on a full URL, with optional extra request headers. */
export const restPatch = <T>(url: string, body?: unknown, headers?: Record<string, string>): Promise<T> =>
  restRequest<T>('PATCH', url, body, headers) as Promise<T>

/** REST DELETE on a full URL; resolves on 204. */
export const restDelete = (url: string): Promise<void> =>
  restRequest<void>('DELETE', url).then(() => undefined)
