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

  it('lists from /org/iam/get-organization-projects with the org param (not the cloud /v1/iam path)', async () => {
    const out = await ProjectApi.list()
    expect(fetched.some((u) => u.startsWith('/org/iam/get-organization-projects'))).toBe(true)
    expect(fetched.some((u) => u.includes('organization='))).toBe(true)
    // never the cloud /v1 path that 404s
    expect(fetched.some((u) => u.includes('/v1/iam/'))).toBe(false)
    expect(out.map((p) => p.name)).toEqual(['demo'])
  })
})
