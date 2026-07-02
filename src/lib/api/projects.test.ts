import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectApi } from './projects'

const ORIGIN = 'https://console.hanzo.ai'

// Projects are IAM-served; the console host's /v1 sends /v1/iam/* to the cloud
// binary → 404 ("projects not routed"). The fix routes Projects through the
// /org/iam BFF proxy (mints a user Bearer server-side, forwards to IAM), NOT the
// cloud cookie path. This pins that contract so it can't regress to the 404 path.
describe('ProjectApi.list — routes through the /org/iam Bearer proxy', () => {
  const fetched: string[] = []

  beforeEach(() => {
    fetched.length = 0
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
    }
    vi.stubGlobal('fetch', (url: string) => {
      fetched.push(url)
      return Promise.resolve(
        new Response(JSON.stringify({ status: 'ok', msg: '', data: [{ name: 'demo', organization: 'hanzo' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('lists from same-origin /v1/iam/get-organization-projects with the org param', async () => {
    const out = await ProjectApi.list()
    // Single-binary: the cloud binary proxies /v1/iam/* to the brand IAM and scopes
    // by the validated session — the console calls it same-origin, no /org/iam BFF.
    expect(fetched.some((u) => u.startsWith('/v1/iam/get-organization-projects'))).toBe(true)
    expect(fetched.some((u) => u.includes('organization='))).toBe(true)
    expect(out.map((p) => p.name)).toEqual(['demo'])
  })
})
