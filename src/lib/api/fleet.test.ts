import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cloudProxyV1Url } from './client'
import {
  agoLabel,
  findUnit,
  FleetApi,
  freshnessOf,
  isOnline,
  memRatio,
  memTotal,
  needsAttention,
  normalizeMetrics,
  normalizeSample,
  normalizeSamples,
  normalizeSpec,
  normalizeUnit,
  normalizeUnits,
  sampleSeconds,
  STALE_AFTER_S,
  summarize,
  unitKey,
  type FleetUnit,
} from './fleet'

const GB = 1024 ** 3

/** A minimal real unit; override per case. */
const unit = (over: Partial<FleetUnit> = {}): FleetUnit => ({
  unit: 'u1',
  source: 'agent',
  kind: 'laptop',
  status: 'online',
  spec: { gpus: [] },
  metrics: {},
  sessions: 0,
  running: 0,
  ...over,
})

describe('FleetApi routes to the /v1 bearer BFF and never sends an org', () => {
  const seen: string[] = []
  const stubFetch = (body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(String(url))
        return { status: 200, ok: true, text: async () => JSON.stringify(body), json: async () => body } as unknown as Response
      }),
    )
  afterEach(() => {
    seen.length = 0
    vi.unstubAllGlobals()
  })

  it('units() reads /v1/fleet (the head 403s a cookie-only call, so it must hit the BFF)', async () => {
    stubFetch({ units: [] })
    await FleetApi.units()
    expect(seen[0]).toBe(cloudProxyV1Url('fleet'))
    expect(seen[0]).toContain('/v1/fleet')
  })

  it('samples() passes unit/source/range and defaults the range to 24h', async () => {
    stubFetch({ samples: [] })
    await FleetApi.samples({ unit: 'u1', source: 'agent' })
    const u = new URL(seen[0], 'https://console.hanzo.ai')
    expect(u.pathname).toBe('/v1/fleet/samples')
    expect(u.searchParams.get('unit')).toBe('u1')
    expect(u.searchParams.get('source')).toBe('agent')
    expect(u.searchParams.get('range')).toBe('24h')
  })

  it('an explicit range wins; an absent source is omitted, never sent empty', async () => {
    stubFetch({ samples: [] })
    await FleetApi.samples({ unit: 'u1', range: '7d' })
    const u = new URL(seen[0], 'https://console.hanzo.ai')
    expect(u.searchParams.get('range')).toBe('7d')
    expect(u.searchParams.has('source')).toBe(false)
  })

  it('NEVER sends an org — tenancy is the bearer, so no request may carry an org param', async () => {
    stubFetch({ units: [] })
    await FleetApi.units()
    await FleetApi.samples({ unit: 'u1', source: 'byo', range: '1h' })
    for (const url of seen) {
      expect(url).not.toMatch(/[?&](org|orgId|owner|tenant)=/i)
    }
  })
})

describe('normalizeUnits — wire tolerance, never throws', () => {
  it('unwraps {units} (the contract), a bare array, {items} and {data:{units}}', () => {
    expect(normalizeUnits({ units: [{ unit: 'a' }, { unit: 'b' }] })).toHaveLength(2)
    expect(normalizeUnits([{ unit: 'a' }])).toHaveLength(1)
    expect(normalizeUnits({ items: [{ unit: 'a' }] })).toHaveLength(1)
    expect(normalizeUnits({ status: 'ok', data: { units: [{ unit: 'a' }] } })).toHaveLength(1)
  })

  it('drops an idless row rather than inventing an unaddressable unit', () => {
    expect(normalizeUnits({ units: [{ unit: 'a' }, { label: 'no id' }] })).toHaveLength(1)
    expect(normalizeUnit({})).toBeNull()
    expect(normalizeUnit('garbage')).toBeNull()
  })

  it('never throws on garbage', () => {
    expect(() => normalizeUnits(null)).not.toThrow()
    expect(normalizeUnits(null)).toEqual([])
    expect(normalizeUnits('nope')).toEqual([])
    expect(normalizeUnits({ units: 'not-an-array' })).toEqual([])
  })

  it('reads a full unit', () => {
    const u = normalizeUnit({
      unit: 'gb10-1',
      source: 'byo',
      kind: 'gpu',
      status: 'online',
      label: 'spark',
      host: 'spark.local',
      spec: { os: 'linux', arch: 'arm64', cpus: 20, memory: 128 * GB, gpus: [{ vendor: 'nvidia', model: 'GB10', memory: 120 * GB }] },
      metrics: { load1: 1.5, memUsed: 40 * GB, memFree: 88 * GB, gpuUtil: 0.75, at: 1_700_000_000 },
      sessions: 3,
      running: 1,
    })
    expect(u).not.toBeNull()
    expect(u?.spec.cpus).toBe(20)
    expect(u?.spec.gpus[0].model).toBe('GB10')
    expect(u?.metrics.gpuUtil).toBe(0.75)
    expect(u?.sessions).toBe(3)
    expect(u?.running).toBe(1)
  })

  it('keeps an UNKNOWN source/kind/status verbatim — a new backend word must not be coerced into a lie', () => {
    const u = normalizeUnit({ unit: 'a', source: 'edge', kind: 'tpu', status: 'suspended' })
    expect(u?.source).toBe('edge')
    expect(u?.kind).toBe('tpu')
    expect(u?.status).toBe('suspended')
    // …and it is NOT counted as online (fails closed).
    expect(isOnline(u as FleetUnit)).toBe(false)
  })
})

describe('the "unknown ⇒ —" rule on /v1/fleet (omitempty makes a real 0 indistinguishable)', () => {
  it('leaves absent telemetry undefined so the view renders — , never 0', () => {
    const m = normalizeMetrics({})
    expect(m.load1).toBeUndefined()
    expect(m.memUsed).toBeUndefined()
    expect(m.gpuUtil).toBeUndefined()
    expect(m.at).toBeUndefined()
  })

  it('treats an explicit 0 as UNKNOWN — a silent host must not read as an idle one', () => {
    const m = normalizeMetrics({ load1: 0, memUsed: 0, gpuUtil: 0, at: 0 })
    expect(m.load1).toBeUndefined()
    expect(m.memUsed).toBeUndefined()
    expect(m.gpuUtil).toBeUndefined()
    expect(m.at).toBeUndefined()
  })

  it('leaves absent/zero spec undefined (cpus, memory, VRAM)', () => {
    const s = normalizeSpec({ cpus: 0, memory: 0, gpus: [{ model: 'A100', memory: 0 }] })
    expect(s.cpus).toBeUndefined()
    expect(s.memory).toBeUndefined()
    expect(s.gpus[0].memory).toBeUndefined()
    expect(s.gpus[0].model).toBe('A100')
  })

  it('spec.gpus is always an array — a missing list is [], never undefined', () => {
    expect(normalizeSpec({}).gpus).toEqual([])
    expect(normalizeSpec({ gpus: 'nope' }).gpus).toEqual([])
    expect(normalizeUnit({ unit: 'a' })?.spec.gpus).toEqual([])
  })

  it('counts we keep (sessions/running) DO read 0 — absence means no rows, not silence', () => {
    const u = normalizeUnit({ unit: 'a' })
    expect(u?.sessions).toBe(0)
    expect(u?.running).toBe(0)
  })

  it('rejects a non-finite or negative number rather than rendering it', () => {
    const m = normalizeMetrics({ load1: -1, memUsed: Number.NaN, gpuUtil: Number.POSITIVE_INFINITY })
    expect(m.load1).toBeUndefined()
    expect(m.memUsed).toBeUndefined()
    expect(m.gpuUtil).toBeUndefined()
  })

  it('clamps gpuUtil to the documented 0..1', () => {
    expect(normalizeMetrics({ gpuUtil: 1.5 }).gpuUtil).toBe(1)
    expect(normalizeMetrics({ gpuUtil: 0.5 }).gpuUtil).toBe(0.5)
  })

  it('reads memUsed/memFree in snake_case too', () => {
    const m = normalizeMetrics({ mem_used: 4 * GB, mem_free: 4 * GB, gpu_util: 0.5 })
    expect(m.memUsed).toBe(4 * GB)
    expect(m.memFree).toBe(4 * GB)
    expect(m.gpuUtil).toBe(0.5)
  })
})

describe('normalizeSamples — a warehouse row, where 0 IS a measurement', () => {
  it('keeps a measured 0 (the row exists because something was measured)', () => {
    const s = normalizeSample({ ts: 1_700_000_000, load1: 0, gpu_util: 0, mem_used: 0 })
    expect(s.load1).toBe(0)
    expect(s.gpuUtil).toBe(0)
    expect(s.memUsed).toBe(0)
  })

  it('reads the snake_case columns and their camelCase twins', () => {
    const a = normalizeSample({ ts: 1, mem_used: 5, mem_free: 6, gpu_util: 0.4, gpu_model: 'H100', cost_cents: 120 })
    expect(a).toMatchObject({ memUsed: 5, memFree: 6, gpuUtil: 0.4, gpuModel: 'H100', costCents: 120 })
    const b = normalizeSample({ ts: 1, memUsed: 5, gpuUtil: 0.4, costCents: 120 })
    expect(b).toMatchObject({ memUsed: 5, gpuUtil: 0.4, costCents: 120 })
  })

  it('parses a 64-bit int serialized as a STRING (the warehouse does this)', () => {
    expect(normalizeSample({ ts: 1, cost_cents: '1234', mem_used: '8589934592' })).toMatchObject({
      costCents: 1234,
      memUsed: 8589934592,
    })
  })

  it('leaves an absent column undefined so the chart shows a gap, not a false 0', () => {
    const s = normalizeSample({ ts: 1 })
    expect(s.load1).toBeUndefined()
    expect(s.gpuUtil).toBeUndefined()
  })

  it('drops a row with no timestamp and sorts oldest-first', () => {
    const rows = normalizeSamples({ samples: [{ ts: 30, load1: 3 }, { load1: 9 }, { ts: 10, load1: 1 }] })
    expect(rows.map((r) => r.ts)).toEqual([10, 30])
  })

  it('unwraps {samples}/{rows}/bare array; garbage → []', () => {
    expect(normalizeSamples({ samples: [{ ts: 1 }] })).toHaveLength(1)
    expect(normalizeSamples({ rows: [{ ts: 1 }] })).toHaveLength(1)
    expect(normalizeSamples([{ ts: 1 }])).toHaveLength(1)
    expect(normalizeSamples(null)).toEqual([])
  })
})

describe('sampleSeconds — a chart that plots ms as s is wrong by 50,000 years', () => {
  it('passes seconds through and collapses milliseconds', () => {
    expect(sampleSeconds(1_700_000_000)).toBe(1_700_000_000)
    expect(sampleSeconds(1_700_000_000_000)).toBe(1_700_000_000)
  })
  it('parses an ISO string', () => {
    expect(sampleSeconds('2023-11-14T22:13:20.000Z')).toBe(1_700_000_000)
  })
  it('undefined for garbage/zero', () => {
    expect(sampleSeconds(0)).toBeUndefined()
    expect(sampleSeconds('nope')).toBeUndefined()
    expect(sampleSeconds(null)).toBeUndefined()
  })
})

describe('freshness — three states, because "never reported" is not "went quiet"', () => {
  const now = 1_700_000_000

  it('fresh inside the window, stale past it', () => {
    expect(freshnessOf(now, now)).toBe('fresh')
    expect(freshnessOf(now - STALE_AFTER_S, now)).toBe('fresh')
    expect(freshnessOf(now - STALE_AFTER_S - 1, now)).toBe('stale')
  })

  it('unknown (NOT stale) when the unit never reported', () => {
    expect(freshnessOf(undefined, now)).toBe('unknown')
    expect(freshnessOf(0, now)).toBe('unknown')
  })

  it('a server clock ahead of the browser reads fresh, never a negative age', () => {
    expect(freshnessOf(now + 30, now)).toBe('fresh')
    expect(agoLabel(now + 30, now)).toBe('0s ago')
  })

  it('agoLabel scales s → m → h → d, and dashes an absent heartbeat', () => {
    expect(agoLabel(now - 12, now)).toBe('12s ago')
    expect(agoLabel(now - 240, now)).toBe('4m ago')
    expect(agoLabel(now - 3 * 3600, now)).toBe('3h ago')
    expect(agoLabel(now - 2 * 86400, now)).toBe('2d ago')
    expect(agoLabel(undefined, now)).toBe('—')
  })
})

describe('needsAttention — online but silent is the one signal worth surfacing', () => {
  const now = 1_700_000_000
  const silent = now - 600

  it('flags an online unit that stopped reporting', () => {
    expect(needsAttention(unit({ status: 'online', metrics: { at: silent } }), now)).toBe(true)
  })

  it('does NOT flag an offline unit — an expected absence is not a fault', () => {
    expect(needsAttention(unit({ status: 'offline', metrics: { at: silent } }), now)).toBe(false)
  })

  it('does NOT flag a unit that never reported metrics (e.g. a cluster)', () => {
    expect(needsAttention(unit({ status: 'online', metrics: {} }), now)).toBe(false)
  })

  it('does NOT flag a healthy online unit', () => {
    expect(needsAttention(unit({ status: 'online', metrics: { at: now - 5 } }), now)).toBe(false)
  })
})

describe('memRatio / memTotal', () => {
  it('derives the total from used+free and the ratio from it', () => {
    expect(memTotal({ memUsed: 3 * GB, memFree: GB })).toBe(4 * GB)
    expect(memRatio({ memUsed: 3 * GB, memFree: GB })).toBe(0.75)
  })
  it('undefined when the host reported neither half', () => {
    expect(memTotal({})).toBeUndefined()
    expect(memRatio({})).toBeUndefined()
  })
  it('undefined when used is unknown — never a 0% bar for a silent host', () => {
    expect(memRatio({ memFree: 4 * GB })).toBeUndefined()
  })
})

describe('summarize — partial sums are labelled, never passed off as the whole fleet', () => {
  const now = 1_700_000_000

  it('counts total/online and the online-but-silent set', () => {
    const s = summarize(
      [
        unit({ unit: 'a', status: 'online', metrics: { at: now } }),
        unit({ unit: 'b', status: 'online', metrics: { at: now - 600 } }),
        unit({ unit: 'c', status: 'offline' }),
        unit({ unit: 'd', status: 'draining', metrics: { at: now } }),
      ],
      now,
    )
    expect(s.total).toBe(4)
    expect(s.online).toBe(2)
    expect(s.stale).toBe(1)
  })

  it('sums only what was reported and says how many units that was', () => {
    const s = summarize([unit({ spec: { cpus: 8, memory: 16 * GB, gpus: [] } }), unit({ unit: 'b', spec: { gpus: [] } })], now)
    expect(s.cpus).toBe(8)
    expect(s.cpusFrom).toBe(1) // 1 of 2 units reported — the tile can say so
    expect(s.memory).toBe(16 * GB)
    expect(s.memoryFrom).toBe(1)
  })

  it('averages gpuUtil over REPORTING units only — a silent unit must not be averaged in as 0', () => {
    const s = summarize(
      [
        unit({ unit: 'a', metrics: { gpuUtil: 0.8 } }),
        unit({ unit: 'b', metrics: {} }), // silent: must NOT drag the mean to 0.4
      ],
      now,
    )
    expect(s.gpuUtil).toBe(0.8)
    expect(s.gpuUtilFrom).toBe(1)
  })

  it('undefined (⇒ —) for every total when nothing reported', () => {
    const s = summarize([unit(), unit({ unit: 'b' })], now)
    expect(s.cpus).toBeUndefined()
    expect(s.memory).toBeUndefined()
    expect(s.gpus).toBeUndefined()
    expect(s.gpuUtil).toBeUndefined()
    expect(s.total).toBe(2)
  })

  it('counts GPUs across units', () => {
    const s = summarize(
      [
        unit({ unit: 'a', spec: { gpus: [{ model: 'H100' }, { model: 'H100' }] } }),
        unit({ unit: 'b', spec: { gpus: [{ model: 'GB10' }] } }),
        unit({ unit: 'c', spec: { gpus: [] } }),
      ],
      now,
    )
    expect(s.gpus).toBe(3)
    expect(s.gpusFrom).toBe(2)
  })

  it('an empty fleet is all-zero/undefined, never a crash', () => {
    const s = summarize([], now)
    expect(s).toMatchObject({ total: 0, online: 0, stale: 0, cpusFrom: 0, gpuUtil: undefined })
  })
})

describe('unit identity is the (source, unit) PAIR — an id is unique only within a source', () => {
  it('keys on the pair', () => {
    expect(unitKey({ source: 'agent', unit: 'box' })).toBe('agent/box')
    expect(unitKey({ source: 'byo', unit: 'box' })).not.toBe(unitKey({ source: 'agent', unit: 'box' }))
  })

  it('findUnit disambiguates two sources sharing an id', () => {
    const units = [unit({ unit: 'box', source: 'agent', label: 'A' }), unit({ unit: 'box', source: 'byo', label: 'B' })]
    expect(findUnit(units, 'agent', 'box')?.label).toBe('A')
    expect(findUnit(units, 'byo', 'box')?.label).toBe('B')
    expect(findUnit(units, 'cloud', 'box')).toBeUndefined()
  })
})
