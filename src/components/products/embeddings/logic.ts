/**
 * Embeddings domain logic — PURE, no UI, no transport (types only, erased).
 *
 * Collections ARE the per-org knowledge stores (`/v1/get-stores`); a store maps
 * to a vector collection named `{owner}-{store}-docs` (object/search_docs.go
 * `GetSearchIndexName`). The store object does NOT carry live vector stats
 * (count / dimension / index bytes) or an `updatedTime`, and the distance metric
 * is fixed to cosine at collection-create time — so this module exposes those as
 * honest "absent" (undefined → the view renders "—") and never fabricates them.
 *
 * The richer per-product series (vector count, storage, queries, latency, cost,
 * per-model + per-dimension breakdowns) is the shape of the forthcoming
 * `GET /v1/get-cloud-usages` read API. We model that shape here and normalize it
 * defensively, so the page lights up automatically when the endpoint ships and
 * degrades to "—" until then.
 */
import type { Store } from '~/lib/api/types'
import type { Slice } from '@hanzo/ui/product'

/** Honest lifecycle of a collection's index. */
export type CollectionStatus = 'Healthy' | 'Rebuilding' | 'Paused' | 'Unknown'

/** A collection row — a store projected to the embeddings surface. */
export type Collection = {
  owner: string
  /** Store name (the collection id within the org). */
  name: string
  /** Human description (title → displayName → name). */
  description: string
  /** Embedding model/provider backing the collection (store.embeddingProvider). */
  model: string
  /** Distance metric — fixed to cosine at Qdrant collection-create time. */
  metric: 'cosine'
  /** The Qdrant/Search collection name: `{owner}-{store}-docs`. */
  collection: string
  /** Lifecycle status from the store state (enrich with live indexing separately). */
  status: CollectionStatus
  /** Created time (the only timestamp the store carries; no updatedTime exists). */
  created?: string
  /** RAG retrieval-K config — NOT a live vector count. */
  knowledgeCount?: number
  /** Live vector count — absent from the store API (undefined → "—"). */
  vectors?: number
  /** Embedding dimension — absent from the store API (undefined → "—"). */
  dimension?: number
  /** Index size in bytes — absent from the store API (undefined → "—"). */
  sizeBytes?: number
}

/** The Search/Qdrant collection name for a store — `{owner}-{store}-docs`. */
export function collectionName(owner: string, store: string): string {
  return `${owner}-${store}-docs`
}

/** Map a store's state (+ optional live indexing flag) to an honest status. */
export function collectionStatus(state?: string, isIndexing?: boolean): CollectionStatus {
  if (isIndexing) return 'Rebuilding'
  const s = (state ?? '').toLowerCase()
  if (s === '' || s === 'active') return 'Healthy'
  if (s === 'inactive' || s === 'paused') return 'Paused'
  return 'Unknown'
}

/** Project a store onto the collection view-model (pure; no live enrichment). */
export function toCollection(store: Store): Collection {
  return {
    owner: store.owner,
    name: store.name,
    description: store.title || store.displayName || store.name,
    model: store.embeddingProvider || '',
    metric: 'cosine',
    collection: collectionName(store.owner, store.name),
    status: collectionStatus(store.state),
    created: store.createdTime,
    knowledgeCount: typeof store.knowledgeCount === 'number' ? store.knowledgeCount : undefined,
    // Live vector stats are not on the store object — left undefined (renders "—").
    vectors: undefined,
    dimension: undefined,
    sizeBytes: undefined,
  }
}

/**
 * Published embedding dimensions for the canonical models, used to LABEL a known
 * model with its real output dimension. Only used where a model id is known; an
 * unknown model resolves to `undefined` (never guessed). These are the real,
 * published dims — not invented.
 */
export const EMBEDDING_DIMENSIONS: Record<string, number> = {
  'zen-embedding': 1024,
  'zen3-embedding': 1024,
  'zen5-embedding-0.6b': 1024,
  'zen5-embedding-4b': 2560,
  'zen5-embedding-8b': 4096,
  'qwen3-embedding-0.6b': 1024,
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
}

/** Published dimension for a known embedding model id (case-insensitive), else undefined. */
export function embeddingModelDimension(model: string): number | undefined {
  return EMBEDDING_DIMENSIONS[model.trim().toLowerCase()]
}

/**
 * Is this `/v1/models` id an embedding model? The gateway exposes no category, so
 * we match the id convention (`*embedding*` / `*-embed*` / `text-embedding-*`).
 */
export function isEmbeddingModel(id: string): boolean {
  return /embedding|(?:^|[-_])embed(?:$|[-_])/i.test(id)
}

/** Donut data: collections grouped by embedding model/provider (real counts). */
export function modelShares(collections: Collection[]): Slice[] {
  const counts = new Map<string, number>()
  for (const c of collections) {
    const key = c.model || 'Unset'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
}

// ── Cloud-usage read API (GET /v1/get-cloud-usages) — modeled, normalized ──────

/** One headline metric with an optional sparkline series and vs-prior delta. */
export type UsageMetric = {
  /** Current value, or undefined when the read API doesn't report it (renders "—"). */
  value?: number
  /** Time series for the sparkline (omitted → no sparkline, never a fake line). */
  series?: number[]
  /** Fractional change vs the prior window (e.g. 0.12 = +12%); omitted → no delta. */
  deltaPct?: number
}

/** The embeddings slice of the cloud-usage read API (forward-compatible shape). */
export type CloudUsages = {
  vectors: UsageMetric
  storageBytes: UsageMetric
  queries: UsageMetric
  latencyMs: UsageMetric
  costCents: UsageMetric
  /** Per-model vector counts (donut), when reported. */
  models: Slice[]
  /** Per-dimension vector counts (bar chart), when reported. */
  dimensions: Slice[]
}

const numOrU = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

const seriesOrU = (v: unknown): number[] | undefined =>
  Array.isArray(v) && v.length >= 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? (v as number[])
    : undefined

/** Read a metric from any of several documented key spellings, defensively. */
function metricFrom(root: Record<string, unknown>, keys: string[], seriesKey: string, deltaKey: string): UsageMetric {
  let value: number | undefined
  for (const k of keys) {
    value = numOrU(root[k])
    if (value !== undefined) break
  }
  const series = seriesOrU((root.series as Record<string, unknown> | undefined)?.[seriesKey])
  const deltaPct = numOrU((root.deltas as Record<string, unknown> | undefined)?.[deltaKey])
  return { value, series, deltaPct }
}

const breakdown = (v: unknown, labelKey: string, altLabel: string): Slice[] =>
  Array.isArray(v)
    ? v
        .map((r) => {
          const row = (r ?? {}) as Record<string, unknown>
          const label = typeof row[labelKey] === 'string' ? (row[labelKey] as string) : String(row[altLabel] ?? '')
          const value = numOrU(row.vectors) ?? numOrU(row.count) ?? numOrU(row.value) ?? 0
          return { label: label || '—', value }
        })
        .filter((s) => s.value > 0)
    : []

/** Normalize the cloud-usage payload into the embeddings metric model (defensive). */
export function normalizeCloudUsages(payload: unknown): CloudUsages {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  return {
    vectors: metricFrom(root, ['vectors', 'vectorCount', 'totalVectors'], 'vectors', 'vectorsPct'),
    storageBytes: metricFrom(root, ['storageBytes', 'storage', 'bytes'], 'storageBytes', 'storagePct'),
    queries: metricFrom(root, ['queries', 'queryCount'], 'queries', 'queriesPct'),
    latencyMs: metricFrom(root, ['avgLatencyMs', 'latencyMs', 'latency'], 'latencyMs', 'latencyPct'),
    costCents: metricFrom(root, ['costCents', 'cents'], 'costCents', 'costPct'),
    models: breakdown(root.models, 'model', 'name'),
    dimensions: breakdown(root.dimensions, 'dimension', 'dimension').map((s) => ({
      ...s,
      label: /^\d+$/.test(s.label) ? `${s.label}d` : s.label,
    })),
  }
}

/** An empty usage model — every metric absent (the honest pre-metering state). */
export function emptyUsages(): CloudUsages {
  const m: UsageMetric = {}
  return { vectors: m, storageBytes: m, queries: m, latencyMs: m, costCents: m, models: [], dimensions: [] }
}

// ── Landing code samples (the real POST /v1/embeddings call) ─────────────────

/** The default embedding model to show in code samples — the org's most-used, else Zen. */
export function defaultEmbeddingModel(collections: Collection[]): string {
  const top = modelShares(collections).find((s) => s.label && s.label !== 'Unset')
  return top?.label || 'zen-embedding'
}

/**
 * The REAL `POST /v1/embeddings` call, rendered in curl / Python / TS / JS for the
 * interactive code block. `apiBase` is the brand API base (e.g. https://api.hanzo.ai/v1).
 * The shape is structurally the landing kit's `CodeSample` (assignable without a runtime
 * import, so this stays pure + node-testable).
 */
export function embeddingsCodeSamples(
  apiBase: string,
  model: string,
): { lang: 'curl' | 'python' | 'ts' | 'js'; label: string; code: string }[] {
  const input = 'The quick brown fox jumps over the lazy dog'
  return [
    {
      lang: 'curl',
      label: 'cURL',
      code: [
        `curl ${apiBase}/embeddings \\`,
        `  -H "Authorization: Bearer $HANZO_API_KEY" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '{`,
        `    "model": "${model}",`,
        `    "input": "${input}"`,
        `  }'`,
      ].join('\n'),
    },
    {
      lang: 'python',
      label: 'Python',
      code: [
        `from openai import OpenAI`,
        ``,
        `client = OpenAI(base_url="${apiBase}", api_key="YOUR_HANZO_API_KEY")`,
        ``,
        `resp = client.embeddings.create(`,
        `    model="${model}",`,
        `    input="${input}",`,
        `)`,
        `print(resp.data[0].embedding[:8])`,
      ].join('\n'),
    },
    {
      lang: 'ts',
      label: 'TypeScript',
      code: [
        `import OpenAI from "openai"`,
        ``,
        `const client = new OpenAI({ baseURL: "${apiBase}", apiKey: process.env.HANZO_API_KEY })`,
        ``,
        `const resp = await client.embeddings.create({`,
        `  model: "${model}",`,
        `  input: "${input}",`,
        `})`,
        `console.log(resp.data[0].embedding.slice(0, 8))`,
      ].join('\n'),
    },
    {
      lang: 'js',
      label: 'JavaScript',
      code: [
        `const res = await fetch("${apiBase}/embeddings", {`,
        `  method: "POST",`,
        `  headers: {`,
        `    Authorization: \`Bearer \${process.env.HANZO_API_KEY}\`,`,
        `    "Content-Type": "application/json",`,
        `  },`,
        `  body: JSON.stringify({ model: "${model}", input: "${input}" }),`,
        `})`,
        `const { data } = await res.json()`,
        `console.log(data[0].embedding.slice(0, 8))`,
      ].join('\n'),
    },
  ]
}
