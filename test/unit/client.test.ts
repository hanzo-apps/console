import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  get,
  getList,
  post,
  idOf,
  v1Url,
  restGet,
  restDelete,
  ApiError,
} from '~/lib/api/client'

/** Build a Fetch Response double from an envelope/body. */
function res(opts: {
  ok?: boolean
  status?: number
  json?: unknown
  text?: string
  throwJson?: boolean
}): Response {
  const status = opts.status ?? (opts.ok === false ? 500 : 200)
  return {
    ok: opts.ok ?? status < 400,
    status,
    json: async () => {
      if (opts.throwJson) throw new Error('not json')
      return opts.json
    },
    text: async () => opts.text ?? '',
  } as unknown as Response
}

const okEnvelope = <T>(data: T, data2?: unknown) => ({ status: 'ok', msg: '', data, data2 })

describe('client.request (casibase envelope)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('GET unwraps `data`, sends credentials + Accept-Language, and NO client X-Org-Id', async () => {
    const fetchMock = vi.fn(async () => res({ json: okEnvelope({ name: 'z' }) }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await get<{ name: string }>('get-account')
    expect(out).toEqual({ name: 'z' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://console.hanzo.ai/v1/get-account')
    expect(init.credentials).toBe('include')
    expect(init.headers['Accept-Language']).toBeDefined()
    // Tenancy is derived server-side from the session; a client-set tenant header
    // is spoofable and is NOT a trust boundary, so it must not be sent.
    expect(init.headers['X-Org-Id']).toBeUndefined()
  })

  it('does not send X-Org-Id on the plain-REST path either', async () => {
    const fetchMock = vi.fn(async () => res({ status: 200, text: JSON.stringify({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    await restGet(v1Url('vector'))
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers['X-Org-Id']).toBeUndefined()
  })

  it('GET appends query params, skipping null/undefined', async () => {
    const fetchMock = vi.fn(async () => res({ json: okEnvelope([]) }))
    vi.stubGlobal('fetch', fetchMock)
    await get('get-providers', { owner: 'hanzo', page: 2, skip: undefined, none: null })
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.searchParams.get('owner')).toBe('hanzo')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.has('skip')).toBe(false)
    expect(url.searchParams.has('none')).toBe(false)
  })

  it('POST sets Content-Type and JSON-encodes the body', async () => {
    const fetchMock = vi.fn(async () => res({ json: okEnvelope('done') }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await post('add-provider', { name: 'p' })
    expect(r.status).toBe('ok')
    const init = fetchMock.mock.calls[0][1]
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ name: 'p' }))
  })

  it('throws ApiError(401) on unauthorized BEFORE reading the body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ ok: false, status: 401 })))
    await expect(get('get-account')).rejects.toMatchObject({ name: 'ApiError', status: 401 })
  })

  it('throws ApiError(403) on forbidden', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ ok: false, status: 403 })))
    await expect(get('iam/get-organizations')).rejects.toMatchObject({ status: 403 })
  })

  it('throws ApiError on a non-ok envelope (status:"error")', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ json: { status: 'error', msg: 'boom', data: null } })))
    await expect(get('x')).rejects.toThrow('boom')
  })

  it('wraps a network failure as ApiError(0)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))
    await expect(get('x')).rejects.toMatchObject({ name: 'ApiError', status: 0 })
  })

  it('reports an invalid JSON body honestly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ ok: false, status: 500, throwJson: true })))
    await expect(get('x')).rejects.toThrow(/Invalid response from server/)
  })
})

describe('getList total', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('uses data2 when it is a number', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ json: okEnvelope([{ a: 1 }], 42) })))
    const { rows, total } = await getList<{ a: number }[]>('get-providers')
    expect(rows).toHaveLength(1)
    expect(total).toBe(42)
  })

  it('falls back to array length when data2 is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ json: okEnvelope([1, 2, 3]) })))
    expect((await getList('x')).total).toBe(3)
  })

  it('is 0 for a non-array payload with no data2', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ json: okEnvelope({ not: 'array' }) })))
    expect((await getList('x')).total).toBe(0)
  })
})

describe('plain-REST layer', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('restGet returns parsed JSON on 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ status: 200, text: JSON.stringify({ ok: true }) })))
    expect(await restGet(v1Url('vector'))).toEqual({ ok: true })
  })

  it('restDelete resolves to undefined on 204', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ status: 204, text: '' })))
    await expect(restDelete(v1Url('vector/foo'))).resolves.toBeUndefined()
  })

  it('restRequest surfaces a {msg|error} body on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ ok: false, status: 400, text: JSON.stringify({ error: 'bad name' }) })))
    await expect(restGet(v1Url('vector'))).rejects.toThrow('bad name')
  })

  it('restRequest throws ApiError(403)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ ok: false, status: 403, text: '' })))
    await expect(restGet(v1Url('vector'))).rejects.toMatchObject({ status: 403 })
  })
})

describe('url + id helpers', () => {
  it('v1Url builds /v1/<path> on the cloud base by default', () => {
    expect(v1Url('vector/foo')).toBe('https://console.hanzo.ai/v1/vector/foo')
    expect(v1Url('apps', 'https://platform.hanzo.ai')).toBe('https://platform.hanzo.ai/v1/apps')
  })

  it('idOf joins owner/name and URL-encodes the name', () => {
    expect(idOf('hanzo', 'gpt-4')).toBe('hanzo/gpt-4')
    expect(idOf('hanzo', 'a b/c')).toBe('hanzo/a%20b%2Fc')
  })

  it('ApiError carries a numeric status (default 0)', () => {
    expect(new ApiError('x').status).toBe(0)
    expect(new ApiError('x', 404).status).toBe(404)
    expect(new ApiError('x') instanceof Error).toBe(true)
  })
})
