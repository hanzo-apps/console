import { describe, it, expect } from 'vitest'

import type { Store } from '~/lib/api/types'
import {
  collectionName,
  collectionStatus,
  toCollection,
  isEmbeddingModel,
  embeddingModelDimension,
  modelShares,
  normalizeCloudUsages,
  emptyUsages,
  type Collection,
} from './logic'

const store = (over: Partial<Store> = {}): Store => ({ owner: 'hanzo', name: 'docs', ...over })

describe('collectionName — the {owner}-{store}-docs Qdrant/Search convention', () => {
  it('builds the canonical collection name', () => {
    expect(collectionName('hanzo', 'docs')).toBe('hanzo-docs-docs')
    expect(collectionName('adnexus', 'kb')).toBe('adnexus-kb-docs')
  })
})

describe('collectionStatus — honest mapping (no invented health)', () => {
  it('maps active/empty to Healthy (casibase default state is Active)', () => {
    expect(collectionStatus('Active')).toBe('Healthy')
    expect(collectionStatus('')).toBe('Healthy')
    expect(collectionStatus(undefined)).toBe('Healthy')
  })
  it('maps inactive/paused to Paused', () => {
    expect(collectionStatus('Inactive')).toBe('Paused')
    expect(collectionStatus('paused')).toBe('Paused')
  })
  it('live indexing overrides to Rebuilding', () => {
    expect(collectionStatus('Active', true)).toBe('Rebuilding')
    expect(collectionStatus('Inactive', true)).toBe('Rebuilding')
  })
  it('unknown free-form state is Unknown, not guessed', () => {
    expect(collectionStatus('Weird')).toBe('Unknown')
  })
})

describe('toCollection — store projection leaves absent stats undefined (renders "—")', () => {
  it('projects identity, description, model, metric and the collection name', () => {
    const c = toCollection(store({ name: 'kb', title: 'Knowledge', embeddingProvider: 'zen3-embedding', state: 'Active', createdTime: '2026-01-02' }))
    expect(c).toMatchObject({
      owner: 'hanzo',
      name: 'kb',
      description: 'Knowledge',
      model: 'zen3-embedding',
      metric: 'cosine',
      collection: 'hanzo-kb-docs',
      status: 'Healthy',
      created: '2026-01-02',
    })
  })
  it('NEVER fabricates vectors/dimension/size — they are undefined (no such store field)', () => {
    const c = toCollection(store({ knowledgeCount: 5 }))
    expect(c.vectors).toBeUndefined()
    expect(c.dimension).toBeUndefined()
    expect(c.sizeBytes).toBeUndefined()
    expect(c.knowledgeCount).toBe(5) // retrieval-K config, surfaced as itself
  })
  it('falls back description through displayName then name', () => {
    expect(toCollection(store({ displayName: 'Disp' })).description).toBe('Disp')
    expect(toCollection(store({ name: 'only' })).description).toBe('only')
  })
})

describe('isEmbeddingModel — id-convention filter (no category field exists)', () => {
  it('accepts the real embedding ids', () => {
    for (const id of ['zen3-embedding', 'zen5-embedding-8B', 'text-embedding-3-small', 'text-embedding-ada-002'])
      expect(isEmbeddingModel(id)).toBe(true)
  })
  it('rejects chat/instruct models', () => {
    for (const id of ['zen-coder', 'gpt-4o', 'claude-opus', 'qwen3-32b'])
      expect(isEmbeddingModel(id)).toBe(false)
  })
})

describe('embeddingModelDimension — published dims only, never guessed', () => {
  it('resolves known models case-insensitively', () => {
    expect(embeddingModelDimension('text-embedding-3-large')).toBe(3072)
    expect(embeddingModelDimension('ZEN5-Embedding-8B')).toBe(4096)
  })
  it('returns undefined for an unknown model (no guess)', () => {
    expect(embeddingModelDimension('some-new-embed-model')).toBeUndefined()
  })
})

describe('modelShares — real collection counts grouped by embedding model', () => {
  it('groups, labels Unset, and sorts by count desc', () => {
    const cols: Collection[] = [
      toCollection(store({ name: 'a', embeddingProvider: 'zen3-embedding' })),
      toCollection(store({ name: 'b', embeddingProvider: 'zen3-embedding' })),
      toCollection(store({ name: 'c', embeddingProvider: '' })),
    ]
    expect(modelShares(cols)).toEqual([
      { label: 'zen3-embedding', value: 2 },
      { label: 'Unset', value: 1 },
    ])
  })
})

describe('normalizeCloudUsages — forward-compatible, degrades to absent', () => {
  it('an empty/404 payload yields all-absent metrics (the honest "—" state)', () => {
    const u = normalizeCloudUsages(undefined)
    expect(u.vectors.value).toBeUndefined()
    expect(u.vectors.series).toBeUndefined()
    expect(u.models).toEqual([])
    expect(u.dimensions).toEqual([])
    expect(u).toEqual(emptyUsages())
  })
  it('reads values, a ≥2-point series, a delta, and breakdowns when present', () => {
    const u = normalizeCloudUsages({
      vectors: 1280,
      storageBytes: 4096,
      queries: 53,
      avgLatencyMs: 12,
      costCents: 250,
      series: { vectors: [1, 2, 3], queries: [5] },
      deltas: { vectorsPct: 0.12 },
      models: [{ model: 'zen3-embedding', vectors: 1000 }, { model: 'x', vectors: 0 }],
      dimensions: [{ dimension: 1024, vectors: 800 }],
    })
    expect(u.vectors.value).toBe(1280)
    expect(u.vectors.series).toEqual([1, 2, 3])
    expect(u.vectors.deltaPct).toBe(0.12)
    expect(u.queries.series).toBeUndefined() // a 1-point series is not a trend
    expect(u.models).toEqual([{ label: 'zen3-embedding', value: 1000 }]) // 0-value dropped
    expect(u.dimensions).toEqual([{ label: '1024d', value: 800 }])
  })
})

import { embeddingsCodeSamples, defaultEmbeddingModel } from './logic'

const col = (over: Partial<Collection> = {}): Collection => ({
  owner: 'hanzo',
  name: 'docs',
  description: 'Docs',
  model: '',
  metric: 'cosine',
  collection: 'hanzo-docs-docs',
  status: 'Healthy',
  ...over,
})

describe('defaultEmbeddingModel', () => {
  it('prefers the org’s most-used collection model, else zen-embedding', () => {
    expect(defaultEmbeddingModel([])).toBe('zen-embedding')
    expect(defaultEmbeddingModel([col({ model: '' })])).toBe('zen-embedding')
    expect(
      defaultEmbeddingModel([
        col({ model: 'zen5-embedding-4b' }),
        col({ model: 'zen5-embedding-4b' }),
        col({ model: 'text-embedding-3-small' }),
      ]),
    ).toBe('zen5-embedding-4b')
  })
})

describe('embeddingsCodeSamples — the real POST /v1/embeddings call', () => {
  const samples = embeddingsCodeSamples('https://api.hanzo.ai/v1', 'zen-embedding')

  it('offers curl / python / ts / js tabs', () => {
    expect(samples.map((s) => s.lang)).toEqual(['curl', 'python', 'ts', 'js'])
  })

  it('curl hits the real endpoint with the model and a bearer key', () => {
    const curl = samples.find((s) => s.lang === 'curl')!.code
    expect(curl).toContain('https://api.hanzo.ai/v1/embeddings')
    expect(curl).toContain('"model": "zen-embedding"')
    expect(curl).toContain('Authorization: Bearer')
  })

  it('every sample references the embeddings endpoint and the model', () => {
    for (const s of samples) {
      expect(s.code).toContain('zen-embedding')
      expect(s.code.toLowerCase()).toContain('embeddings')
    }
  })
})
