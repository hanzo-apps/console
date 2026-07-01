import { describe, it, expect } from 'vitest'

import type { OverviewData, OverviewEvent, OverviewHealth } from './config'
import {
  formatMetric,
  deltaOf,
  hasTrend,
  statusColor,
  healthColor,
  severityColor,
  worstHealth,
  healthTally,
  selectKpi,
  selectSeries,
  selectDistribution,
  distributionTotal,
  mergeActivity,
  windowRows,
  isSkeleton,
  ago,
  OK,
  WARN,
  BAD,
  MUTED,
} from './logic'

/**
 * The tile logic is the honesty + correctness core of every LivingOverview tile,
 * so it is pinned exhaustively: formatters never emit NaN/undefined, an absent
 * KPI/series/distribution slice degrades to a real empty (never a crash), a live
 * sparkline draws only with ≥2 real points, deltas read "—" with no basis, the
 * activity stream de-dupes across polls, and the virtualization window is correct.
 */

const emptyData = (): OverviewData => ({ kpi: {}, series: {}, distribution: {}, activity: [], alerts: [], health: [] })

describe('formatMetric — unit-aware, never NaN', () => {
  it('count is compacted', () => {
    expect(formatMetric(1500, 'count')).toBe('1.5K')
    expect(formatMetric(42)).toBe('42') // default unit = count
  })
  it('cents render as USD (compact past $1000)', () => {
    expect(formatMetric(500, 'cents')).toBe('$5.00')
    expect(formatMetric(123456, 'cents')).toBe('$1.2K')
  })
  it('ms render as a duration', () => {
    expect(formatMetric(850, 'ms')).toBe('850ms')
    expect(formatMetric(2500, 'ms')).toBe('2.5s')
    expect(formatMetric(45000, 'ms')).toBe('45s')
  })
  it('pct rounds to a percent', () => {
    expect(formatMetric(98.7, 'pct')).toBe('99%')
  })
  it('a non-finite value is an honest em-dash, never NaN', () => {
    expect(formatMetric(NaN, 'count')).toBe('—')
    expect(formatMetric(Infinity, 'cents')).toBe('—')
  })
})

describe('deltaOf — honest "—" when there is no prior basis', () => {
  it('computes a rounded ±% and direction', () => {
    expect(deltaOf({ value: 150, prior: 100 })).toEqual({ pct: 50, up: true })
    expect(deltaOf({ value: 80, prior: 100 })).toEqual({ pct: -20, up: false })
  })
  it('is null with no prior / zero prior / no kpi', () => {
    expect(deltaOf({ value: 5 })).toBeNull()
    expect(deltaOf({ value: 5, prior: 0 })).toBeNull()
    expect(deltaOf(undefined)).toBeNull()
  })
})

describe('hasTrend — live sparkline gate', () => {
  it('needs ≥2 finite points', () => {
    expect(hasTrend([1, 2])).toBe(true)
    expect(hasTrend([1])).toBe(false)
    expect(hasTrend([])).toBe(false)
    expect(hasTrend(undefined)).toBe(false)
    expect(hasTrend([1, NaN])).toBe(false) // only one real point
  })
})

describe('status / health / severity colors — the one mapping', () => {
  it('status dot', () => {
    expect(statusColor('error')).toBe(BAD)
    expect(statusColor('warning')).toBe(WARN)
    expect(statusColor('success')).toBe(OK)
    expect(statusColor('')).toBe(OK) // completed ledger row reads nominal
  })
  it('health dot', () => {
    expect(healthColor('green')).toBe(OK)
    expect(healthColor('yellow')).toBe(WARN)
    expect(healthColor('red')).toBe(BAD)
    expect(healthColor('')).toBe(MUTED) // unknown
  })
  it('alert severity dot', () => {
    expect(severityColor('critical')).toBe(BAD)
    expect(severityColor('warning')).toBe(WARN)
    expect(severityColor('info')).toBe(MUTED)
  })
})

describe('worstHealth / healthTally — board header', () => {
  const rows = (verdicts: string[]): OverviewHealth[] => verdicts.map((h, i) => ({ service: `s${i}`, health: h }))
  it('worst is red > yellow > green', () => {
    expect(worstHealth(rows(['green', 'yellow', 'red']))).toBe('red')
    expect(worstHealth(rows(['green', 'yellow', 'green']))).toBe('yellow')
    expect(worstHealth(rows(['green', 'green']))).toBe('green')
    expect(worstHealth([])).toBe('') // no rows → honest unknown
  })
  it('tallies healthy/total', () => {
    expect(healthTally(rows(['green', 'green', 'red', 'yellow']))).toEqual({ healthy: 2, total: 4 })
  })
})

describe('slice selectors — absent slice → honest empty, never crash', () => {
  it('returns undefined/[] for missing keys', () => {
    const d = emptyData()
    expect(selectKpi(d, 'tokens')).toBeUndefined()
    expect(selectSeries(d, 'spend')).toBeUndefined()
    expect(selectDistribution(d, 'byModel')).toEqual([])
  })
  it('returns present slices', () => {
    const d: OverviewData = { ...emptyData(), kpi: { tokens: { value: 5 } }, distribution: { byModel: [{ label: 'a', value: 1 }] } }
    expect(selectKpi(d, 'tokens')).toEqual({ value: 5 })
    expect(selectDistribution(d, 'byModel')).toHaveLength(1)
  })
  it('distributionTotal sums positives only', () => {
    expect(distributionTotal([{ label: 'a', value: 3 }, { label: 'b', value: -1 }, { label: 'c', value: 2 }])).toBe(5)
    expect(distributionTotal([])).toBe(0)
  })
})

describe('mergeActivity — live stream grows, de-duped, newest-first, capped', () => {
  const ev = (id: string, iso: string, status = 'success'): OverviewEvent => ({ id, time: iso, title: id, status })
  it('prepends new rows and de-dupes by id', () => {
    const current = [ev('b', '2026-06-30T12:00:00Z'), ev('a', '2026-06-30T11:00:00Z')]
    const incoming = [ev('c', '2026-06-30T13:00:00Z'), ev('b', '2026-06-30T12:00:00Z')] // b already present
    const merged = mergeActivity(current, incoming, 10)
    expect(merged.map((e) => e.id)).toEqual(['c', 'b', 'a']) // newest first, b once
  })
  it('caps the ring', () => {
    const current = [ev('a', '2026-06-30T10:00:00Z')]
    const incoming = [ev('c', '2026-06-30T13:00:00Z'), ev('b', '2026-06-30T12:00:00Z')]
    expect(mergeActivity(current, incoming, 2).map((e) => e.id)).toEqual(['c', 'b'])
  })
  it('keeps id-less rows (cannot dedupe) but still orders by time', () => {
    const merged = mergeActivity([ev('', '2026-06-30T10:00:00Z')], [ev('', '2026-06-30T12:00:00Z')], 10)
    expect(merged).toHaveLength(2)
    expect(Date.parse(merged[0].time)).toBeGreaterThan(Date.parse(merged[1].time))
  })
})

describe('windowRows — virtualization window (long streams)', () => {
  const rows = Array.from({ length: 100 }, (_, i) => i)
  it('slices only the visible window + overscan', () => {
    const w = windowRows(rows, 0, 40, 400, 2) // 10 visible + overscan
    expect(w.start).toBe(0)
    expect(w.slice[0]).toBe(0)
    expect(w.padTop).toBe(0)
    expect(w.padBottom).toBeGreaterThan(0)
    expect(w.slice.length).toBeLessThan(rows.length) // NOT all 100 rendered
  })
  it('offsets the window on scroll and pads correctly', () => {
    const w = windowRows(rows, 40 * 20, 40, 400, 2)
    expect(w.start).toBe(18) // 20 - overscan
    expect(w.padTop).toBe(18 * 40)
  })
  it('is empty-safe', () => {
    expect(windowRows([], 0, 40, 400).slice).toEqual([])
  })
})

describe('isSkeleton + ago — loading state + relative time', () => {
  it('skeletons on first load only', () => {
    expect(isSkeleton({ s: 'loading' })).toBe(true)
    expect(isSkeleton({ s: 'ready', v: 1 })).toBe(false)
    expect(isSkeleton({ s: 'error', message: 'x', status: 404 })).toBe(false)
  })
  it('formats relative time and is honest for a bad stamp', () => {
    const now = Date.parse('2026-06-30T12:00:00Z')
    expect(ago('2026-06-30T11:59:30Z', now)).toBe('30s ago')
    expect(ago('2026-06-30T11:30:00Z', now)).toBe('30m ago')
    expect(ago('2026-06-30T09:00:00Z', now)).toBe('3h ago')
    expect(ago('2026-06-28T12:00:00Z', now)).toBe('2d ago')
    expect(ago('not-a-date', now)).toBe('—')
  })
})
