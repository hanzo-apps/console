/**
 * The IAM wire contract, and the cookie-authenticated client that speaks it.
 *
 * IAM answers with the TYPED RECORD, not a status envelope. A list is
 * `{ <entity>: T[], total }` (organizations spell the count `count`), a
 * single read is the record itself, and a write answers with what it wrote.
 * There is no `status:"ok"` to branch on: the HTTP code is the whole verdict,
 * and a failure body carries its reason under `error`.
 *
 * That contract — how a list files its rows and its count — lives in `client.ts`
 * beside the one it replaced, and both this cookie client and the bearer client
 * read it from there, so the two cannot come to disagree about the wire.
 *
 * The browser never holds an IAM credential: it calls a SAME-ORIGIN server route
 * (`/admin/iam/*` for cross-tenant global-admin ops, `/org/iam/*` for a customer
 * managing their OWN org) with just the session cookie; the server route enforces
 * the gate + tenant scoping and forwards to IAM as the user. Both speak the same
 * contract, so this ONE factory serves both — only the base path differs.
 */
import { ApiError, pageOf } from './client'

/** Paged result — rows plus the count IAM reported. */
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

/** A cookie-authenticated IAM client rooted at `base` (e.g. `/org/iam`). */
export function makeIamClient(base: string) {
  async function iamReq<T>(
    method: 'GET' | 'POST',
    segment: string,
    opts: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
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
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    // The code is the verdict. A refusal names its reason under `error` — zip's
    // shape and the proxy's own both do — so read that and fall back to the code.
    if (!res.ok) {
      const reason = typeof json?.error === 'string' ? json.error : ''
      throw new ApiError(reason || `Request failed (HTTP ${res.status})`, res.status)
    }
    return json as T
  }

  const iamList = <T>(entity: string, query: Query): Promise<Paged<T>> =>
    iamReq<unknown>('GET', entity, { query }).then((body) => pageOf<T>(entity, body))

  async function iamOne<T>(entity: string, key: Query): Promise<T> {
    const record = await iamReq<T>('GET', `${entity}/get`, { query: key })
    if (record === undefined || record === null) throw new ApiError('Not found', 404)
    return record
  }

  const iamMutate = (path: string, body: unknown): Promise<void> =>
    iamReq<unknown>('POST', path, { body }).then(() => undefined)

  return { iamReq, iamList, iamOne, iamMutate }
}
