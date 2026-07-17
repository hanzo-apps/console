import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectApi } from './projects'

const ORIGIN = 'https://console.hanzo.ai'

// Projects are IAM-served over the ONE cloud IAM edge: `iamList` targets
// `/v1/iam/<segment>`, which the one-binary console (console.hanzo.ai served by
// cloud) calls directly and a split console forwards through its `/v1` bearer
// proxy — ONE path, both topologies. This pins that contract (replacing the old
// `/org/iam` BFF, which the static one-binary console can't run) so it can't regress.
describe('ProjectApi.list — routes through the /v1/iam cloud edge', () => {
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

  it('lists from /v1/iam/get-organization-projects with the org param (not the old /org/iam BFF)', async () => {
    const out = await ProjectApi.list()
    expect(fetched.some((u) => u.includes('/v1/iam/get-organization-projects'))).toBe(true)
    expect(fetched.some((u) => u.includes('organization='))).toBe(true)
    // no longer the old /org/iam BFF (the static one-binary console has no server routes)
    expect(fetched.some((u) => u.includes('/org/iam/'))).toBe(false)
    expect(out.map((p) => p.name)).toEqual(['demo'])
  })
})
