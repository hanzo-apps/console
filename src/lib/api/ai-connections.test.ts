import { describe, it, expect, vi, beforeEach } from 'vitest'

// Lock the provider-login OAuth (ai#85) transport contract by capturing the URL
// restGet is called with, and driving its resolved/rejected value — no network.
const ctl: { get: string[]; ret: unknown; err: Error | null } = { get: [], ret: {}, err: null }

vi.mock('./client', () => {
  class ApiError extends Error {
    status: number
    constructor(m: string, s = 0) {
      super(m)
      this.name = 'ApiError'
      this.status = s
    }
  }
  return {
    ApiError,
    restGet: vi.fn((url: string) => {
      ctl.get.push(url)
      return ctl.err ? Promise.reject(ctl.err) : Promise.resolve(ctl.ret)
    }),
    restPost: vi.fn(() => Promise.resolve({})),
  }
})

import { AiConnectionsApi, AI_CONNECTION_PROVIDERS } from './ai-connections'
import { ApiError } from './client'

beforeEach(() => {
  ctl.get = []
  ctl.ret = {}
  ctl.err = null
})

describe('AiConnectionsApi.authorizeUrl (provider-login OAuth, ai#85)', () => {
  it('GETs …/connections/<provider>/authorize?format=json through the /ai proxy', async () => {
    ctl.ret = { authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }
    await AiConnectionsApi.authorizeUrl('google')
    expect(ctl.get).toHaveLength(1)
    expect(ctl.get[0]).toMatch(/\/ai\/v1\/ai\/connections\/google\/authorize\?format=json$/)
  })

  it('returns the camelCase authorizeUrl', async () => {
    ctl.ret = { authorizeUrl: 'https://x/a' }
    expect(await AiConnectionsApi.authorizeUrl('openai')).toBe('https://x/a')
  })

  it('tolerates snake_case authorize_url and a bare url', async () => {
    ctl.ret = { authorize_url: 'https://x/snake' }
    expect(await AiConnectionsApi.authorizeUrl('openai')).toBe('https://x/snake')
    ctl.ret = { url: 'https://x/bare' }
    expect(await AiConnectionsApi.authorizeUrl('anthropic')).toBe('https://x/bare')
  })

  it('throws when the server returns no URL (never a silent bad redirect)', async () => {
    ctl.ret = { ok: true }
    await expect(AiConnectionsApi.authorizeUrl('openai')).rejects.toBeInstanceOf(ApiError)
  })

  it('propagates a 503 "not configured" so the caller shows an honest state', async () => {
    ctl.err = new ApiError('provider oauth not configured on this deployment', 503)
    await expect(AiConnectionsApi.authorizeUrl('anthropic')).rejects.toMatchObject({ status: 503 })
  })
})

describe('AI_CONNECTION_PROVIDERS', () => {
  it('lists exactly the three linkable providers in preference order', () => {
    expect(AI_CONNECTION_PROVIDERS.map((p) => p.id)).toEqual(['openai', 'anthropic', 'google'])
  })
})
