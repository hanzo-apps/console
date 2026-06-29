import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { CloudModelApi } from './models-catalog'

/**
 * The catalog must reach the model list through the console's OWN `/ai` proxy
 * (which adds the user bearer the gateway requires), NOT the cloud `/v1/models`
 * path (cookie-only → 401/empty — the "models missing" bug). We assert the exact
 * URL the catalog fetches for the model list.
 */
const ORIGIN = 'https://console.hanzo.ai'

describe('CloudModelApi.list — routes the model list through /ai', () => {
  const fetched: string[] = []

  beforeEach(() => {
    fetched.length = 0
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    }
    vi.stubGlobal('fetch', (url: string) => {
      fetched.push(url)
      const body = url.includes('pricing')
        ? { models: [] }
        : { object: 'list', data: [{ id: 'zen-coder', object: 'model', created: 1, owned_by: 'hanzo', premium: true }] }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('fetches the model list from <origin>/ai/v1/models', async () => {
    const models = await CloudModelApi.list()
    const modelsUrl = fetched.find((u) => u.endsWith('/models') && !u.includes('pricing'))
    expect(modelsUrl).toBe(`${ORIGIN}/ai/v1/models`)
    expect(models.map((m) => m.id)).toEqual(['zen-coder'])
    expect(models[0].premium).toBe(true)
  })

  it('never fetches the cookie-only cloud /v1/models path', async () => {
    await CloudModelApi.list()
    expect(fetched).not.toContain(`${ORIGIN}/v1/models`)
  })
})
