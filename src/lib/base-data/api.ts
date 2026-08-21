/**
 * BaseDataApi — a tiny typed client for a Hanzo Base (hanzoai/base) instance's
 * `/v1` REST surface. It covers the metadata-driven record surface end to end: read
 * the collection schemas (to build the field model), then list / get / create /
 * update / delete a collection's records.
 *
 * A Base instance speaks plain JSON REST (NOT the cloud casibase
 * `{status,msg,data}` envelope), so this does NOT reuse the cloud `/v1` client.
 * It shares only the app's one typed `ApiError` so a Base failure flows through
 * the same honest-state UI (`classifyBackend` / `BackendStateCard`). Transport
 * stays its own concern; only the error value type is shared.
 *
 * Auth: the same-origin base URL is `/v1/superbase`, the console's own proxy to the
 * managed Base. It resolves the caller from the first-party session cookie, mints a
 * short-lived user-bound IAM token, stamps `X-Org-Id` from that token's owner, and
 * forwards to base.hanzo.ai under Base's own `v1/collections/*` contract — so the
 * browser holds no credential and the org is server-authoritative. Base still
 * authorizes each read/write per-user + per-collection itself. A BYO Base (a direct
 * `https://x.base.hanzo.ai/v1` origin) has no proxy in front of it, so there the
 * caller's `token` — else its PKCE access token — travels as the Bearer.
 */
import { ApiError } from '~/lib/api/client'
import { iamAccessToken } from '~/lib/auth/iam'
import { currentOrg } from '~/lib/org-scope'
import type { BaseCollection } from './fields'

/** A Base record — a flat map of field name → value (`id` always present). */
export type BaseRecord = Record<string, unknown> & { id?: string }

/** Base's paginated list result. */
export interface BaseListResult<T> {
  page: number
  perPage: number
  totalItems: number
  totalPages: number
  items: T[]
}

/** Record-list query params (a subset of Base's list API). */
export interface ListRecordsParams {
  page?: number
  perPage?: number
  sort?: string
  filter?: string
  expand?: string
  fields?: string
  skipTotal?: boolean
}

/**
 * One field in a NEW content type, in Base's modern flat shape (`POST
 * /v1/superbase/collections`). Type-specific options are flat (`values`/`maxSelect`/
 * `collectionId`/`mimeTypes`), never nested under legacy `options`.
 */
export interface CollectionFieldInput {
  name: string
  type: string
  required?: boolean
  /** select: the accepted values. */
  values?: string[]
  /** select/file/relation: 1 = single value, >1 = multiple. */
  maxSelect?: number
  /** relation: the TARGET collection's id (not its name). */
  collectionId?: string
  /** relation: delete this record when the related record is deleted. */
  cascadeDelete?: boolean
  /** file: max bytes (0 ⇒ Base's 5 MB default). */
  maxSize?: number
  /** file: accepted MIME types (empty ⇒ any). */
  mimeTypes?: string[]
}

/** A NEW content type — `POST /v1/superbase/collections` body. Base injects the `id` field. */
export interface CollectionInput {
  name: string
  /** `base` (default) | `auth` | `view`. */
  type?: string
  fields: CollectionFieldInput[]
}

export interface BaseDataApiOptions {
  /** Base API root. Same-origin `/v1/superbase` (the console's proxy to the managed
   *  Base), or a direct versioned origin `https://x.base.hanzo.ai/v1`. */
  baseUrl: string
  /** Optional Base auth token; sent as `Authorization: Bearer <token>` (else the
   *  caller's own PKCE access token is attached). */
  token?: string
}

/** Resolve a same-origin base URL (`/v1/superbase`) against the page origin. */
const pageOrigin = (): string => (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')

/** Pull a list out of `{ items }` (paginated) or a bare array. */
function asItems<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[]
  if (body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items)) {
    return (body as { items: T[] }).items
  }
  return []
}

/** Normalize a records response into a `BaseListResult` (paginated or bare array). */
function asListResult<T>(body: unknown): BaseListResult<T> {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const o = body as Partial<BaseListResult<T>>
    if (Array.isArray(o.items)) {
      return {
        page: o.page ?? 1,
        perPage: o.perPage ?? o.items.length,
        totalItems: o.totalItems ?? o.items.length,
        totalPages: o.totalPages ?? 1,
        items: o.items,
      }
    }
  }
  const items = asItems<T>(body)
  return { page: 1, perPage: items.length, totalItems: items.length, totalPages: 1, items }
}

/** Best-effort human message from a Base error body (`{ message }` / `{ msg }`). */
async function errorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { message?: unknown; msg?: unknown; error?: unknown }
    if (typeof j?.message === 'string' && j.message) return j.message
    if (typeof j?.msg === 'string' && j.msg) return j.msg
    // `error` is the plain-REST shape (e.g. the paywall's 402
    // {"error":"subscription_required"}); without it the reason is lost.
    if (typeof j?.error === 'string' && j.error) return j.error
  } catch {
    // non-JSON body — fall through to the status line
  }
  return `Request failed (HTTP ${res.status})`
}

export class BaseDataApi {
  private readonly baseUrl: string
  private readonly token?: string

  constructor(opts: BaseDataApiOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.token = opts.token
  }

  /** List every collection schema — `GET /v1/superbase/collections`. */
  async listCollections(): Promise<BaseCollection[]> {
    return asItems<BaseCollection>(await this.request('GET', 'collections'))
  }

  /** One collection's schema by name (from the list) — the ONE schema-read path,
   *  shared by the list + detail views. Returns `undefined` when it isn't visible. */
  async getCollection(name: string): Promise<BaseCollection | undefined> {
    return (await this.listCollections()).find((c) => c.name === name)
  }

  /**
   * Create a content type — `POST /v1/superbase/collections`. Base gates this behind its
   * superuser check (an org admin's minted token qualifies) and scopes it to the
   * caller's org (the proxy stamps `X-Org-Id` from the JWT owner), so the new
   * collection persists to THIS org's Base only. Base injects the `id` primary key.
   */
  async createCollection(input: CollectionInput): Promise<BaseCollection> {
    const body: Record<string, unknown> = {
      name: input.name,
      type: input.type ?? 'base',
      fields: input.fields,
    }
    return (await this.request('POST', 'collections', { body })) as BaseCollection
  }

  /** Delete a content type — `DELETE /v1/superbase/collections/<name>` (superuser-gated, 204). */
  async deleteCollection(name: string): Promise<void> {
    await this.request('DELETE', `collections/${encodeURIComponent(name)}`)
  }

  /** List one collection's records — `GET /v1/superbase/collections/<name>/records`. */
  async listRecords(collection: string, params?: ListRecordsParams): Promise<BaseListResult<BaseRecord>> {
    return asListResult<BaseRecord>(await this.request('GET', this.records(collection), { query: params }))
  }

  /** One record — `GET /v1/superbase/collections/<name>/records/<id>`. */
  async getRecord(collection: string, id: string): Promise<BaseRecord> {
    return (await this.request('GET', this.records(collection, id))) as BaseRecord
  }

  /** Create a record — `POST /v1/superbase/collections/<name>/records`. */
  async createRecord(collection: string, body: Record<string, unknown>): Promise<BaseRecord> {
    return (await this.request('POST', this.records(collection), { body })) as BaseRecord
  }

  /** Update a record — `PATCH /v1/superbase/collections/<name>/records/<id>`. */
  async updateRecord(collection: string, id: string, body: Record<string, unknown>): Promise<BaseRecord> {
    return (await this.request('PATCH', this.records(collection, id), { body })) as BaseRecord
  }

  /** Delete a record — `DELETE /v1/superbase/collections/<name>/records/<id>` (204, no body). */
  async deleteRecord(collection: string, id: string): Promise<void> {
    await this.request('DELETE', this.records(collection, id))
  }

  /** The records path for a collection (+ optional record id), each segment encoded. */
  private records(collection: string, id?: string): string {
    const base = `collections/${encodeURIComponent(collection)}/records`
    return id === undefined ? base : `${base}/${encodeURIComponent(id)}`
  }

  private async request(
    method: string,
    path: string,
    opts?: { query?: ListRecordsParams; body?: Record<string, unknown> },
  ): Promise<unknown> {
    // `baseUrl` carries the API root: same-origin `/v1/superbase` (the console's
    // proxy to the managed Base) or a direct `https://x.base.hanzo.ai/v1`.
    const url = new URL(`${this.baseUrl}/${path}`, pageOrigin())
    if (opts?.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
      }
    }

    const headers: Record<string, string> = { Accept: 'application/json' }
    // The credential a BYO Base needs, since nothing stands in front of it: an explicit
    // `token`, else the caller's own PKCE access token. On the same-origin
    // `/v1/superbase` root the proxy mints its own user-bound token from the session
    // cookie and forwards that instead, so these two headers are only a hint there.
    const bearer = this.token ?? iamAccessToken()
    if (bearer) headers.Authorization = `Bearer ${bearer}`
    // Active org scope (org-switch aware), like every cloud call. The trusted org is
    // re-derived from the Bearer owner server-side and may override this.
    headers['X-Org-Id'] = currentOrg()
    const init: RequestInit = { method, credentials: 'include', headers }
    if (opts?.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(opts.body)
    }

    let res: Response
    try {
      res = await fetch(url.toString(), init)
    } catch (e) {
      throw new ApiError(e instanceof Error ? e.message : 'Network request failed')
    }

    if (!res.ok) throw new ApiError(await errorMessage(res), res.status)

    // 204 No Content (a successful DELETE) — nothing to parse.
    if (res.status === 204 || res.headers.get('content-length') === '0') return null

    try {
      return await res.json()
    } catch {
      throw new ApiError(`Invalid response from Base (HTTP ${res.status})`, res.status)
    }
  }
}
