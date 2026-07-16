import { describe, it, expect, vi, beforeEach } from 'vitest'

// Route restGet by URL so list() and per-provider usage() get distinct responses.
// The connections base is the canonical `/v1/ai/connections` (host-agnostic); `@hanzo/usage`
// is real (the pure normalizeProviderUsage).
const h = vi.hoisted(() => ({ routes: [] as Array<[string, unknown]>, calls: [] as string[] }))

vi.mock('./client', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(m: string, s = 0) {
      super(m)
      this.status = s
    }
  },
  restGet: vi.fn((url: string) => {
    h.calls.push(url)
    const hit = h.routes.find(([k]) => url.includes(k))
    const v = hit ? hit[1] : {}
    return v instanceof Error ? Promise.reject(v) : Promise.resolve(v)
  }),
  restPost: vi.fn(() => Promise.resolve({})),
}))

import { AiConnectionsApi } from './ai-connections'

const usagePayload = (provider: string, spendCents: number, tokens: number) => ({
  provider,
  connected: true,
  available: true,
  currency: 'usd',
  start: '2026-06-01T00:00:00Z',
  end: '2026-07-01T00:00:00Z',
  interval: 'day',
  totals: { spendCents, tokens, inputTokens: tokens, outputTokens: 0, requests: 3 },
  series: [{ t: '2026-06-01T00:00:00Z', spendCents, tokens, requests: 3 }],
  byModel: [{ model: 'gpt-4o', spendCents: 0, tokens, requests: 3 }],
})

beforeEach(() => {
  h.routes = []
  h.calls = []
})

describe('AiConnectionsApi.usage', () => {
  it('GETs the connection usage URL with from/to and unwraps the {data} envelope', async () => {
    h.routes = [['/openai/usage', { status: 'ok', data: usagePayload('openai', 142, 1860) }]]
    const out = await AiConnectionsApi.usage('openai', '2026-06-01', '2026-07-01')
    expect(out.totals.spendCents).toBe(142)
    expect(out.byModel[0]!.model).toBe('gpt-4o')
    const url = h.calls[0]!
    expect(url).toMatch(/\/v1\/ai\/connections\/openai\/usage\?from=2026-06-01&to=2026-07-01$/)
  })

  it('tolerates a bare value (no envelope) and fills the provider fallback', async () => {
    const bare = { ...usagePayload('', 50, 500) } // provider intentionally blank
    h.routes = [['/anthropic/usage', bare]]
    const out = await AiConnectionsApi.usage('anthropic')
    expect(out.provider).toBe('anthropic')
    expect(out.totals.tokens).toBe(500)
  })
})

describe('AiConnectionsApi.listWithUsage', () => {
  it('imports usage for each CONNECTED provider only', async () => {
    h.routes = [
      ['/openai/usage', { status: 'ok', data: usagePayload('openai', 142, 1860) }],
      ['/anthropic/usage', { status: 'ok', data: usagePayload('anthropic', 0, 900) }],
      // list: openai+anthropic connected, google not
      ['/connections', { status: 'ok', data: [{ provider: 'openai', connected: true }, { provider: 'anthropic', connected: true }, { provider: 'google', connected: false }] }],
    ]
    const items = await AiConnectionsApi.listWithUsage('2026-06-01', '2026-07-01')
    expect(items.map((i) => i.provider)).toEqual(['openai', 'anthropic'])
    expect(items[0]!.totals.spendCents).toBe(142)
    expect(items[1]!.totals.tokens).toBe(900)
    // google (not connected) is not imported
    expect(h.calls.some((u) => u.includes('/google/usage'))).toBe(false)
  })

  it('isolates a per-provider failure to an honest failed card (never blanks the others)', async () => {
    h.routes = [
      ['/openai/usage', { status: 'ok', data: usagePayload('openai', 142, 1860) }],
      ['/anthropic/usage', new Error('boom')],
      ['/connections', { status: 'ok', data: [{ provider: 'openai', connected: true }, { provider: 'anthropic', connected: true }] }],
    ]
    const items = await AiConnectionsApi.listWithUsage()
    expect(items).toHaveLength(2)
    expect(items[0]!.available).toBe(true)
    expect(items[1]!.provider).toBe('anthropic')
    expect(items[1]!.available).toBe(false)
    expect(items[1]!.note).toContain('failed')
  })

  it('returns [] when nothing is connected', async () => {
    h.routes = [['/connections', { status: 'ok', data: [{ provider: 'openai', connected: false }, { provider: 'google', connected: false }] }]]
    expect(await AiConnectionsApi.listWithUsage()).toEqual([])
  })
})
