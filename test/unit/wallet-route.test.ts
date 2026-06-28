import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Deterministic on-chain receipt: a successful HUSD Transfer(from → treasury) of
// 5e18 base units = 500 cents. Mocked so the route's verify path is hermetic.
const HUSD = '0x' + 'a'.repeat(40)
const TREASURY = '0x' + 'b'.repeat(40)
const FROM = '0x' + 'c'.repeat(40)

vi.mock('ethers', () => {
  class JsonRpcProvider {
    constructor(_url: string, _cid: number) {}
    async getTransactionReceipt(_hash: string) {
      return { status: 1, logs: [{ address: HUSD, topics: ['0xddf2'], data: '0x' }] }
    }
  }
  class Interface {
    constructor(_abi: unknown) {}
    parseLog(_log: unknown) {
      return { name: 'Transfer', args: { from: FROM, to: TREASURY, value: 5000000000000000000n } }
    }
  }
  return { ethers: { JsonRpcProvider, Interface, getAddress: (a: string) => a } }
})

import { POST } from '../../app/billing/topup/wallet/route'

const ORIGIN = 'https://console.hanzo.ai'
const TXHASH = '0x' + '1'.repeat(64)

const reqWith = (body: unknown, cookie?: string): NextRequest =>
  new NextRequest(`${ORIGIN}/billing/topup/wallet`, {
    method: 'POST',
    headers: cookie ? { cookie, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const accountRes = (account: unknown) =>
  new Response(JSON.stringify({ status: 'ok', msg: '', data: account }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const SESSION_USER = { owner: 'hanzo', name: 'realuser', isAdmin: false, type: 'normal-user' }

/** Mock get-account + commerce; capture the commerce payment request. */
function mockBackend(account: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    if (String(url).includes('/v1/get-account')) return accountRes(account)
    if (String(url).includes('/v1/billing/payment'))
      return new Response(JSON.stringify({ status: 'recorded' }), { status: 200 })
    if (String(url).includes('/v1/billing/balance'))
      return new Response(JSON.stringify({ balance: 500 }), { status: 200 })
    return new Response('{}', { status: 200 })
  })
  vi.stubGlobal('fetch', f)
  return calls
}

const configured = () => {
  vi.stubEnv('HANZO_HUSD_ADDRESS', HUSD)
  vi.stubEnv('HANZO_HUSD_TREASURY', TREASURY)
  vi.stubEnv('COMMERCE_URL', 'https://commerce.test')
  vi.stubEnv('CLOUD_URL', 'https://cloud-api.test') // pinned session authority
}

describe('wallet top-up — IDOR + idempotency', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('501 when HUSD/treasury is not configured (greenfield)', async () => {
    const r = await POST(reqWith({ txHash: TXHASH }, 'sid=1'))
    expect(r.status).toBe(501)
  })

  it('401 when configured but there is no session', async () => {
    configured()
    mockBackend(null)
    const r = await POST(reqWith({ txHash: TXHASH })) // no cookie
    expect(r.status).toBe(401)
  })

  it('credits the SESSION user (ignores a spoofed body.userId) and keys idempotency on txHash', async () => {
    configured()
    const calls = mockBackend(SESSION_USER)

    const r = await POST(reqWith({ txHash: TXHASH, userId: 'victim-account' }, 'sid=1'))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ creditedCents: 500, txHash: TXHASH })

    const payment = calls.find((c) => c.url.includes('/v1/billing/payment'))!
    expect(payment, 'recorded to commerce').toBeTruthy()
    // IDOR fix: the recorded user is the SESSION user, NOT the spoofed body value.
    const sent = JSON.parse(String(payment.init.body))
    expect(sent.userId).toBe('realuser')
    expect(sent.userId).not.toBe('victim-account')
    // Idempotency: the tx hash is the replay key.
    expect((payment.init.headers as Record<string, string>)['Idempotency-Key']).toBe(TXHASH)

    // Balance is read for the SESSION user too, never a client value.
    const balance = calls.find((c) => c.url.includes('/v1/billing/balance'))!
    expect(balance.url).toContain('user=realuser')
  })

  it('rejects a malformed tx hash with 400', async () => {
    configured()
    mockBackend(SESSION_USER)
    const r = await POST(reqWith({ txHash: 'not-a-hash' }, 'sid=1'))
    expect(r.status).toBe(400)
  })
})
