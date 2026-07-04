import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { type NextRequest } from 'next/server'

/**
 * Mock the identity boundary so the end-to-end forward test never touches IAM/cloud:
 * a resolved user in a DEDICATED org (maxpower → per-org billing subject `maxpower`).
 * If a request slips past the 401/501/CSRF gates it will reach the mocked fetch; the
 * tests assert exactly when it does and what it carries.
 */
vi.mock('./identity', () => ({
  resolveUser: vi.fn(async () => ({ owner: 'maxpower', name: 'dave', id: 'maxpower/dave' })),
  adminBearer: vi.fn(async () => 'test-bearer'),
}))

import { forwardBilling, isTextualContentType } from './billing-proxy'

const HOST = 'console.hanzo.ai'
const COMMERCE = 'http://commerce.test'

/** A NextRequest stand-in with the fields forwardBilling reads. */
function req(
  method: string,
  opts: { headers?: Record<string, string>; search?: string; body?: string } = {},
): NextRequest {
  const body = opts.body ?? ''
  return {
    method,
    headers: new Headers({ host: HOST, origin: `https://${HOST}`, ...opts.headers }),
    nextUrl: { search: opts.search ?? '' },
    signal: undefined,
    text: async () => body,
  } as unknown as NextRequest
}

/** Query params of the LAST upstream fetch URL. */
function calledQuery(fetchMock: ReturnType<typeof vi.fn>): URLSearchParams {
  const url = String((fetchMock.mock.calls[0] as unknown[])[0])
  return new URL(url).searchParams
}
function calledInit(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  return (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit
}

describe('isTextualContentType — the binary/text passthrough decision (pure)', () => {
  it('treats JSON / text / xml / form as textual (read as text)', () => {
    for (const ct of [
      'application/json',
      'application/json; charset=utf-8',
      'application/problem+json',
      'text/plain',
      'text/csv; charset=utf-8',
      'application/xml',
      'application/x-www-form-urlencoded',
      '', // no header → defaults to JSON
    ]) {
      expect(isTextualContentType(ct)).toBe(true)
    }
  })

  it('treats PDF / octet-stream / images as BINARY (stream raw bytes, never text())', () => {
    for (const ct of ['application/pdf', 'application/pdf; qs=1', 'application/octet-stream', 'image/png', 'image/jpeg']) {
      expect(isTextualContentType(ct)).toBe(false)
    }
  })
})

describe('forwardBilling — gates (auth / config / CSRF)', () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))

  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
    process.env.COMMERCE_URL = COMMERCE
    process.env.COMMERCE_TOKEN = 'svc-token'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    delete process.env.COMMERCE_URL
    delete process.env.COMMERCE_TOKEN
  })

  it('401s with no session and never fetches upstream', async () => {
    const identity = await import('./identity')
    vi.mocked(identity.resolveUser).mockResolvedValueOnce(null as never)
    const res = await forwardBilling(req('GET'), ['balance'])
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('501s when COMMERCE_TOKEN is unset (honest not-configured), never fetches', async () => {
    delete process.env.COMMERCE_TOKEN
    const res = await forwardBilling(req('GET'), ['balance'])
    expect(res.status).toBe(501)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a cross-origin mutating request (CSRF) with 403, never fetches', async () => {
    const res = await forwardBilling(
      req('DELETE', { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }),
      ['payment-methods', 'pm_1'],
    )
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an unsafe path segment (traversal) with 400', async () => {
    const res = await forwardBilling(req('GET'), ['invoices', '..', 'pdf'])
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('forwardBilling — tenant scoping (every verb pinned to the caller subject)', () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))

  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
    process.env.COMMERCE_URL = COMMERCE
    process.env.COMMERCE_TOKEN = 'svc-token'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.COMMERCE_URL
    delete process.env.COMMERCE_TOKEN
  })

  it('pins user/userId/customerId to the server-resolved subject + drops a forged org (GET)', async () => {
    // The exploit: a browser tries to widen scope with query params.
    await forwardBilling(req('GET', { search: '?userId=victim&customerId=victim&org=victim' }), ['subscriptions'])
    const q = calledQuery(fetchMock)
    expect(q.get('user')).toBe('maxpower')
    expect(q.get('userId')).toBe('maxpower')
    expect(q.get('customerId')).toBe('maxpower')
    expect(q.get('org')).toBeNull()
    // X-Org-Id + the service Bearer are server-injected (browser never holds them).
    const init = calledInit(fetchMock)
    expect((init.headers as Record<string, string>)['X-Org-Id']).toBe('maxpower')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer svc-token')
  })

  it('proxies DELETE (payment-method detach) — method + scoped query, no forged body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const res = await forwardBilling(req('DELETE'), ['payment-methods', 'pm_1'])
    expect(res.status).toBe(204)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = String((fetchMock.mock.calls[0] as unknown[])[0])
    expect(url.startsWith(`${COMMERCE}/v1/billing/payment-methods/pm_1?`)).toBe(true)
    const init = calledInit(fetchMock)
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined() // a bodyless DELETE sends NO body (not '')
    const q = calledQuery(fetchMock)
    expect(q.get('customerId')).toBe('maxpower')
  })

  it('pins the subject onto a WRITE body (create-payment-method) — forged body subject overwritten', async () => {
    await forwardBilling(
      req('POST', { body: JSON.stringify({ type: 'card', token: 'cnon:nonce', userId: 'victim' }) }),
      ['payment-methods'],
    )
    const init = calledInit(fetchMock)
    const sent = JSON.parse(init.body as string) as Record<string, unknown>
    expect(sent.type).toBe('card')
    expect(sent.token).toBe('cnon:nonce')
    expect(sent.userId).toBe('maxpower') // forged 'victim' overwritten
    expect(sent.user).toBe('maxpower')
    expect(sent.customerId).toBe('maxpower')
  })
})

describe('forwardBilling — invoice PDF binary passthrough (task F)', () => {
  // A PDF with NON-UTF8 bytes: if the proxy read it as text() and re-encoded, these
  // bytes would be mangled to the replacement char. Byte-identical output proves the
  // raw-bytes passthrough.
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0xfe, 0x00, 0x99, 0x0a])
  const fetchMock = vi.fn(
    async () =>
      new Response(pdfBytes, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="invoice-inv_1.pdf"',
        },
      }),
  )

  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
    process.env.COMMERCE_URL = COMMERCE
    process.env.COMMERCE_TOKEN = 'svc-token'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.COMMERCE_URL
    delete process.env.COMMERCE_TOKEN
  })

  it('streams the PDF bytes UNMODIFIED + forwards Content-Type & Content-Disposition', async () => {
    const res = await forwardBilling(req('GET'), ['invoices', 'inv_1', 'pdf'])
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="invoice-inv_1.pdf"')
    expect(res.headers.get('cache-control')).toBe('no-store, must-revalidate')
    const out = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(out)).toEqual(Array.from(pdfBytes)) // byte-for-byte, no text() mangling
  })

  it('keeps the PDF GET tenant-scoped (subject pinned on query + X-Org-Id from session)', async () => {
    // A user tries to pull with a forged subject; the proxy pins its OWN subject.
    await forwardBilling(req('GET', { search: '?userId=victim' }), ['invoices', 'inv_1', 'pdf'])
    const url = String((fetchMock.mock.calls[0] as unknown[])[0])
    expect(url.startsWith(`${COMMERCE}/v1/billing/invoices/inv_1/pdf?`)).toBe(true)
    const q = calledQuery(fetchMock)
    expect(q.get('userId')).toBe('maxpower') // forged 'victim' overwritten
    expect(q.get('user')).toBe('maxpower')
    expect(q.get('customerId')).toBe('maxpower')
    const init = calledInit(fetchMock)
    expect((init.headers as Record<string, string>)['X-Org-Id']).toBe('maxpower')
  })
})
