/**
 * BaseDataApi — a tiny typed client for a Hanzo Base (hanzoai/base) instance's
 * `/v1` REST surface. Two reads power the data views: list the collections (their
 * schemas) and list a collection's records.
 *
 * A Base instance speaks plain JSON REST (NOT the cloud casibase
 * `{status,msg,data}` envelope), so this does NOT reuse the cloud `/v1` client.
 * It shares only the app's one typed `ApiError` so a Base failure flows through
 * the same honest-state UI (`classifyBackend` / `BackendStateCard`). Transport
 * stays its own concern; only the error value type is shared.
 *
 * Auth: an optional Base bearer token (`Authorization: Bearer <token>` — Base
 * strips the case-insensitive prefix). `credentials: 'include'` so the same-origin
 * proxy form (cookie session injecting the token server-side) also works.
 */
import { ApiError } from '~/lib/api/client'
import type { BaseCollection } from './fields'

/** A Base record — a flat map of field name → value (`id` always present). */
export type BaseRecord = Record<string, unknown> & { id?: string }

/** PocketBase-style paginated list result. */
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

export interface BaseDataApiOptions {
  /** Base origin or same-origin proxy prefix (e.g. `/superbase` or `https://x.base.hanzo.ai`). */
  baseUrl: string
  /** Optional Base auth token; sent as `Authorization: Bearer <token>`. */
  token?: string
}

/** Resolve same-origin proxy prefixes (`/superbase`) against the page origin. */
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
    const j = (await res.json()) as { message?: unknown; msg?: unknown }
    if (typeof j?.message === 'string' && j.message) return j.message
    if (typeof j?.msg === 'string' && j.msg) return j.msg
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

  /** List every collection schema — `GET /v1/collections`. */
  async listCollections(): Promise<BaseCollection[]> {
    return asItems<BaseCollection>(await this.get('collections'))
  }

  /** List one collection's records — `GET /v1/collections/<name>/records`. */
  async listRecords(collection: string, params?: ListRecordsParams): Promise<BaseListResult<BaseRecord>> {
    return asListResult<BaseRecord>(await this.get(`collections/${encodeURIComponent(collection)}/records`, params))
  }

  private async get(path: string, query?: ListRecordsParams): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/v1/${path}`, pageOrigin())
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
      }
    }

    let res: Response
    try {
      res = await fetch(url.toString(), {
        method: 'GET',
        credentials: 'include',
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      })
    } catch (e) {
      throw new ApiError(e instanceof Error ? e.message : 'Network request failed')
    }

    if (!res.ok) throw new ApiError(await errorMessage(res), res.status)

    try {
      return await res.json()
    } catch {
      throw new ApiError(`Invalid response from Base (HTTP ${res.status})`, res.status)
    }
  }
}
