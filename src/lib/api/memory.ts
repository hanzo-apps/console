/**
 * Memory API — the user's personal memory store on the cloud `/v1` backend
 * (hanzoai/ai). Plain REST over `/v1/memory` (restGet/restPost): the backend
 * returns raw JSON (200) or an error body; tenancy is server-side — the gateway
 * scopes every call to the caller from the validated session, so the browser
 * sends cookie credentials only and never an owner/user in the body.
 *
 * Until the Go backend is deployed every route 404s; callers render an honest
 * "initializing" state and never fabricate memories.
 *
 * Contract (per HIP memory spec): remember/search/list/recall/update/delete/facts.
 * One memory: { id, kind, content, metadata?, createdAt }.
 */
import { restGet, restPost, v1Url } from './client'

/** A memory's kind — what it represents / how it was captured. */
export type MemoryKind = 'user' | 'feedback' | 'project' | 'reference' | 'fact'

/** Every kind, in display order (also the create/filter option set). */
export const MEMORY_KINDS: readonly MemoryKind[] = ['user', 'feedback', 'project', 'reference', 'fact']

/** One stored memory, as the backend returns it. */
export type Memory = {
  id: string
  kind: MemoryKind
  content: string
  metadata?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

/** A structured fact (the `/facts` surface) — a memory distilled to a relation. */
export type MemoryFact = {
  id: string
  subject?: string
  predicate?: string
  object?: string
  content?: string
  metadata?: Record<string, unknown>
  createdAt?: string
}

/** Create/update payloads. */
export type RememberInput = { kind: MemoryKind; content: string; metadata?: Record<string, unknown> }
export type UpdateInput = { id: string; kind?: MemoryKind; content?: string; metadata?: Record<string, unknown> }

const u = (path: string): string => v1Url(`memory/${path.replace(/^\/+/, '')}`)

/**
 * Unwrap a list response. The list-envelope isn't pinned in the contract yet, so
 * accept either a bare array or the common wrappers — robust parsing of a
 * not-yet-frozen shape, never invented rows (an unknown shape yields `[]`).
 */
function rows<T>(r: unknown, ...keys: string[]): T[] {
  if (Array.isArray(r)) return r as T[]
  if (r && typeof r === 'object') {
    for (const k of keys) {
      const v = (r as Record<string, unknown>)[k]
      if (Array.isArray(v)) return v as T[]
    }
  }
  return []
}

const LIST_KEYS = ['memories', 'items', 'results', 'data'] as const
const FACT_KEYS = ['facts', 'items', 'results', 'data'] as const

export const MemoryApi = {
  /** All memories, newest first — optionally filtered to one kind. */
  list: async (kind?: MemoryKind): Promise<Memory[]> => {
    const q = kind ? `?kind=${encodeURIComponent(kind)}` : ''
    return rows<Memory>(await restGet<unknown>(u(`list${q}`)), ...LIST_KEYS)
  },

  /** Semantic + text search across memories. */
  search: async (q: string, kind?: MemoryKind): Promise<Memory[]> => {
    const p = new URLSearchParams({ q })
    if (kind) p.set('kind', kind)
    return rows<Memory>(await restGet<unknown>(u(`search?${p.toString()}`)), ...LIST_KEYS)
  },

  /** Recall the most relevant/recent memories (optionally for a query). */
  recall: async (q?: string): Promise<Memory[]> => {
    const query = q ? `?q=${encodeURIComponent(q)}` : ''
    return rows<Memory>(await restGet<unknown>(u(`recall${query}`)), ...LIST_KEYS)
  },

  /** Structured facts distilled from memory. */
  facts: async (): Promise<MemoryFact[]> =>
    rows<MemoryFact>(await restGet<unknown>(u('facts')), ...FACT_KEYS),

  /** Store a new memory; the backend echoes the created row. */
  remember: (input: RememberInput): Promise<Memory> => restPost<Memory>(u('remember'), input),

  /** Update an existing memory's content/kind/metadata. */
  update: (input: UpdateInput): Promise<Memory> => restPost<Memory>(u('update'), input),

  /** Delete a memory by id (POST, per the contract — not a REST DELETE). */
  remove: async (id: string): Promise<void> => {
    await restPost(u('delete'), { id })
  },
}
