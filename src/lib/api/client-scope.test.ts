import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { get } from './client'
import { DEFAULT_ENVIRONMENT, setScope } from '../scope'

/**
 * The project-scope WIRE: selecting a project (lib/scope) must surface as the
 * `X-Project-Id` header on EVERY cloud call, so a customer's launches + usage
 * attribute to org > project (visor reads the header; cloud.SanitizeIdentity has
 * already refused any cross-org claim). The scope STORE is proven in scope.test.ts;
 * this proves the store actually reaches the request the client sends.
 *
 * Black-box: stub the global fetch (authedFetch calls it bare), drive a real `get()`,
 * and read the headers the client stamped — no production seam widened.
 */
function okFetch() {
  return vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify({ status: 'ok', msg: '', data: [] }), { status: 200 }),
  )
}

function headersOf(fn: ReturnType<typeof okFetch>): Record<string, string> {
  const init = fn.mock.calls[0]?.[1]
  return (init?.headers ?? {}) as Record<string, string>
}

describe('project scope → X-Project-Id on every cloud call', () => {
  let fetchMock: ReturnType<typeof okFetch>
  beforeEach(() => {
    fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    setScope({ project: undefined, environment: DEFAULT_ENVIRONMENT }) // org-level default
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    setScope({ project: undefined, environment: DEFAULT_ENVIRONMENT })
  })

  it('org-level (no project selected): org-scoped call, NO X-Project-Id', async () => {
    await get('agents')
    const h = headersOf(fetchMock)
    expect(h['X-Org-Id']).toBeTruthy() // always org-scoped
    expect(h['X-Environment']).toBe('mainnet')
    expect('X-Project-Id' in h).toBe(false) // absent = org-level view
  })

  it('project selected: X-Project-Id is stamped (org > project)', async () => {
    setScope({ project: 'atlas' })
    await get('agents')
    const h = headersOf(fetchMock)
    expect(h['X-Project-Id']).toBe('atlas')
    expect(h['X-Org-Id']).toBeTruthy() // still under the org
  })

  it('project cleared back to org-level: X-Project-Id drops again', async () => {
    setScope({ project: 'atlas' })
    setScope({ project: undefined })
    await get('agents')
    expect('X-Project-Id' in headersOf(fetchMock)).toBe(false)
  })

  it('the active environment rides along as X-Environment alongside the project', async () => {
    setScope({ project: 'atlas', environment: 'testnet' })
    await get('agents')
    const h = headersOf(fetchMock)
    expect(h['X-Environment']).toBe('testnet')
    expect(h['X-Project-Id']).toBe('atlas')
  })
})
