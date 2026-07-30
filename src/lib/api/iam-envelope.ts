/**
 * IAM envelope client factory — the ONE typed client for the IAM
 * `{status,msg,data,total}` envelope (legacy `data2` count accepted), bound to a
 * same-origin gated proxy base.
 *
 * The browser never holds an IAM credential: it calls a SAME-ORIGIN server route
 * (`/admin/iam/*` for cross-tenant global-admin ops, `/org/iam/*` for a customer
 * managing their OWN org) with just the session cookie; the server route enforces
 * the gate + tenant scoping and forwards to IAM as the user. Both speak the same
 * envelope, so this ONE factory serves both (DRY) — only the base path differs.
 */
import { ApiError, envelopeTotal } from './client'

type Envelope<T> = { status?: string; msg?: string; data?: T; total?: number; data2?: unknown }

/** Paged result — rows plus the backend's total (`total`, legacy `data2`). */
export type Paged<T> = { rows: T[]; total: number }

export type Query = Record<string, string | number | boolean | undefined | null>

export const DEFAULT_PAGE_SIZE = 50

/** `?a=b&c=d` for a query map, skipping undefined/null. '' when empty. */
export function qs(query?: Query): string {
  if (!query) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** A cookie-authenticated IAM-envelope client rooted at `base` (e.g. `/org/iam`). */
export function makeIamClient(base: string) {
  async function iamReq<T>(
    method: 'GET' | 'POST',
    segment: string,
    opts: { query?: Query; body?: unknown } = {},
  ): Promise<Envelope<T>> {
    let res: Response
    try {
      res = await fetch(`${base}/${segment}${qs(opts.query)}`, {
        method,
        credentials: 'include',
        headers:
          opts.body !== undefined
            ? { 'Content-Type': 'application/json', Accept: 'application/json' }
            : { Accept: 'application/json' },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      })
    } catch (e) {
      throw new ApiError(e instanceof Error ? e.message : 'Network request failed')
    }
    if (res.status === 403) throw new ApiError('forbidden', 403)
    const json = (await res.json().catch(() => null)) as Envelope<T> | null
    if (!res.ok || !json || json.status !== 'ok') {
      throw new ApiError(json?.msg || `Request failed (HTTP ${res.status})`, res.status)
    }
    return json
  }

  async function iamList<T>(segment: string, query: Query): Promise<Paged<T>> {
    const r = await iamReq<T[]>('GET', segment, { query })
    const rows = Array.isArray(r.data) ? r.data : []
    return { rows, total: envelopeTotal(r, rows) }
  }

  async function iamOne<T>(segment: string, query: Query): Promise<T> {
    const r = await iamReq<T>('GET', segment, { query })
    if (r.data === undefined || r.data === null) throw new ApiError('Not found', 404)
    return r.data
  }

  const iamMutate = (segment: string, body: unknown, query?: Query): Promise<void> =>
    iamReq<unknown>('POST', segment, { body, query }).then(() => undefined)

  return { iamReq, iamList, iamOne, iamMutate }
}
