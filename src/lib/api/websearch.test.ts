import { describe, it, expect } from 'vitest'

import { normalizeResult, normalizeSearch, SEARXNG_ENGINES, WEBSEARCH_ENDPOINTS } from './websearch'

/**
 * The websearch client normalizers over the REAL SearXNG `?format=json` shape
 * (`{ results: [{ url, title, content, img_src?, engine? }] }`). These pin that a
 * row without a URL is dropped (unrenderable), the four stable fields land, and a
 * non-array / error payload yields `[]` (honest empty) — never a crash, never a
 * fabricated hit. The endpoint/engine facts are asserted stable (the panel shows them).
 */

describe('normalizeResult — one SearXNG hit', () => {
  it('maps the stable fields and keeps optional img/engine when present', () => {
    const r = normalizeResult({ url: 'https://a.com/x', title: 'Hello', content: 'a snippet', img_src: 'https://a.com/i.png', engine: 'google' })
    expect(r).toEqual({ url: 'https://a.com/x', title: 'Hello', content: 'a snippet', imgSrc: 'https://a.com/i.png', engine: 'google' })
  })

  it('falls back the title to the url when the engine returned no title', () => {
    expect(normalizeResult({ url: 'https://a.com', content: '' })).toEqual({ url: 'https://a.com', title: 'https://a.com', content: '' })
  })

  it('drops a row with no url (nothing to render / no row key)', () => {
    expect(normalizeResult({ title: 'no locator', content: 'x' })).toBeNull()
    expect(normalizeResult({})).toBeNull()
    expect(normalizeResult(null)).toBeNull()
  })

  it('omits optional fields when absent (no empty-string img/engine keys)', () => {
    const r = normalizeResult({ url: 'https://a.com', title: 'T', content: 'C' })
    expect(r).not.toHaveProperty('imgSrc')
    expect(r).not.toHaveProperty('engine')
  })
})

describe('normalizeSearch — a SearXNG results payload', () => {
  it('extracts + normalizes the results array, dropping url-less rows', () => {
    const out = normalizeSearch({
      results: [
        { url: 'https://a.com', title: 'A', content: 'aa' },
        { title: 'no url' },
        { url: 'https://b.com', title: 'B', content: 'bb' },
      ],
    })
    expect(out.map((r) => r.url)).toEqual(['https://a.com', 'https://b.com'])
  })

  it('an error object / missing results / non-array → [] (honest empty, never a crash)', () => {
    expect(normalizeSearch({ error: 'searxng down' })).toEqual([])
    expect(normalizeSearch({ results: 'nope' })).toEqual([])
    expect(normalizeSearch(null)).toEqual([])
    expect(normalizeSearch(undefined)).toEqual([])
  })
})

describe('static product facts', () => {
  it('the deployed SearXNG engine set is the key-less engines (non-empty)', () => {
    expect(SEARXNG_ENGINES).toContain('google')
    expect(SEARXNG_ENGINES).toContain('duckduckgo')
    expect(SEARXNG_ENGINES.length).toBeGreaterThanOrEqual(5)
  })

  it('exactly the two /v1/websearch endpoints; only search is user-callable in-console', () => {
    const paths = WEBSEARCH_ENDPOINTS.map((e) => e.path)
    expect(paths).toContain('/v1/websearch/search')
    expect(paths).toContain('/v1/websearch/v1/scrape')
    const search = WEBSEARCH_ENDPOINTS.find((e) => e.path === '/v1/websearch/search')!
    const scrape = WEBSEARCH_ENDPOINTS.find((e) => e.path === '/v1/websearch/v1/scrape')!
    expect(search.method).toBe('GET')
    expect(search.liveInConsole).toBe(true)
    expect(scrape.method).toBe('POST')
    expect(scrape.liveInConsole).toBe(false) // needs the shared crawl key, not a user session
  })
})
