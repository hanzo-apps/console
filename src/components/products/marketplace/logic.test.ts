import { describe, it, expect } from 'vitest'

import type { CatalogEntry } from '~/lib/api/aicatalog'
import { categorize, featured, applyFilters, marketStats, listingTitle } from './logic'

/**
 * The Marketplace renders ONLY real catalog listings. These pin: categories are
 * grouped by real modality (never invented), the featured shelf is the catalog's
 * own flag (with a cheapest-available fallback, still real), filters are plain
 * substring matches, and the stats are exact counts over the listings.
 */
const m = (over: Partial<CatalogEntry> & { name: string }): CatalogEntry => ({
  available: false,
  ...over,
}) as CatalogEntry

// NB: modelType() classifies '-omni' as Vision, so use a plain chat id for the
// Text fixture. This keeps the fixtures aligned with the REAL classifier.
const zenText = m({ name: 'zen3-chat', provider: 'hanzo', category: 'zen', available: true, pricing: { input: 0.5, output: 1 }, contextWindow: 128_000 })
const gpt = m({ name: 'OpenAI: GPT-5', id: 'openai/gpt-5', provider: 'openai', available: true, pricing: { input: 2, output: 6 }, contextWindow: 400_000, featured: true })
// 'vision' in the id triggers modelType()==='Vision' (matches the real classifier).
const vision = m({ name: 'Qwen: Vision-Max', id: 'qwen/qwen-vision', provider: 'qwen', available: false, pricing: { input: 1.2 }, contextWindow: 32_000 })
const embed = m({ name: 'text-embedding-3', id: 'openai/text-embedding-3', provider: 'openai', available: true, pricing: { input: 0.02 } })
const image = m({ name: 'flux-pro', id: 'bfl/flux-pro', provider: 'bfl', available: false })

const CATALOG = [zenText, gpt, vision, embed, image]

describe('categorize — marketplace categories by modality', () => {
  it('groups listings by their real modality, ordered Text→Vision→Image→…', () => {
    const cats = categorize(CATALOG)
    const types = cats.map((c) => c.type)
    // Text (zen, gpt), Vision (qwen vl), Image (flux), Embedding (text-embedding).
    expect(types.indexOf('Text')).toBeLessThan(types.indexOf('Vision'))
    expect(types.indexOf('Vision')).toBeLessThan(types.indexOf('Image'))
    expect(types).toContain('Embedding')
  })

  it('counts listings and real availability per category', () => {
    const text = categorize(CATALOG).find((c) => c.type === 'Text')!
    expect(text.count).toBe(2) // zen + gpt
    expect(text.available).toBe(2) // both available
    const imageCat = categorize(CATALOG).find((c) => c.type === 'Image')!
    expect(imageCat.available).toBe(0) // flux not available
  })

  it('is empty for an empty catalog (no fabricated categories)', () => {
    expect(categorize([])).toEqual([])
  })
})

describe('featured — the editorial shelf', () => {
  it('uses the catalog featured flag when present', () => {
    const f = featured(CATALOG)
    expect(f).toContain(gpt) // gpt is flagged featured
    expect(f.every((x) => x.featured === true)).toBe(true)
  })

  it('falls back to cheapest AVAILABLE priced models when none are flagged', () => {
    const noFlag = CATALOG.map((x) => ({ ...x, featured: false }))
    const f = featured(noFlag, 2)
    // Cheapest available priced: embed ($0.02) then zen ($0.5). Vision/image are
    // unavailable → excluded even though vision is priced.
    expect(f[0].name).toBe('text-embedding-3')
    expect(f[1].name).toBe('zen3-chat')
    expect(f.every((x) => x.available)).toBe(true)
  })

  it('never fabricates a listing on an empty catalog', () => {
    expect(featured([])).toEqual([])
  })

  it('respects the limit', () => {
    expect(featured(CATALOG, 1).length).toBe(1)
  })
})

describe('applyFilters — storefront filtering', () => {
  it('matches a plain substring query over name/provider (case-insensitive)', () => {
    expect(applyFilters(CATALOG, { query: 'gpt' })).toEqual([gpt])
    expect(applyFilters(CATALOG, { query: 'QWEN' })).toEqual([vision])
  })

  it('filters by category (modality)', () => {
    expect(applyFilters(CATALOG, { category: 'Embedding' })).toEqual([embed])
  })

  it('filters available-only using real availability', () => {
    const avail = applyFilters(CATALOG, { availableOnly: true })
    expect(avail).toContain(zenText)
    expect(avail).toContain(gpt)
    expect(avail).not.toContain(vision) // unavailable
    expect(avail).not.toContain(image)
  })

  it('treats a regex-special query as a literal string (no injection)', () => {
    // '.*' must not act as a wildcard — it is a literal substring, matching nothing.
    expect(applyFilters(CATALOG, { query: '.*' })).toEqual([])
  })

  it('empty query + no filters returns every listing', () => {
    expect(applyFilters(CATALOG, {})).toEqual(CATALOG)
  })
})

describe('marketStats — exact counts', () => {
  it('counts listings, distinct providers, availability, and categories', () => {
    const s = marketStats(CATALOG)
    expect(s.listings).toBe(5)
    expect(s.providers).toBe(4) // hanzo(→Zen), openai, qwen, bfl
    expect(s.available).toBe(3) // zen, gpt, embed
    expect(s.categories).toBe(4) // Text, Vision, Image, Embedding
  })

  it('is all-zero for an empty catalog', () => {
    expect(marketStats([])).toEqual({ listings: 0, providers: 0, available: 0, categories: 0 })
  })
})

describe('listingTitle', () => {
  it('strips the provider prefix from a third-party display name', () => {
    expect(listingTitle(gpt)).toBe('GPT-5')
  })
  it('returns a first-party id unchanged', () => {
    expect(listingTitle(zenText)).toBe('zen3-chat')
  })
})
