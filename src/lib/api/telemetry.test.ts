import { afterEach, describe, expect, it, vi } from 'vitest'

import { cloudProxyV1Url } from './client'
import { parseAvailability, TelemetryApi } from './telemetry'

// A realistic read: two services, one down, and two trend samples. `range` reports what
// the server actually used, which is NOT what this caller asked for.
const BODY = {
  range: { sinceSec: 3600, stepSec: 60 },
  up: 1,
  total: 2,
  services: [
    { name: 'cloud', up: false },
    { name: 'iam', up: true },
  ],
  series: [
    { t: '2026-08-20T10:00:00Z', up: 2, total: 2 },
    { t: '2026-08-20T10:01:00Z', up: 1, total: 2 },
  ],
}

describe('parseAvailability', () => {
  it('folds the read into the board, keeping the inventory order the server sent', () => {
    const a = parseAvailability(BODY)
    expect(a.up).toBe(1)
    expect(a.total).toBe(2)
    expect(a.services).toEqual([
      { name: 'cloud', up: false },
      { name: 'iam', up: true },
    ])
    expect(a.series).toEqual([
      { t: '2026-08-20T10:00:00Z', up: 2, total: 2 },
      { t: '2026-08-20T10:01:00Z', up: 1, total: 2 },
    ])
  })

  it('reports the range the SERVER used, not the one the caller asked for', () => {
    const a = parseAvailability({ ...BODY, range: { sinceSec: 604_800, stepSec: 3600 } })
    expect(a.range).toEqual({ sinceSec: 604_800, stepSec: 3600 })
  })

  it('keeps a sample whose total is below the fleet total today (a service added since)', () => {
    const a = parseAvailability({ ...BODY, total: 9, series: [{ t: '2026-08-13T10:00:00Z', up: 2, total: 2 }] })
    expect(a.total).toBe(9)
    expect(a.series[0].total).toBe(2)
  })

  it('is honest-zero on an empty or malformed body — never a fabricated up', () => {
    const zero = { up: 0, total: 0, services: [], series: [], range: { sinceSec: 0, stepSec: 0 } }
    expect(parseAvailability({})).toEqual(zero)
    expect(parseAvailability(null)).toEqual(zero)
    expect(parseAvailability({ up: 'many', total: null, services: 'nope', series: {} })).toEqual(zero)
  })

  it('drops a nameless service and a timeless sample, and counts a missing up as down', () => {
    const a = parseAvailability({
      services: [{ name: '', up: true }, { up: true }, { name: 'kms' }],
      series: [{ up: 1, total: 1 }, { t: '', up: 1 }, { t: '2026-08-20T10:00:00Z' }],
    })
    expect(a.services).toEqual([{ name: 'kms', up: false }])
    expect(a.series).toEqual([{ t: '2026-08-20T10:00:00Z', up: 0, total: 0 }])
  })
})

describe('TelemetryApi.availability addresses the fleet availability read', () => {
  const seen: string[] = []
  const stubFetch = (body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        seen.push(String(u))
        return { status: 200, ok: true, text: async () => JSON.stringify(body), json: async () => body } as unknown as Response
      }),
    )
  afterEach(() => {
    seen.length = 0
    vi.unstubAllGlobals()
  })

  it('reads /v1/o11y/availability bare when the caller takes the server defaults', async () => {
    stubFetch(BODY)
    const a = await TelemetryApi.availability()
    expect(seen).toEqual([cloudProxyV1Url('o11y/availability')])
    expect(a.up).toBe(1)
  })

  it('passes range and stepSec as query params, omitting the ones not given', async () => {
    stubFetch(BODY)
    await TelemetryApi.availability(86_400)
    await TelemetryApi.availability(604_800, 3600)
    expect(seen).toEqual([
      `${cloudProxyV1Url('o11y/availability')}?range=86400`,
      `${cloudProxyV1Url('o11y/availability')}?range=604800&stepSec=3600`,
    ])
  })
})
