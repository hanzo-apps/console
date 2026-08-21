/**
 * Embeddings API — the ONE console-side surface over the real `hanzoai/ai` `/v1`.
 *
 * It composes existing clients (no parallel transport): collections are knowledge
 * STORES (`StoreApi`), models are the gateway catalog (`CloudModelApi`), and the
 * remaining calls reach the cloud `/v1` through the console's OWN `/v1` user-bearer
 * proxy (the live ingress does not rewrite bare `/v1/*`). Each call uses the transport
 * its endpoint speaks:
 *   - envelope (`{status,msg,data}`): ai/stores, ai/usages/cloud, ai/files,
 *     ai/rag/ingest, index                     → `cloudGet`/`cloudPost` (→ /v1)
 *   - raw JSON: search (`{hits}`), search/stats (`{documentCount,…}`) → `restGet`/`restPost`
 *     on `cloudProxyV1Url` (→ /v1)
 *   - OpenAI gateway (Bearer-only): embeddings  → the keyless `/ai` proxy (`originV1Url`)
 *
 * Every call throws `ApiError` (with status) on failure so callers render an
 * honest state — collections list real/empty, and absent fields ("—") and absent
 * endpoints (404 → BackendStateCard) are never papered over with fabricated data.
 */
import { cloudGet, cloudPost, restGet, restPost, cloudProxyV1Url, originV1Url } from './client'
import { config } from '~/config'
import { StoreApi } from './stores'
import { CloudModelApi, type CatalogModel } from './models-catalog'
import type { Store } from './types'
import {
  toCollection,
  isEmbeddingModel,
  normalizeCloudUsages,
  type Collection,
  type CloudUsages,
} from '~/components/products/embeddings/logic'

// ── Search (POST /v1/search?store=…, raw {hits}) ─────────────────────────────

/** One search hit, mapped from the backend `DocSearchResult`. */
export type EmbeddingHit = {
  id: string
  /** Best title — last breadcrumb → url tail → first line of content. */
  title: string
  /** Source locator — breadcrumb trail or the source url (no file-path field exists). */
  path: string
  /** Matched content snippet. */
  snippet: string
  /**
   * Similarity score — the backend's hybrid `/v1/search` does NOT return a score
   * (it RRF-merges internally and drops the per-hit score), so this is undefined
   * and the view shows "—" rather than a fabricated number.
   */
  score?: number
}

type RawHit = { id?: string; url?: string; type?: string; content?: string; breadcrumbs?: string[] }

const firstLine = (s: string): string => {
  const line = s.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  return line.length > 80 ? `${line.slice(0, 80)}…` : line
}

const titleOf = (h: RawHit): string => {
  const crumbs = h.breadcrumbs ?? []
  if (crumbs.length) return crumbs[crumbs.length - 1]
  if (h.url) return h.url.split('/').filter(Boolean).pop() ?? h.url
  return firstLine(h.content ?? '') || 'Result'
}

const pathOf = (h: RawHit): string => {
  const crumbs = h.breadcrumbs ?? []
  if (crumbs.length) return crumbs.join(' / ')
  return h.url ?? ''
}

/** Search modes the backend accepts (`hybrid` is the default). */
export type SearchMode = 'hybrid' | 'vector' | 'fulltext'

export type SearchInput = { store: string; query: string; topK?: number; mode?: SearchMode }

// ── Cloud usage / index stats / files / generate / ingest ────────────────────

/** Live index stats for a collection (`GET /v1/search/stats`, Meilisearch-backed). */
export type IndexStats = {
  /** Indexed document count (≈ vectors; the API exposes doc count, not vector count). */
  documentCount?: number
  /** Whether the index is rebuilding right now. */
  isIndexing?: boolean
}

/** A per-file index row (`GET /v1/ai/files`) — the nearest thing to an ingest job. */
export type FileRow = {
  owner: string
  name: string
  store?: string
  /** Pending | Processing | Finished | Error. */
  status?: string
  errorText?: string
  tokenCount?: number
  createdTime?: string
}

/** OpenAI embeddings response (the fields the Models tab surfaces). */
export type EmbeddingResult = {
  model?: string
  data?: { index?: number; embedding?: number[] }[]
  usage?: { prompt_tokens?: number; total_tokens?: number }
  error?: { message?: string }
}

/** Documents source for ingest (matches the backend `IngestRequest.Source` enum). */
export type IngestSource = 'upload' | 'github' | 'crawl' | 's3'

/** Ingest result (`object.IngestStats`). */
export type IngestStats = {
  source?: string
  store?: string
  indexName?: string
  filesIngested?: number
  filesSkipped?: number
  documentsIndexed?: number
  errors?: string[]
  /**
   * Set when a long source (github/crawl/s3) was enqueued as a durable hanzoai/tasks
   * workflow instead of run inline — progress is tracked in the ONE Tasks product by
   * this workflow id (there is no bespoke job entity).
   */
  async?: boolean
  workflowId?: string
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

export const EmbeddingsApi = {
  /** Collections = the org's knowledge stores, projected to the embeddings view. */
  collections: async (owner: string): Promise<Collection[]> => {
    const stores = await StoreApi.list(owner)
    return (stores ?? []).map(toCollection)
  },

  /** Raw stores (for create/edit reuse). */
  stores: (owner: string): Promise<Store[]> => StoreApi.list(owner).then((s) => s ?? []),

  /**
   * The embeddings slice of the cloud-usage read API. 404s until
   * `feat/cloud-usage-read-api` ships — callers catch and degrade to "—".
   */
  cloudUsages: async (days = 7): Promise<CloudUsages> => {
    const data = await cloudGet<unknown>('ai/usages/cloud', { category: 'embeddings', days })
    return normalizeCloudUsages(data)
  },

  /** Top-K search over a collection. Hybrid by default; scores are absent (see EmbeddingHit). */
  search: async ({ store, query, topK = 8, mode = 'hybrid' }: SearchInput): Promise<EmbeddingHit[]> => {
    const url = `${cloudProxyV1Url('search')}?store=${encodeURIComponent(store)}`
    const res = await restPost<{ hits?: RawHit[] }>(url, { query, limit: topK, mode })
    return (res?.hits ?? []).map((h, i) => ({
      id: h.id ?? `hit-${i}`,
      title: titleOf(h),
      path: pathOf(h),
      snippet: h.content ?? '',
      score: undefined,
    }))
  },

  /** Best-effort live index stats for one collection. Never throws — degrades to {}. */
  indexStats: async (store: string): Promise<IndexStats> => {
    try {
      const url = `${cloudProxyV1Url('search/stats')}?store=${encodeURIComponent(store)}`
      const r = await restGet<{ documentCount?: number; isIndexing?: boolean }>(url)
      return { documentCount: num(r?.documentCount), isIndexing: r?.isIndexing === true }
    } catch {
      return {}
    }
  },

  /** Per-file index status across the org's stores (the Jobs surface). */
  files: async (owner: string): Promise<FileRow[]> => {
    const raw = await cloudGet<unknown[]>('ai/files', { owner })
    return (raw ?? []).map((r) => {
      const f = (r ?? {}) as Record<string, unknown>
      return {
        owner: str(f.owner) ?? owner,
        name: str(f.name) ?? '',
        store: str(f.store),
        status: str(f.status),
        errorText: str(f.errorText),
        tokenCount: num(f.tokenCount),
        createdTime: str(f.createdTime),
      }
    })
  },

  /** The embedding models the gateway exposes (filtered from `/v1/models` by id). */
  models: async (): Promise<CatalogModel[]> => {
    const all = await CloudModelApi.list()
    return all.filter((m) => isEmbeddingModel(m.id))
  },

  /** Generate an embedding vector via the keyless `/ai` proxy (Bearer added server-side). */
  generate: (model: string, input: string): Promise<EmbeddingResult> =>
    restPost<EmbeddingResult>(originV1Url('embeddings'), { model, input }),

  /** Ingest pasted text into a collection (source=upload — the balance-free path, inline). */
  ingestText: (store: string, name: string, content: string): Promise<IngestStats> =>
    cloudPost<IngestStats>('ai/rag/ingest', { store, source: 'upload', files: [{ name, content }] }).then((r) => r.data),

  /**
   * Ingest a GitHub repo (source=github) — the backend clones it, code-aware-chunks
   * every text/code blob (whole funcs/types per chunk), embeds + indexes into the store.
   * A long source runs as a durable tasks workflow → the result carries `async` +
   * `workflowId` (tracked in the Tasks product), never a bespoke job. `repo` = "owner/name".
   */
  ingestGitHub: (store: string, repo: string, ref?: string): Promise<IngestStats> =>
    cloudPost<IngestStats>('ai/rag/ingest', {
      store,
      source: 'github',
      github: { repo: repo.trim(), ...(ref?.trim() ? { ref: ref.trim() } : {}) },
    }).then((r) => r.data),

  /**
   * Ingest a crawled web page/site (source=crawl) — the backend fetches the URL (up to
   * `depth` links), extracts, chunks, embeds + indexes. Durable workflow like github.
   */
  ingestCrawl: (store: string, url: string, depth?: number): Promise<IngestStats> =>
    cloudPost<IngestStats>('ai/rag/ingest', {
      store,
      source: 'crawl',
      crawl: { url: url.trim(), ...(depth && depth > 0 ? { depth } : {}) },
    }).then((r) => r.data),

  /** Create a collection (the store). Reuses the same store create the Stores admin uses. */
  addStore: (store: Store) => StoreApi.add(store),

  /** Delete a collection by owner/name (the store member route keys on owner+name). */
  remove: (owner: string, name: string) => StoreApi.remove({ owner, name }),

  /** Re-index a collection — fetch the real store, then re-ingest its vectors. */
  refresh: async (owner: string, name: string) => {
    const s = await StoreApi.get(owner, name)
    return StoreApi.refreshVectors(s)
  },
}
