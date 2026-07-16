import { describe, it, expect } from 'vitest'

import type { SearchResult } from '~/lib/api/websearch'
import { WEBSEARCH_ENDPOINTS } from '~/lib/api/websearch'
import { deriveSearchHealth, searchHealthLabel, resolveTab, curlFor, hostOf, presentableResults, SEARCH_TABS } from './logic'

/**
 * Pure logic for the Web Search panel. These pin the health-from-probe verdict
 * (there is no health endpoint — a live search IS the probe), the tab resolution,
 * the curl builder against the caller's origin, and the display filters — so the
 * panel's decisions are tested, not eyeballed.
 */

describe('deriveSearchHealth — a live search probe is the health signal', () => {
  it('a probe with results → healthy; zero results → reachable; a throw → down; no probe → unknown', () => {
    expect(deriveSearchHealth({ ok: true, results: 3 })).toBe('healthy')
    expect(deriveSearchHealth({ ok: true, results: 0 })).toBe('reachable')
    expect(deriveSearchHealth({ ok: false, results: 0 })).toBe('down')
    expect(deriveSearchHealth(null)).toBe('unknown')
  })

  it('maps each verdict to a stable label + tone', () => {
    expect(searchHealthLabel('healthy')).toEqual({ label: 'Operational', tone: 'green' })
    expect(searchHealthLabel('reachable').tone).toBe('yellow')
    expect(searchHealthLabel('down').tone).toBe('red')
    expect(searchHealthLabel('unknown').tone).toBe('gray')
  })
})

describe('resolveTab — :tab param → known tab (non-base slugs, no shared-subpage collision)', () => {
  it('resolves known tabs and defaults unknown to Overview', () => {
    expect(resolveTab('search')).toBe('search')
    expect(resolveTab('api')).toBe('api')
    expect(resolveTab('engines')).toBe('engines')
    expect(resolveTab('config')).toBe('config')
    expect(resolveTab(undefined)).toBe('')
    expect(resolveTab('nope')).toBe('')
  })

  it('no tab slug collides with a shared base sub-page (settings/status/logs/metrics)', () => {
    const base = new Set(['settings', 'status', 'logs', 'metrics'])
    for (const t of SEARCH_TABS) if (t.id) expect(base.has(t.id)).toBe(false)
  })
})

describe('curlFor — copy-paste example against the caller origin', () => {
  const origin = 'https://console.hanzo.ai'
  const search = WEBSEARCH_ENDPOINTS.find((e) => e.path === '/v1/websearch/search')!
  const scrape = WEBSEARCH_ENDPOINTS.find((e) => e.path === '/v1/websearch/scrape')!

  it('search → a plain GET with q + format=json on the same origin', () => {
    const c = curlFor(search, origin)
    expect(c).toContain(`${origin}/v1/websearch/search?q=`)
    expect(c).toContain('format=json')
    expect(c.startsWith('curl ')).toBe(true)
  })

  it('scrape → a POST with the firecrawl body + the SERVER-SIDE key ref (never a real secret)', () => {
    const c = curlFor(scrape, origin)
    expect(c).toContain('POST')
    expect(c).toContain(`${origin}/v1/websearch/scrape`)
    expect(c).toContain('$WEBSEARCH_API_KEY') // an env ref, not a literal secret
    expect(c).toContain('"url"')
  })

  it('trims a trailing slash on the origin', () => {
    expect(curlFor(search, 'https://console.hanzo.ai/')).toContain('https://console.hanzo.ai/v1/websearch/search')
  })
})

describe('hostOf / presentableResults — display helpers', () => {
  it('hostOf returns the domain, or "" for a non-URL', () => {
    expect(hostOf('https://en.wikipedia.org/wiki/X')).toBe('en.wikipedia.org')
    expect(hostOf('not a url')).toBe('')
  })

  it('presentableResults drops rows with neither title nor snippet', () => {
    const rows: SearchResult[] = [
      { url: 'https://a.com', title: 'A', content: '' },
      { url: 'https://b.com', title: '', content: '' },
      { url: 'https://c.com', title: '', content: 'has snippet' },
    ]
    expect(presentableResults(rows).map((r) => r.url)).toEqual(['https://a.com', 'https://c.com'])
  })
})
