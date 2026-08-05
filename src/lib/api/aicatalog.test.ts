import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  modelId,
  modelContext,
  modelDisplayName,
  modelType,
  priceBucket,
  matchesQuery,
  groupByProvider,
  plansForTier,
  fetchCatalog,
  fetchPlans,
  type RichModel,
  type CatalogEntry,
} from './aicatalog'

/**
 * The catalog spine joins TWO real record shapes: first-party Zen models
 * (`context` + `name`) and third-party models (`contextWindow` + an `id` like
 * `openai/gpt-5`). These tests pin the normalizers, the availability cross-ref by
 * stable id, and the honest-empty plans read — the contracts the Models/Providers
 * pages (and later hanzo.ai / @hanzo/dev / desktop) depend on.
 */
const ORIGIN = 'https://console.hanzo.ai'

const zen: RichModel = { name: 'zen3-omni', provider: 'Hanzo', category: 'zen', context: 202000, tier: 'pro max', specs: { params: '~200B' }, pricing: { input: 1.5, output: 4.5 } }
const gpt5: RichModel = { id: 'openai/gpt-5', name: 'OpenAI: GPT-5', provider: 'OpenAI', contextWindow: 400000, pricing: { input: 1.25, output: 10 } }
const embed: RichModel = { id: 'openai/text-embedding-3', name: 'OpenAI: text-embedding-3', provider: 'OpenAI', contextWindow: 8192, pricing: { input: 0.02, output: 0 } }
const free: RichModel = { id: 'meta/llama-free', name: 'Meta: Llama Free', provider: 'Meta', contextWindow: 128000, isFree: true, pricing: { input: 0, output: 0 } }

describe('normalizers join both catalog shapes', () => {
  it('modelId prefers the stable third-party id, falls back to name', () => {
    expect(modelId(gpt5)).toBe('openai/gpt-5')
    expect(modelId(zen)).toBe('zen3-omni')
  })

  it('modelContext reads context OR contextWindow (the 339-model bug fix)', () => {
    expect(modelContext(zen)).toBe(202000)
    expect(modelContext(gpt5)).toBe(400000)
    expect(modelContext({ name: 'x' })).toBeNull()
  })

  it('modelDisplayName strips the "<provider>: " prefix on third-party rows', () => {
    expect(modelDisplayName(gpt5)).toBe('GPT-5')
    expect(modelDisplayName(zen)).toBe('zen3-omni')
  })

  it('modelType derives modality from id/name', () => {
    expect(modelType(gpt5)).toBe('Text')
    expect(modelType(embed)).toBe('Embedding')
    // zen3-omni is the multimodal omni model — "omni" → Vision (honest, it does vision).
    expect(modelType(zen)).toBe('Vision')
    expect(modelType({ name: 'qwen-2.5-7b' })).toBe('Text')
  })
})

describe('price + search filters', () => {
  it('priceBucket bands input price and honors isFree', () => {
    expect(priceBucket(free)).toBe('free')
    expect(priceBucket(embed)).toBe('low') // 0.02 < 1
    expect(priceBucket(gpt5)).toBe('mid') // 1.25 in [1,5]
    expect(priceBucket({ name: 'x', pricing: { input: 12 } })).toBe('high')
    expect(priceBucket({ name: 'x' })).toBe('unknown')
  })

  it('matchesQuery searches name, provider, and id case-insensitively', () => {
    expect(matchesQuery(gpt5, 'gpt')).toBe(true)
    expect(matchesQuery(gpt5, 'openai')).toBe(true)
    expect(matchesQuery(gpt5, 'anthropic')).toBe(false)
    expect(matchesQuery(gpt5, '')).toBe(true)
  })
})

describe('groupByProvider', () => {
  const entries: CatalogEntry[] = [
    { ...zen, available: true },
    { ...gpt5, available: true },
    { ...embed, available: false },
  ]
  const groups = groupByProvider(entries)

  it('flags the first-party group verified and counts availability', () => {
    const hanzo = groups.find((g) => g.provider === 'Hanzo')!
    const openai = groups.find((g) => g.provider === 'OpenAI')!
    expect(hanzo.verified).toBe(true)
    expect(openai.verified).toBe(false)
    expect(openai.available).toBe(1) // gpt5 available, embed not
  })

  it('computes maxContext from the joined context shapes', () => {
    const openai = groups.find((g) => g.provider === 'OpenAI')!
    expect(openai.maxContext).toBe(400000) // from gpt5.contextWindow, not "—"
  })
})

describe('plansForTier', () => {
  const plans = [
    { id: 'pro', name: 'Pro', limits: { requestsPerMinute: 500 } },
    { id: 'max', name: 'Max', limits: { requestsPerMinute: 2000 } },
    { id: 'team', name: 'Team' },
  ]
  it('maps a space-separated tier string to the matching plans', () => {
    expect(plansForTier('pro max', plans).map((p) => p.id)).toEqual(['pro', 'max'])
    expect(plansForTier('', plans)).toEqual([])
    expect(plansForTier('pro', [])).toEqual([])
  })
})

describe('fetchCatalog — availability cross-ref by stable id', () => {
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    }
    vi.stubGlobal('fetch', (url: string) => {
      const body = url.includes('pricing')
        ? { models: [zen, gpt5] }
        : { object: 'list', data: [{ id: 'openai/gpt-5' }] } // only gpt-5 is servable
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('marks a third-party model available by its id, not its display name', async () => {
    const cat = await fetchCatalog()
    const g5 = cat.find((m) => m.id === 'openai/gpt-5')!
    const z = cat.find((m) => m.name === 'zen3-omni')!
    expect(g5.available).toBe(true)
    expect(z.available).toBe(false)
  })
})

describe('fetchCatalog — resilient when the pricing overlay is down (the 502 fix)', () => {
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    }
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('loads the live /v1/models set (normalized) when /v1/pricing/models 502s', async () => {
    // The exact live failure: the rich pricing catalog 502s, the routing set is 200.
    vi.stubGlobal('fetch', (url: string) =>
      url.includes('pricing')
        ? Promise.resolve(new Response('bad gateway', { status: 502 }))
        : Promise.resolve(
            new Response(
              JSON.stringify({
                object: 'list',
                data: [
                  { id: 'zen5', owned_by: 'hanzo' },
                  { id: 'zen5-mini', owned_by: 'hanzo' },
                ],
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          ),
    )
    const cat = await fetchCatalog() // must NOT throw despite the 502
    const z5 = cat.find((m) => m.id === 'zen5')!
    expect(z5).toBeDefined()
    expect(z5.available).toBe(true) // the live routing set is servable
    expect(z5.name).toBe('zen5') // name normalized from id — never a blank picker row
    expect(z5.provider).toBe('hanzo') // provider normalized from owned_by
    expect(cat.map((m) => m.id)).toContain('zen5-mini')
  })

  it('degrades to the browsable fixture catalog when the WHOLE gateway is down', async () => {
    // Both /v1/pricing/models AND /v1/models 502 — the catalog must still render from
    // the checked-in fixture (honest: nothing is Live), never an error card.
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('bad gateway', { status: 502 })))
    const cat = await fetchCatalog() // must NOT throw — the fixture guarantees a result
    expect(cat.length).toBeGreaterThan(100) // the ~340-model openrouter fixture
    expect(cat.every((m) => m.available === false)).toBe(true) // no live routing set → nothing Live
    // A representative fixture row carries real capability + price + context.
    const jamba = cat.find((m) => m.id === 'ai21/jamba-large-1.7')!
    expect(jamba).toBeDefined()
    expect(jamba.contextWindow).toBe(256000)
    expect(jamba.pricing?.input).toBe(2)
  })
})

describe('fetchCatalog — fixture base + live overlay (guaranteed browsable ~400 catalog)', () => {
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    }
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('includes fixture models the live catalog never mentions, marked Catalog not Live', async () => {
    // Live pricing carries only zen; live routing carries only zen — the fixture's
    // hundreds of third-party models must still appear (browsable), none of them Live.
    vi.stubGlobal('fetch', (url: string) =>
      url.includes('pricing')
        ? Promise.resolve(new Response(JSON.stringify({ models: [zen] }), { status: 200, headers: { 'content-type': 'application/json' } }))
        : Promise.resolve(new Response(JSON.stringify({ object: 'list', data: [{ id: 'zen3-omni' }] }), { status: 200, headers: { 'content-type': 'application/json' } })),
    )
    const cat = await fetchCatalog()
    const jamba = cat.find((m) => m.id === 'ai21/jamba-large-1.7')!
    expect(jamba).toBeDefined() // fixture model present even though live never mentioned it
    expect(jamba.available).toBe(false) // honest: not in the live routing set
    expect(cat.length).toBeGreaterThan(100)
  })

  it('lets LIVE pricing win over the fixture on an overlapping id', async () => {
    // Take a real fixture id and re-price it live; the live price must override.
    vi.stubGlobal('fetch', (url: string) =>
      url.includes('pricing')
        ? Promise.resolve(
            new Response(
              JSON.stringify({ models: [{ id: 'ai21/jamba-large-1.7', name: 'AI21: Jamba Large 1.7', pricing: { input: 99, output: 199 } }] }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          )
        : Promise.resolve(new Response(JSON.stringify({ object: 'list', data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })),
    )
    const cat = await fetchCatalog()
    const jamba = cat.find((m) => m.id === 'ai21/jamba-large-1.7')!
    expect(jamba.pricing?.input).toBe(99) // live pricing beat the fixture's 2
    expect(jamba.contextWindow).toBe(256000) // fixture fills the field live omitted
  })
})

describe('fetchPlans — honest-empty when gated', () => {
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    }
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('returns [] on a 401 gate instead of throwing', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 401 })))
    expect(await fetchPlans()).toEqual([])
  })

  it('parses the { plans: [...] } envelope on success', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ plans: [{ id: 'pro', name: 'Pro', limits: { requestsPerMinute: 500 } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const plans = await fetchPlans()
    expect(plans.map((p) => p.id)).toEqual(['pro'])
  })
})

describe('fetchCatalog — the routing id is what the gateway serves (tail alias)', () => {
  const haiku: RichModel = {
    id: 'anthropic/claude-haiku-4.5',
    name: 'Anthropic: Claude Haiku 4.5',
    provider: 'Anthropic',
    contextWindow: 200000,
    pricing: { input: 1, output: 5 },
  }
  const opus: RichModel = {
    id: 'anthropic/claude-opus-4.6',
    name: 'Anthropic: Claude Opus 4.6',
    provider: 'Anthropic',
    contextWindow: 200000,
    pricing: { input: 5, output: 25 },
  }
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    }
    vi.stubGlobal('fetch', (url: string) => {
      const body = url.includes('pricing')
        ? { models: [haiku, opus] }
        : // The gateway routes the BARE ids, not the bundle's openrouter spelling.
          { object: 'list', data: [{ id: 'claude-haiku-4.5' }, { id: 'claude-opus-4.6' }] }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('rewrites a bundle id to the live tail so the picker submits what routes', async () => {
    const cat = await fetchCatalog()
    const h = cat.find((m) => m.name === 'Anthropic: Claude Haiku 4.5')!
    expect(h.id).toBe('claude-haiku-4.5') // NOT anthropic/claude-haiku-4.5 — that 404s
    expect(h.available).toBe(true)
    // The live-only merge must not append a duplicate bare row for it.
    expect(cat.filter((m) => modelId(m) === 'claude-haiku-4.5')).toHaveLength(1)
  })

  it('derives premium from frontier pricing when the bundle omits the flag', async () => {
    const cat = await fetchCatalog()
    const h = cat.find((m) => modelId(m) === 'claude-haiku-4.5')!
    const o = cat.find((m) => modelId(m) === 'claude-opus-4.6')!
    expect(h.premium).toBeFalsy() // $1/$5 — under both bars
    expect(o.premium).toBe(true) // $5/$25 — the Opus class gates behind a plan
  })
})
