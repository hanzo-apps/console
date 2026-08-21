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
    // IAM answers a listing with the TYPED record — rows under a key named after
    // the entity, count beside it — never a {status,data} envelope.
    vi.stubGlobal('fetch', (url: string) => {
      fetched.push(url)
      return Promise.resolve(
        new Response(JSON.stringify({ projects: [{ name: 'demo', organization: 'hanzo' }], total: 1 }), {
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

  it('lists from /v1/iam/projects scoped by owner (not the old /org/iam BFF)', async () => {
    const out = await ProjectApi.list()
    expect(fetched.some((u) => u.includes('/v1/iam/projects'))).toBe(true)
    // `owner` is the scope IAM resolves the listing against.
    expect(fetched.some((u) => u.includes('owner='))).toBe(true)
    // no longer the old /org/iam BFF (the static one-binary console has no server routes)
    expect(fetched.some((u) => u.includes('/org/iam/'))).toBe(false)
    expect(out.map((p) => p.name)).toEqual(['demo'])
  })

  /**
   * The rows arrive under `projects`, so reading a `data` slot would silently
   * yield [] against a live IAM — a list that looks empty rather than one that
   * failed. This is the parse, not just the path.
   */
  it('reads the rows from the entity key, not a `data` envelope slot', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ name: 'ghost' }], projects: [{ name: 'real' }], total: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    expect((await ProjectApi.list()).map((p) => p.name)).toEqual(['real'])
  })

  it('creates and deletes through the one projects entity, keyed from the body', async () => {
    const bodies: string[] = []
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      fetched.push(url)
      bodies.push(String(init?.body ?? ''))
      return Promise.resolve(new Response(JSON.stringify({ name: 'demo' }), { status: 200 }))
    })

    await ProjectApi.create({ name: 'demo' })
    expect(fetched[0]).toContain('/v1/iam/projects')
    expect(fetched[0]).not.toContain('add-project')

    await ProjectApi.remove('demo')
    expect(fetched[1]).toContain('/v1/iam/projects/delete')
    // The key travels in the body — there is no `?id=owner/name` any more.
    expect(fetched[1]).not.toContain('id=')
    expect(JSON.parse(bodies[1])).toMatchObject({ name: 'demo' })
  })
})
