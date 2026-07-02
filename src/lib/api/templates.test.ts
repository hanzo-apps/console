import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  normalizeTemplate,
  normalizeTemplates,
  normalizeForkedProject,
  groupByCategory,
  TemplatesApi,
} from './templates'
import { ApiError } from './client'

describe('normalizeTemplate', () => {
  it('drops a record with no slug/id or no title', () => {
    expect(normalizeTemplate({})).toBeNull()
    expect(normalizeTemplate({ slug: 'a' })).toBeNull()
    expect(normalizeTemplate({ title: 'A' })).toBeNull()
  })

  it('reads slug from slug|id and title from title|displayName|name', () => {
    expect(normalizeTemplate({ id: 'x', name: 'X' })).toMatchObject({ slug: 'x', title: 'X' })
    expect(normalizeTemplate({ slug: 'y', displayName: 'Y' })).toMatchObject({ slug: 'y', title: 'Y' })
  })

  it('defaults category to App and features to [], coerces numbers', () => {
    const t = normalizeTemplate({ slug: 's', title: 'S', tier: 1, rating: 5 })
    expect(t).toMatchObject({ category: 'App', features: [], tier: 1, rating: 5 })
  })

  it('keeps only string features and passes through handoff urls', () => {
    const t = normalizeTemplate({ slug: 's', title: 'S', features: ['a', 2, ''], source: 'u', preview: 'p' })
    expect(t?.features).toEqual(['a', '2'])
    expect(t).toMatchObject({ source: 'u', preview: 'p' })
  })
})

describe('normalizeTemplates', () => {
  it('reads the data envelope and drops invalid rows', () => {
    const out = normalizeTemplates({ data: [{ slug: 'a', title: 'A' }, { slug: 'b' }] })
    expect(out.map((t) => t.slug)).toEqual(['a'])
  })

  it('reads a bare array and never throws on junk', () => {
    expect(normalizeTemplates([{ slug: 'a', title: 'A' }]).length).toBe(1)
    expect(normalizeTemplates(null)).toEqual([])
    expect(normalizeTemplates(9)).toEqual([])
  })
})

describe('groupByCategory', () => {
  it('groups by category, categories alphabetized, order preserved within', () => {
    const ts = normalizeTemplates([
      { slug: 'a', title: 'A', category: 'SaaS' },
      { slug: 'b', title: 'B', category: 'App' },
      { slug: 'c', title: 'C', category: 'SaaS' },
    ])
    const groups = groupByCategory(ts)
    expect(groups.map(([c]) => c)).toEqual(['App', 'SaaS'])
    expect(groups[1][1].map((t) => t.slug)).toEqual(['a', 'c'])
  })
})

describe('normalizeForkedProject', () => {
  it('returns null without a slug', () => {
    expect(normalizeForkedProject({})).toBeNull()
    expect(normalizeForkedProject({ name: 'X' })).toBeNull()
    expect(normalizeForkedProject(null)).toBeNull()
  })

  it('maps the projectsvc Project view, defaulting name/framework/status', () => {
    expect(normalizeForkedProject({ slug: 'brainwave' })).toEqual({
      slug: 'brainwave',
      name: 'brainwave',
      framework: 'static',
      status: 'draft',
      liveUrl: undefined,
    })
  })

  it('passes through real fields (name, framework, status, liveUrl)', () => {
    const p = normalizeForkedProject({
      slug: 'brainwave',
      name: 'Brainwave',
      framework: 'next',
      status: 'live',
      liveUrl: 'https://s3.hanzo.ai/hanzo-sites/maxpower/brainwave/index.html',
      // extra fields the console does not need are ignored
      org: 'maxpower',
      repo: { url: 'https://gallery.hanzo.ai/templates/brainwave', provider: 'git' },
    })
    expect(p).toEqual({
      slug: 'brainwave',
      name: 'Brainwave',
      framework: 'next',
      status: 'live',
      liveUrl: 'https://s3.hanzo.ai/hanzo-sites/maxpower/brainwave/index.html',
    })
  })
})

describe('TemplatesApi.fork — POST /v1/projects/fork (same-origin, no prefix)', () => {
  const ORIGIN = 'https://console.hanzo.ai'
  let calls: { url: string; method?: string; body?: unknown }[]

  beforeEach(() => {
    calls = []
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    }
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  const stub = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return Promise.resolve(
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
      )
    })

  it('POSTs {slug} to <origin>/v1/projects/fork and returns the forked project', async () => {
    stub(201, { slug: 'brainwave', name: 'Brainwave', framework: 'next', status: 'draft' })
    const p = await TemplatesApi.fork('brainwave')
    expect(calls[0].url).toBe(`${ORIGIN}/v1/projects/fork`)
    expect(calls[0].url).not.toContain('/cloud/')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toEqual({ slug: 'brainwave' })
    expect(p).toMatchObject({ slug: 'brainwave', name: 'Brainwave', framework: 'next', status: 'draft' })
  })

  it('includes an explicit name override in the body when provided', async () => {
    stub(201, { slug: 'landing-1', name: 'My Landing', framework: 'vite', status: 'draft' })
    await TemplatesApi.fork('xora-react', { name: 'My Landing' })
    expect(calls[0].body).toEqual({ slug: 'xora-react', name: 'My Landing' })
  })

  it('throws a 404 ApiError when the fork route is absent (older backend) so the UI can fall back', async () => {
    stub(404, { error: 'not found' })
    const err = await TemplatesApi.fork('brainwave').then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(404)
  })
})
