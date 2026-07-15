import { describe, expect, it } from 'vitest'

import type { FleetSample, FleetUnit } from '~/lib/api/fleet'
import {
  capacityLine,
  filterUnits,
  fmtLoad,
  fmtMemPair,
  fmtRatio,
  gpuLabel,
  hasTrend,
  isStale,
  orderUnits,
  sampleLabel,
  seriesOf,
  sessionsSummary,
  sourceLabel,
  sourceOptions,
  statusOptions,
  unitSubtitle,
  unitTitle,
  verdictNote,
  verdictOf,
} from './logic'

const GB = 1024 ** 3
const NOW = 1_700_000_000

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

describe('labels — an unknown backend word shows ITSELF, never a wrong guess', () => {
  it('maps the known sources', () => {
    expect(sourceLabel('agent')).toBe('Agent')
    expect(sourceLabel('byo')).toBe('BYO')
    expect(sourceLabel('visor')).toBe('Visor')
  })
  it('passes an unknown source through and dashes an absent one', () => {
    expect(sourceLabel('edge')).toBe('edge')
    expect(sourceLabel(undefined)).toBe('—')
  })
  it('titles from label → host → id, never empty', () => {
    expect(unitTitle(unit({ label: 'spark', host: 'spark.local' }))).toBe('spark')
    expect(unitTitle(unit({ label: undefined, host: 'spark.local' }))).toBe('spark.local')
    expect(unitTitle(unit({ label: undefined, host: undefined, unit: 'raw-id' }))).toBe('raw-id')
  })
  it('does not repeat the host as a subtitle when it is already the title', () => {
    expect(unitSubtitle(unit({ label: 'spark', host: 'spark.local' }))).toBe('spark.local')
    expect(unitSubtitle(unit({ label: undefined, host: 'spark.local' }))).toBeUndefined()
  })
})

describe('gpuLabel', () => {
  it('groups identical models', () => {
    expect(gpuLabel([{ model: 'H100' }, { model: 'H100' }])).toBe('2× H100')
  })
  it('lists distinct models', () => {
    expect(gpuLabel([{ model: 'GB10' }, { model: 'A100' }])).toBe('1× GB10 · 1× A100')
  })
  it('falls back to the vendor, then a generic, and dashes an empty list', () => {
    expect(gpuLabel([{ vendor: 'amd' }])).toBe('1× amd')
    expect(gpuLabel([{}])).toBe('1× GPU')
    expect(gpuLabel([])).toBe('—')
  })
})

describe('capacityLine — only what was reported appears', () => {
  it('renders the full line', () => {
    expect(capacityLine({ os: 'linux', arch: 'arm64', cpus: 20, memory: 128 * GB, gpus: [{ model: 'GB10' }] })).toBe(
      'linux/arm64 · 20 vCPU · 128.0 GB · 1× GB10',
    )
  })
  it('OMITS an unreported cpu count rather than printing "0 vCPU"', () => {
    expect(capacityLine({ os: 'linux', gpus: [] })).toBe('linux')
    expect(capacityLine({ os: 'linux', gpus: [] })).not.toContain('vCPU')
  })
  it('handles os-only / arch-only', () => {
    expect(capacityLine({ arch: 'amd64', gpus: [] })).toBe('amd64')
    expect(capacityLine({ os: 'darwin', arch: 'arm64', gpus: [] })).toBe('darwin/arm64')
  })
  it('an all-silent spec is a dash, never a fabricated line', () => {
    expect(capacityLine({ gpus: [] })).toBe('—')
  })
})

describe('formatters dash the unknown, never zero it', () => {
  it('fmtLoad', () => {
    expect(fmtLoad(1.5)).toBe('1.50')
    expect(fmtLoad(undefined)).toBe('—')
  })
  it('fmtRatio', () => {
    expect(fmtRatio(0.75)).toBe('75.0%')
    expect(fmtRatio(undefined)).toBe('—')
  })
  it('fmtMemPair needs BOTH halves', () => {
    expect(fmtMemPair(4 * GB, 8 * GB)).toBe('4.0 GB / 8.0 GB')
    expect(fmtMemPair(undefined, 8 * GB)).toBe('—')
    expect(fmtMemPair(4 * GB, undefined)).toBe('—')
  })
})

describe('verdict — attention is reserved for "online but silent"', () => {
  it('flags an online unit that stopped reporting, and explains why', () => {
    const u = unit({ status: 'online', metrics: { at: NOW - 600 } })
    expect(verdictOf(u, NOW)).toBe('attention')
    expect(verdictNote(u, NOW)).toBe('Online but has stopped reporting')
  })
  it('a healthy unit is healthy and carries no note', () => {
    const u = unit({ status: 'online', metrics: { at: NOW - 5 } })
    expect(verdictOf(u, NOW)).toBe('healthy')
    expect(verdictNote(u, NOW)).toBeUndefined()
  })
  it('draining is its own state, not an alarm', () => {
    expect(verdictOf(unit({ status: 'draining', metrics: { at: NOW } }), NOW)).toBe('draining')
  })
  it('offline is quiet — an expected absence is not a fault', () => {
    expect(verdictOf(unit({ status: 'offline', metrics: { at: NOW - 9999 } }), NOW)).toBe('quiet')
  })
  it('an online unit that never reported metrics is healthy, not flagged', () => {
    expect(verdictOf(unit({ status: 'online', metrics: {} }), NOW)).toBe('healthy')
  })
  it('an unknown status is quiet (fails closed)', () => {
    expect(verdictOf(unit({ status: 'suspended' }), NOW)).toBe('quiet')
  })
  it('isStale marks an old heartbeat, and never an absent one', () => {
    expect(isStale(unit({ metrics: { at: NOW - 600 } }), NOW)).toBe(true)
    expect(isStale(unit({ metrics: { at: NOW } }), NOW)).toBe(false)
    expect(isStale(unit({ metrics: {} }), NOW)).toBe(false)
  })
})

describe('filterUnits', () => {
  const units = [
    unit({ unit: 'a', label: 'spark', source: 'byo', status: 'online', spec: { os: 'linux', gpus: [{ model: 'GB10' }] } }),
    unit({ unit: 'b', label: 'laptop', source: 'agent', status: 'offline', spec: { os: 'darwin', gpus: [] } }),
  ]

  it('filters by source and status', () => {
    expect(filterUnits(units, { source: 'byo' }).map((u) => u.unit)).toEqual(['a'])
    expect(filterUnits(units, { status: 'offline' }).map((u) => u.unit)).toEqual(['b'])
  })
  it('`all` and an empty filter keep everything', () => {
    expect(filterUnits(units, { source: 'all', status: 'all' })).toHaveLength(2)
    expect(filterUnits(units, {})).toHaveLength(2)
  })
  it('searches name, os and GPU model, case-insensitively', () => {
    expect(filterUnits(units, { search: 'SPARK' }).map((u) => u.unit)).toEqual(['a'])
    expect(filterUnits(units, { search: 'gb10' }).map((u) => u.unit)).toEqual(['a'])
    expect(filterUnits(units, { search: 'darwin' }).map((u) => u.unit)).toEqual(['b'])
  })
  it('treats the query as a LITERAL substring — a regex metachar is not compiled (ReDoS guard)', () => {
    expect(() => filterUnits(units, { search: '(((((' })).not.toThrow()
    expect(filterUnits(units, { search: '.*' })).toHaveLength(0)
    expect(filterUnits(units, { search: 'a+' })).toHaveLength(0)
  })
  it('combines a source filter with a search', () => {
    expect(filterUnits(units, { source: 'agent', search: 'spark' })).toHaveLength(0)
  })
})

describe('orderUnits — mission control is scanned top-down, so attention leads', () => {
  it('puts flagged units first, then draining, then healthy, then quiet', () => {
    const rows = orderUnits(
      [
        unit({ unit: 'quiet', label: 'd', status: 'offline' }),
        unit({ unit: 'healthy', label: 'c', status: 'online', metrics: { at: NOW } }),
        unit({ unit: 'draining', label: 'b', status: 'draining' }),
        unit({ unit: 'attention', label: 'a', status: 'online', metrics: { at: NOW - 600 } }),
      ],
      NOW,
    )
    expect(rows.map((u) => u.unit)).toEqual(['attention', 'draining', 'healthy', 'quiet'])
  })
  it('orders within a group by name', () => {
    const rows = orderUnits(
      [unit({ unit: '1', label: 'zeta', status: 'online' }), unit({ unit: '2', label: 'alpha', status: 'online' })],
      NOW,
    )
    expect(rows.map((u) => u.label)).toEqual(['alpha', 'zeta'])
  })
  it('does not mutate the input', () => {
    const input = [unit({ unit: '1', label: 'z' }), unit({ unit: '2', label: 'a' })]
    orderUnits(input, NOW)
    expect(input.map((u) => u.unit)).toEqual(['1', '2'])
  })
})

describe('filter options offer only what is actually present', () => {
  const units = [unit({ source: 'byo', status: 'online' }), unit({ unit: 'b', source: 'agent', status: 'draining' })]
  it('lists the present sources/statuses, sorted, with `all` first', () => {
    expect(sourceOptions(units)).toEqual(['all', 'agent', 'byo'])
    expect(statusOptions(units)).toEqual(['all', 'draining', 'online'])
  })
  it('an empty fleet offers only `all` — never a menu of absent options', () => {
    expect(sourceOptions([])).toEqual(['all'])
    expect(statusOptions([])).toEqual(['all'])
  })
})

describe('seriesOf — a gap is honest, a false 0 is a lie', () => {
  const samples: FleetSample[] = [
    { ts: NOW - 120, load1: 1, gpuUtil: 0.5 },
    { ts: NOW - 60 }, // this row carried no load/gpu column
    { ts: NOW, load1: 2, gpuUtil: 0 },
  ]

  it('SKIPS a row missing the column rather than plotting it as 0', () => {
    expect(seriesOf(samples, 'load1', '1h').map((p) => p.value)).toEqual([1, 2])
  })
  it('KEEPS a measured 0 (the row exists because it was measured)', () => {
    expect(seriesOf(samples, 'gpuUtil', '1h').map((p) => p.value)).toEqual([50, 0])
  })
  it('scales gpuUtil 0..1 to a percentage for display', () => {
    expect(seriesOf([{ ts: NOW, gpuUtil: 0.42 }], 'gpuUtil', '1h')[0].value).toBeCloseTo(42)
  })
  it('leaves other units alone', () => {
    expect(seriesOf([{ ts: NOW, memUsed: 4 * GB }], 'memUsed', '1h')[0].value).toBe(4 * GB)
  })
  it('empty in, empty out', () => {
    expect(seriesOf([], 'load1', '1h')).toEqual([])
  })
  it('hasTrend needs two real points — one is not a trend', () => {
    expect(hasTrend([])).toBe(false)
    expect(hasTrend([{ value: 1 }])).toBe(false)
    expect(hasTrend([{ value: 1 }, { value: 2 }])).toBe(true)
  })
})

describe('sampleLabel', () => {
  it('uses a date for the 7d range and a clock time inside a day', () => {
    expect(sampleLabel(NOW, '7d')).toMatch(/\w+ \d+/)
    expect(sampleLabel(NOW, '1h')).toMatch(/\d{1,2}:\d{2}/)
  })
})

describe('sessionsSummary — the unit\'s own counts are authoritative', () => {
  it('reads none / running / idle honestly', () => {
    expect(sessionsSummary(unit({ sessions: 0, running: 0 }))).toBe('No sessions recorded')
    expect(sessionsSummary(unit({ sessions: 3, running: 1 }))).toBe('3 sessions · 1 running now')
    expect(sessionsSummary(unit({ sessions: 3, running: 0 }))).toBe('3 sessions · none running')
  })
  it('singularizes one session', () => {
    expect(sessionsSummary(unit({ sessions: 1, running: 0 }))).toBe('1 session · none running')
  })
})
