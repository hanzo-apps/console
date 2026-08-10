import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  TelApi,
  NUMBER_TYPES,
  rate,
  rows,
  searchQuery,
  normalizeNumber,
  normalizeCall,
  normalizeMessage,
  normalizeSummary,
  normalizeNumbers,
  normalizeAvailable,
  normalizeCalls,
  normalizeMessages,
} from './tel'

/**
 * Telecom API + pure helpers. The module calls the DOCUMENTED cloud `/v1/tel`
 * contract same-origin, keyless and prefix-free (`originV1Url` → `<origin>/v1/tel`);
 * the `tel` head is allow-listed so `app/v1/[...path]` mints a user bearer for it.
 * These tests pin (1) that each call hits the EXACT same-origin `/v1/tel` path (never
 * a direct cloud-origin call, which 403s), (2) that the real `apps/tel/carrier.go`
 * JSON shape normalizes, (3) that the `{data:[…]}` envelope zip's typed ops write is
 * read, (4) that garbage/absent fields degrade to safe defaults rather than throwing,
 * and (5) that `country` — which the backend 400s without — always rides a search.
 */
const ORIGIN = 'https://console.hanzo.ai'

describe('Telecom normalizers — real carrier.go JSON shape, defensive', () => {
  it('normalizes a number with all fields', () => {
    const n = normalizeNumber({
      id: 'num_1', e164: '+14155550123', country: 'US', type: 'local',
      capable: ['voice', 'sms'], monthly: 115, currency: 'USD', org: 'hanzo',
    })
    expect(n).toEqual({
      id: 'num_1', e164: '+14155550123', country: 'US', type: 'local',
      capable: ['voice', 'sms'], monthly: 115, currency: 'USD',
    })
  })

  it('coerces missing/garbage fields to safe defaults (never throws)', () => {
    expect(normalizeNumber({ id: 'num_2' })).toEqual({
      id: 'num_2', e164: '', country: '', type: '', capable: [], monthly: 0, currency: '',
    })
    // `capable` is a JSON array in the store; a non-array degrades to empty.
    expect(normalizeNumber({ id: 'n', capable: 'voice' }).capable).toEqual([])
    // A non-object degrades to an id-less record, filtered out of lists.
    expect(normalizeNumber(null).id).toBe('')
    expect(normalizeNumbers({ data: [null, 'x', { id: 'num_3', e164: '+1' }] }).map((n) => n.id)).toEqual(['num_3'])
  })

  it('normalizes a call and a message', () => {
    expect(normalizeCall({ id: 'call_1', from: '+1', to: '+2', status: 'ringing', agent: 'support' })).toEqual({
      id: 'call_1', from: '+1', to: '+2', status: 'ringing', agent: 'support',
    })
    expect(normalizeMessage({ id: 'msg_1', from: '+1', to: '+2', text: 'hi', status: 'queued' })).toEqual({
      id: 'msg_1', from: '+1', to: '+2', text: 'hi', status: 'queued',
    })
    // An unreported status is EMPTY, never invented — StatusTag renders "unknown".
    expect(normalizeCall({ id: 'call_2' }).status).toBe('')
  })

  it('reads the {data:[…]} envelope zip typed ops write (and any other key, or a bare array)', () => {
    expect(normalizeCalls({ data: [{ id: 'c1' }, { id: 'c2' }] }).length).toBe(2)
    expect(normalizeMessages({ items: [{ id: 'm1' }] }).length).toBe(1)
    expect(normalizeNumbers([{ id: 'n1' }]).length).toBe(1)
    expect(rows({ nothing: 1 })).toEqual([])
    expect(normalizeSummary({ numbers: 2, calls: 9, messages: 4 })).toEqual({ numbers: 2, calls: 9, messages: 4 })
  })

  it('keeps a search result on its E.164, because inventory carries no id until bought', () => {
    // The carrier's `/numbers/available` rows have no id — filtering on one (as the
    // held-numbers list does) would discard every row a search returns.
    const found = normalizeAvailable({ data: [{ e164: '+14155550123', country: 'US' }] })
    expect(found.map((n) => n.e164)).toEqual(['+14155550123'])
    expect(normalizeNumbers({ data: [{ e164: '+14155550123' }] })).toEqual([])
  })
})

describe('Telecom display + query helpers (pure)', () => {
  it('renders a carrier rate in the currency it quoted, and says nothing about an unquoted one', () => {
    expect(rate(115, 'USD')).toBe('$1.15')
    // 0 means the carrier quoted no rate — an em-dash, never "$0.00".
    expect(rate(0, 'USD')).toBe('—')
    expect(rate(-5, 'USD')).toBe('—')
    // An unrecognized ISO code makes Intl throw; the amount is still true.
    expect(rate(250, 'NOTACURRENCY')).toBe('2.50 NOTACURRENCY')
    // No currency reported falls back to USD rather than dropping the amount.
    expect(rate(100, '')).toBe('$1.00')
  })

  it('always sends country and drops what was not asked', () => {
    expect(searchQuery({ country: 'US' })).toBe('country=US')
    expect(searchQuery({ country: 'GB', area: '20', type: 'mobile', limit: 5 })).toBe(
      'country=GB&area=20&type=mobile&limit=5',
    )
    // A zero/absent limit is not a filter the backend should see.
    expect(searchQuery({ country: 'US', limit: 0 })).toBe('country=US')
  })

  it('exposes the number types the backend documents', () => {
    expect(NUMBER_TYPES).toEqual(['local', 'national', 'tollfree', 'mobile'])
  })
})

describe('TelApi — hits the same-origin /v1/tel contract (rewritten to the /v1 bearer proxy)', () => {
  const fetched: { url: string; method: string; body?: string }[] = []

  beforeEach(() => {
    fetched.length = 0
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
    }
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      fetched.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined })
      const body = url.includes('/summary')
        ? { numbers: 1, calls: 0, messages: 0 }
        : { data: [{ id: 'num_1', e164: '+14155550123' }] }
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
      )
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('lists the numbers this org holds via the same-origin /v1/tel path', async () => {
    const out = await TelApi.numbers.list()
    expect(fetched[0]).toMatchObject({ url: `${ORIGIN}/v1/tel/numbers`, method: 'GET' })
    expect(out.map((n) => n.e164)).toEqual(['+14155550123'])
  })

  it('searches carrier inventory with the required country on the query string', async () => {
    await TelApi.numbers.available({ country: 'US', area: '415' })
    expect(fetched[0].url).toBe(`${ORIGIN}/v1/tel/numbers/available?country=US&area=415`)
  })

  it('buys a number by E.164 and releases one by id', async () => {
    await TelApi.numbers.buy('+14155550123')
    expect(fetched[0]).toMatchObject({ url: `${ORIGIN}/v1/tel/numbers`, method: 'POST' })
    expect(JSON.parse(fetched[0].body as string)).toEqual({ e164: '+14155550123' })

    await TelApi.numbers.release('num_1')
    expect(fetched[1]).toMatchObject({ url: `${ORIGIN}/v1/tel/numbers/num_1`, method: 'DELETE' })
  })

  it('lists and places calls, and hangs one up by id', async () => {
    await TelApi.calls.list()
    expect(fetched[0]).toMatchObject({ url: `${ORIGIN}/v1/tel/calls`, method: 'GET' })

    await TelApi.calls.place({ from: '+14155550123', to: '+14155550124', agent: 'support' })
    expect(fetched[1]).toMatchObject({ url: `${ORIGIN}/v1/tel/calls`, method: 'POST' })
    expect(JSON.parse(fetched[1].body as string)).toMatchObject({ from: '+14155550123', agent: 'support' })

    await TelApi.calls.hangup('call_1')
    expect(fetched[2]).toMatchObject({ url: `${ORIGIN}/v1/tel/calls/call_1`, method: 'DELETE' })
  })

  it('lists and sends messages', async () => {
    await TelApi.messages.list()
    expect(fetched[0]).toMatchObject({ url: `${ORIGIN}/v1/tel/messages`, method: 'GET' })

    await TelApi.messages.send({ from: '+14155550123', to: '+14155550124', text: 'hi' })
    expect(fetched[1]).toMatchObject({ url: `${ORIGIN}/v1/tel/messages`, method: 'POST' })
    expect(JSON.parse(fetched[1].body as string)).toEqual({ from: '+14155550123', to: '+14155550124', text: 'hi' })
  })

  it('reads the per-org summary', async () => {
    const s = await TelApi.summary()
    expect(fetched[0].url).toBe(`${ORIGIN}/v1/tel/summary`)
    expect(s).toEqual({ numbers: 1, calls: 0, messages: 0 })
  })

  it('encodes an id into the path rather than splicing it (a slashed id cannot walk out)', async () => {
    await TelApi.calls.hangup('a/b')
    expect(fetched[0].url).toBe(`${ORIGIN}/v1/tel/calls/a%2Fb`)
  })
})
