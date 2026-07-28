import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  SocialApi,
  PROVIDERS,
  normalizePost,
  normalizeSummary,
  normalizeProviderCapability,
  normalizeProviders,
  normalizeAccounts,
} from './social'

/**
 * Social API + pure normalizers. The module calls the DOCUMENTED cloud `/v1/social`
 * contract same-origin, keyless and prefix-free (`originV1Url` → `<origin>/v1/social`),
 * the canonical CRM/Agents form. These tests pin (1) the EXACT same-origin paths for the
 * new publish surface (providers + posts/:id/publish), (2) that the real store.go JSON
 * shape — including the server-managed publish results — normalizes, and (3) that a
 * garbage/absent field degrades to a safe default, never throws.
 */
const ORIGIN = 'https://social.hanzo.ai'

describe('Social normalizers — real store.go JSON shape, defensive', () => {
  it('normalizes a post including the server-managed publish results', () => {
    const p = normalizePost({
      id: 'post_1', content: 'hi', channel: 'linkedin', status: 'published',
      scheduleAt: 1000, accountId: 'acct_1', externalId: 'ext_9', error: '',
      createdAt: 1, updatedAt: 2,
    })
    expect(p).toMatchObject({
      id: 'post_1', content: 'hi', channel: 'linkedin', status: 'published',
      scheduleAt: 1000, accountId: 'acct_1', externalId: 'ext_9',
    })
    // Empty error normalizes to undefined (omitted), never the string "".
    expect(p.error).toBeUndefined()
  })

  it('coerces missing/garbage post fields to safe defaults (never throws)', () => {
    const p = normalizePost({ id: 'post_2' })
    expect(p).toMatchObject({ id: 'post_2', content: '', channel: 'x', status: 'draft', scheduleAt: 0 })
    expect(p.externalId).toBeUndefined()
    expect(normalizePost(null).id).toBe('')
  })

  it('carries a post’s media through — cloud’s PUT rebuilds the row, so dropping it would wipe it', () => {
    expect(normalizePost({ id: 'post_3', media: ['https://s3/a.png', 'https://s3/b.png'] }).media).toEqual([
      'https://s3/a.png',
      'https://s3/b.png',
    ])
    // Always an array, and non-string entries are dropped rather than rendered.
    expect(normalizePost({ id: 'post_4' }).media).toEqual([])
    expect(normalizePost({ id: 'post_5', media: 'nope' }).media).toEqual([])
    expect(normalizePost({ id: 'post_6', media: ['ok', 7, null] }).media).toEqual(['ok'])
  })

  it('normalizes a provider capability with the missing-credentials list', () => {
    const c = normalizeProviderCapability({
      provider: 'x', credentialsConfigured: false, missingCredentials: ['X_API_KEY', 'X_API_SECRET'],
    })
    expect(c).toEqual({ provider: 'x', credentialsConfigured: false, missingCredentials: ['X_API_KEY', 'X_API_SECRET'] })
    // A configured provider with a non-array field degrades to an empty list.
    expect(normalizeProviderCapability({ provider: 'linkedin', credentialsConfigured: true })).toEqual({
      provider: 'linkedin', credentialsConfigured: true, missingCredentials: [],
    })
  })

  it('reads lists from any envelope key or a bare array', () => {
    expect(normalizeProviders({ data: [{ provider: 'x' }, { provider: 'threads' }] }).map((c) => c.provider)).toEqual([
      'x', 'threads',
    ])
    expect(normalizeAccounts([{ id: 'a' }, { id: 'b' }]).length).toBe(2)
    expect(normalizeSummary({ posts: 3, scheduled: 1, published: 2, accounts: 4 })).toEqual({
      posts: 3, scheduled: 1, published: 2, accounts: 4,
    })
  })

  it('exposes the network vocabulary', () => {
    expect(PROVIDERS).toEqual(['x', 'facebook', 'instagram', 'linkedin', 'tiktok', 'youtube', 'threads'])
  })
})

describe('SocialApi — hits the same-origin /v1/social contract', () => {
  const fetched: { url: string; method: string }[] = []

  beforeEach(() => {
    fetched.length = 0
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN, hostname: 'social.hanzo.ai' },
    }
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      fetched.push({ url, method: init?.method ?? 'GET' })
      const body = url.includes('/providers')
        ? { data: [{ provider: 'x', credentialsConfigured: false, missingCredentials: ['X_API_KEY'] }] }
        : url.includes('/publish')
          ? { id: 'post_1', status: 'failed', error: 'provider not configured' }
          : { data: [] }
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
      )
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('reads provider readiness via the same-origin /v1/social/providers path', async () => {
    const caps = await SocialApi.providers()
    expect(fetched[0]).toEqual({ url: `${ORIGIN}/v1/social/providers`, method: 'GET' })
    expect(caps[0]).toMatchObject({ provider: 'x', credentialsConfigured: false, missingCredentials: ['X_API_KEY'] })
  })

  it('publishes a post with POST /v1/social/posts/:id/publish', async () => {
    const p = await SocialApi.posts.publish('post_1')
    expect(fetched[0]).toEqual({ url: `${ORIGIN}/v1/social/posts/post_1/publish`, method: 'POST' })
    expect(p).toMatchObject({ id: 'post_1', status: 'failed', error: 'provider not configured' })
  })

  it('lists posts and accounts via their same-origin paths', async () => {
    await SocialApi.posts.list()
    await SocialApi.accounts.list('x')
    expect(fetched[0].url).toBe(`${ORIGIN}/v1/social/posts`)
    expect(fetched[1].url).toBe(`${ORIGIN}/v1/social/accounts?provider=x`)
  })
})
