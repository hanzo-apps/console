import { afterEach, describe, expect, it, vi } from 'vitest'

import { index, opsFor } from './ops'
import { allowCloudSurface } from '~/lib/server/proxy-allow'

/** Rows shaped exactly as cloud's command projection serves them. */
const list = [
  {
    Service: 'widget',
    Name: 'list',
    OperationID: 'get_widget',
    Summary: 'List widgets',
    Method: 'GET',
    Path: '/v1/widget',
  },
  {
    Service: 'widget',
    Name: 'delete',
    OperationID: 'delete_widget',
    Summary: '',
    Method: 'DELETE',
    Path: '/v1/widget/:id',
  },
  // Serviceless, but its first /v1 segment names the product.
  { Service: '', Name: 'parts', OperationID: 'get_gadget_parts', Method: 'GET', Path: '/v1/gadget/parts' },
  { Service: 'other', Name: 'list', OperationID: 'get_other', Method: 'GET', Path: '/v1/other' },
  // Serviced for the product but mounted off /v1: the service wins.
  { Service: 'widget', Name: 'healthz', OperationID: 'get_widget_healthz', Method: 'GET', Path: '/_/widget/healthz' },
  // Incomplete rows are dropped rather than half-rendered.
  { Service: 'widget', Name: 'broken', OperationID: '', Method: 'GET', Path: '/v1/widget/broken' },
]

describe('index', () => {
  it('picks up every operation the projection files under the product', () => {
    expect(index(list, 'widget').map((o) => `${o.method} ${o.path}`)).toEqual([
      'GET /_/widget/healthz',
      'GET /v1/widget',
      'DELETE /v1/widget/:id',
    ])
  })

  it('files a serviceless operation by its first /v1 segment', () => {
    expect(index(list, 'gadget').map((o) => o.path)).toEqual(['/v1/gadget/parts'])
  })

  it('never takes an operation belonging to another product', () => {
    expect(index(list, 'widget').some((o) => o.path === '/v1/other')).toBe(false)
  })

  it('carries the name the operation is addressed by, and drops a row without one', () => {
    const ops = index(list, 'widget')
    expect(ops.find((o) => o.path === '/v1/widget')?.name).toBe('get_widget')
    expect(ops.some((o) => o.path === '/v1/widget/broken')).toBe(false)
  })

  it('leaves an empty summary absent rather than rendering an empty dash', () => {
    expect(index(list, 'widget').find((o) => o.method === 'DELETE')?.summary).toBeUndefined()
  })

  it('reads a garbage projection as no operations rather than throwing', () => {
    for (const bad of [null, undefined, 42, 'nope', {}, [null], [{ Path: 5 }]])
      expect(index(bad, 'widget')).toEqual([])
  })
})

describe('opsFor', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('reads the projection through the console own-origin /v1 form, once per session', async () => {
    const urls: string[] = []
    const store = new Map<string, string>()
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: 'https://console.hanzo.ai', hostname: 'console.hanzo.ai' },
      localStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    }
    vi.stubGlobal('fetch', (url: string) => {
      urls.push(String(url))
      return Promise.resolve(
        new Response(JSON.stringify(list), { status: 200, headers: { 'content-type': 'application/json' } }),
      )
    })

    expect((await opsFor('widget')).length).toBe(3)
    expect(urls).toEqual(['https://console.hanzo.ai/v1/openapi/commands'])

    // A second product reuses the list in hand — one read per session, not per press.
    expect((await opsFor('gadget')).length).toBe(1)
    expect(urls).toHaveLength(1)
  })

  it('is admitted by the same-origin proxy', () => {
    expect(allowCloudSurface('v1/openapi/commands')).toBe(true)
  })
})
