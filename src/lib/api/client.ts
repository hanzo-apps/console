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
      headers: {
        'Accept-Language': acceptLanguage(),
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
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
