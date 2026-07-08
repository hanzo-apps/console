import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  IntegrationsApi,
  normalizeConnection,
  normalizeProvider,
  normalizeProviders,
  normalizeConnectResult,
} from './integrations'

/**
 * Integrations API + pure normalizers. The module calls the DOCUMENTED cloud
 * `/v1/integrations` contract same-origin, keyless and prefix-free (`originV1Url` →
 * `<origin>/v1/integrations`); `next.config.mjs` rewrites that head to the user-bearer
 * `/v1` proxy. These tests pin (1) that each call hits the EXACT same-origin
 * `/v1/integrations` path with the right verb (the canonical Agents/CRM form — never a
 * direct cloud-origin call, which 403s), (2) that the real Provider JSON shape (the
 * CONNECTORS_CONTRACT tags) normalizes, (3) the list reads any envelope key, and (4) a
 * garbage/absent field degrades to a safe default — never throws.
 */
const ORIGIN = 'https://console.hanzo.ai'

describe('Integrations normalizers — contract Provider shape, defensive', () => {
  it('normalizes a connected provider with all fields', () => {
    const p = normalizeProvider({
      id: 'slack',
      name: 'Slack',
      description: 'Post + read messages',
      category: 'Communication',
      available: true,
      connected: true,
      connection: {
        account: 'Acme HQ',
        externalId: 'T0123',
        scopes: ['chat:write', 'users:read'],
        connectedAt: '2026-07-01T10:00:00Z',
      },
    })
    expect(p).toMatchObject({
      id: 'slack', name: 'Slack', category: 'Communication', available: true, connected: true,
    })
    expect(p.connection).toEqual({
      account: 'Acme HQ', externalId: 'T0123', scopes: ['chat:write', 'users:read'], connectedAt: '2026-07-01T10:00:00Z',
    })
  })

  it('coerces missing/garbage fields to safe defaults (never throws)', () => {
    const p = normalizeProvider({ id: 'github' })
    expect(p).toMatchObject({
      id: 'github', name: 'github', description: '', category: '', available: false, connected: false, connection: null,
    })
    // A non-object degrades to an empty (id-less) record, filtered out of lists.
    expect(normalizeProvider(null).id).toBe('')
    expect(normalizeProviders({ providers: [null, 'x', { id: 'slack', name: 'Slack' }] }).map((r) => r.id)).toEqual(['slack'])
  })

  it('reads snake_case connection keys and derives connected from the object', () => {
    const c = normalizeConnection({ account_label: 'Acme', external_id: 'T9', scopes: ['a'], connected_at: 'ts' })
    expect(c).toEqual({ account: 'Acme', externalId: 'T9', scopes: ['a'], connectedAt: 'ts' })
    // A connection object present but no explicit `connected` flag → still connected.
    const p = normalizeProvider({ id: 'slack', connection: { account: 'Acme' } })
    expect(p.connected).toBe(true)
    expect(p.connection?.account).toBe('Acme')
  })

  it('reads the provider list from any envelope key or a bare array', () => {
    expect(normalizeProviders([{ id: 'a' }, { id: 'b' }]).length).toBe(2)
    expect(normalizeProviders({ data: [{ id: 'slack' }] }).length).toBe(1)
    expect(normalizeProviders({ items: [{ id: 'github' }] }).length).toBe(1)
    expect(normalizeProviders('garbage')).toEqual([])
  })

  it('normalizes the connect result (tolerates authorize_url / url; empty → "")', () => {
    expect(normalizeConnectResult({ authorizeUrl: 'https://slack.com/oauth' }).authorizeUrl).toBe('https://slack.com/oauth')
    expect(normalizeConnectResult({ authorize_url: 'https://x' }).authorizeUrl).toBe('https://x')
    expect(normalizeConnectResult({ url: 'https://y' }).authorizeUrl).toBe('https://y')
    expect(normalizeConnectResult({}).authorizeUrl).toBe('')
    expect(normalizeConnectResult(null).authorizeUrl).toBe('')
  })
})

describe('IntegrationsApi — hits the same-origin /v1/integrations contract (rewritten to the /v1 BFF)', () => {
  const fetched: { url: string; method: string }[] = []

  beforeEach(() => {
    fetched.length = 0
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
    }
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      fetched.push({ url, method: init?.method ?? 'GET' })
      const body = url.endsWith('/connect')
        ? { authorizeUrl: 'https://slack.com/oauth/v2/authorize?x=1' }
        : url.endsWith('/disconnect')
          ? { disconnected: true }
          : url.endsWith('/integrations/slack')
            ? { id: 'slack', name: 'Slack', available: true, connected: false }
            : { providers: [{ id: 'slack', name: 'Slack' }, { id: 'github', name: 'GitHub' }] }
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
      )
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('lists providers via GET the same-origin /v1/integrations path (not a direct cloud-origin call)', async () => {
    const out = await IntegrationsApi.list()
    expect(fetched[0]).toEqual({ url: `${ORIGIN}/v1/integrations`, method: 'GET' })
    expect(out.map((p) => p.id)).toEqual(['slack', 'github'])
  })

  it('gets one provider by id', async () => {
    const p = await IntegrationsApi.get('slack')
    expect(fetched[0]).toEqual({ url: `${ORIGIN}/v1/integrations/slack`, method: 'GET' })
    expect(p.id).toBe('slack')
  })

  it('connects with POST and returns the authorizeUrl', async () => {
    const { authorizeUrl } = await IntegrationsApi.connect('slack')
    expect(fetched[0]).toEqual({ url: `${ORIGIN}/v1/integrations/slack/connect`, method: 'POST' })
    expect(authorizeUrl).toBe('https://slack.com/oauth/v2/authorize?x=1')
  })

  it('disconnects with POST', async () => {
    await IntegrationsApi.disconnect('slack')
    expect(fetched[0]).toEqual({ url: `${ORIGIN}/v1/integrations/slack/disconnect`, method: 'POST' })
  })
})
