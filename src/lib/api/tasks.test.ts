import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TasksApi } from './tasks'

/**
 * The Tasks client and the route that answers it must name the SAME address.
 *
 * They did not. The client called `/tasksd/*` — a private prefix invented on the
 * theory that a proxy at `/tasks/*` would shadow the product's page URLs (it
 * cannot; they differ at the first segment). Nothing serves `/tasksd` anywhere: the
 * one-binary console has no server routes at all, and a split console's SPA
 * fallback answers it with index.html. So every tasks read came back as HTML, at
 * HTTP 200, and the module could only report that the engine was unreachable.
 * Reproduced on the local server before the move: GET /tasksd/v1/tasks/namespaces →
 * 200 text/html; after it, GET /v1/tasks/namespaces → 401 {"error":"Sign in to view
 * tasks."}, which is the proxy's own refusal and therefore proof the proxy answered.
 *
 * `/v1/tasks` is the same shape `app/v1/billing` and `app/v1/commerce` already use:
 * more specific than the `app/v1/[...path]` cloud BFF, so it wins on a split console
 * — and in the one-binary build the identical URL reaches the embedded cloud's own
 * tasks surface. One address, both topologies.
 */
const ROUTE = join(__dirname, '..', '..', '..', 'app', 'v1', 'tasks', '[...path]', 'route.ts')

function capture() {
  const seen: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      seen.push(String(url))
      return new Response(JSON.stringify({ namespaces: [] }), { status: 200 })
    }),
  )
  return seen
}

describe('tasks reads go to the clean /v1/tasks head', () => {
  let seen: string[]
  beforeEach(() => {
    seen = capture()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('builds /v1/tasks/<path>, never a private prefix', async () => {
    await TasksApi.namespaces()
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/\/v1\/tasks\/namespaces$/)
    expect(seen[0]).not.toMatch(/tasksd/)
  })

  it('keeps the sub-paths under the same head', async () => {
    await TasksApi.workflows('default', 'WorkflowType="x"')
    expect(seen[0]).toMatch(/\/v1\/tasks\/namespaces\/default\/workflows\?query=/)
  })

  it('a server route actually answers that head (the halves must agree)', () => {
    expect(existsSync(ROUTE)).toBe(true)
  })
})
