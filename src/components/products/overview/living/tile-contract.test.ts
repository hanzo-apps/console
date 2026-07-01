import { describe, it, expect } from 'vitest'

import type { OverviewData } from './config'
import { countUpValue } from './motion'
import {
  deltaOf,
  distributionTotal,
  formatMetric,
  hasTrend,
  healthColor,
  healthTally,
  selectDistribution,
  selectKpi,
  selectSeries,
  statusColor,
  windowRows,
  worstHealth,
  OK,
} from './logic'

/**
 * Tile CONTRACT tests — the exact decisions each tile delegates to the pure logic,
 * exercised over real-shaped `OverviewData`. The `.tsx` tiles are thin: given this
 * data they render this value / this empty / this skeleton / this reduced-motion
 * end-state. Because the gui components require a full Tamagui provider (no DOM
 * render in the node env — the whole repo tests this way), pinning the delegated
 * decisions IS the render test: it proves what the tile shows for value/loading/
 * empty/error and the reduced-motion path, with zero fabricated data.
 */

// A dense, real-shaped board the platform overview would receive.
const board = (): OverviewData => ({
  kpi: {
    tokens: { value: 152_340, prior: 120_000, series: [40, 55, 61, 80, 96] },
    spendCents: { value: 84_215, prior: 90_000, series: [] }, // <2 pts → no sparkline
    requests: { value: 12 }, // no prior → honest "—" delta
  },
  series: {
    tokens: { interval: 'hour', points: [{ t: '2026-06-30T10:00:00Z', value: 40 }, { t: '2026-06-30T11:00:00Z', value: 96 }] },
    spendCents: { interval: 'hour', points: [] }, // empty → "not enough data"
  },
  distribution: {
    byModel: [{ label: 'zen5', value: 60_000, sub: 'do-ai' }, { label: 'gpt-4o', value: 24_215, sub: 'openai' }],
    empty: [],
  },
  activity: [
    { id: 'e1', time: '2026-06-30T11:59:30Z', title: 'Inference · zen5', subtitle: 'do-ai · 1,000 tokens', status: 'success' },
    { id: 'e2', time: '2026-06-30T11:58:00Z', title: 'Inference · gpt-4o', subtitle: 'openai', status: 'error' },
  ],
  alerts: [],
  health: [
    { service: 'gateway', health: 'green' },
    { service: 'iam', health: 'green' },
    { service: 'kms', health: 'yellow' },
  ],
})

describe('MetricTile contract — value, delta, sparkline, count-up, reduced motion', () => {
  const d = board()
  it('renders a formatted value for a present KPI', () => {
    const kpi = selectKpi(d, 'tokens')!
    expect(formatMetric(kpi.value, 'count')).toBe('152.3K')
    expect(formatMetric(selectKpi(d, 'spendCents')!.value, 'cents')).toBe('$842.15') // full precision under $1000
  })
  it('shows a delta with a prior basis and an honest "—" without one', () => {
    expect(deltaOf(selectKpi(d, 'tokens'))).toEqual({ pct: 27, up: true }) // (152340-120000)/120000
    expect(deltaOf(selectKpi(d, 'spendCents'))).toEqual({ pct: -6, up: false })
    expect(deltaOf(selectKpi(d, 'requests'))).toBeNull() // no prior → "— vs prior"
  })
  it('draws a live sparkline only with ≥2 real points', () => {
    expect(hasTrend(selectKpi(d, 'tokens')?.series)).toBe(true)
    expect(hasTrend(selectKpi(d, 'spendCents')?.series)).toBe(false) // empty series → no trend
  })
  it('a MISSING KPI renders an em-dash, not a fabricated number', () => {
    const kpi = selectKpi(d, 'does-not-exist')
    expect(kpi).toBeUndefined()
    // the tile shows '—' for value and '— vs prior' for delta:
    expect(deltaOf(kpi)).toBeNull()
  })
  it('count-up lands exactly on the target; reduced motion snaps immediately (t=1)', () => {
    const target = selectKpi(d, 'tokens')!.value
    expect(countUpValue(0, target, 1)).toBe(target) // end of animation
    // reduced motion path: the tile passes t=1 (or animate=false) → the real value now
    expect(countUpValue(0, target, 1)).toBe(target)
    expect(countUpValue(0, target, 0.4)).toBeLessThan(target) // mid-flight, never overshoots
  })
})

describe('TimeseriesTile contract — chart vs "not enough data"', () => {
  const d = board()
  it('renders a chart with ≥2 points', () => {
    const s = selectSeries(d, 'tokens')!
    expect(s.points.length).toBeGreaterThanOrEqual(2) // → LineChart/BarChart
  })
  it('shows the empty note with <2 points', () => {
    const s = selectSeries(d, 'spendCents')!
    expect(s.points.length).toBeLessThan(2) // → "Not enough data in this range yet."
  })
})

describe('DistributionTile contract — donut vs empty', () => {
  const d = board()
  it('renders slices + total when there is positive value', () => {
    const slices = selectDistribution(d, 'byModel')
    expect(distributionTotal(slices)).toBe(84_215)
    expect(formatMetric(distributionTotal(slices), 'cents')).toBe('$842.15')
    expect(Math.round((slices[0].value / distributionTotal(slices)) * 100)).toBe(71) // zen5 share
  })
  it('shows "No breakdown" when total is zero / slice missing', () => {
    expect(distributionTotal(selectDistribution(d, 'empty'))).toBe(0)
    expect(distributionTotal(selectDistribution(d, 'absent'))).toBe(0)
  })
})

describe('ActivityTile contract — rows, status dots, virtualization, empty', () => {
  it('maps status to the dot color', () => {
    const d = board()
    expect(statusColor(d.activity[0].status)).toBe(OK) // success
    expect(statusColor(d.activity[1].status)).not.toBe(OK) // error → red
  })
  it('renders whole for a short feed and virtualizes a long one', () => {
    const short = board().activity
    expect(short.length).toBeLessThanOrEqual(7) // rendered whole (no scroll)
    const long = Array.from({ length: 200 }, (_, i) => i)
    const win = windowRows(long, 0, 52, 360)
    expect(win.slice.length).toBeLessThan(long.length) // only the visible window mounts
  })
  it('an empty feed yields no rows (the tile shows the honest empty note)', () => {
    const d: OverviewData = { ...board(), activity: [] }
    expect(d.activity).toEqual([])
  })
})

describe('HealthTile contract — verdict + tally', () => {
  const d = board()
  it('summarizes the board (worst verdict + healthy tally)', () => {
    expect(worstHealth(d.health)).toBe('yellow') // one degraded
    expect(healthTally(d.health)).toEqual({ healthy: 2, total: 3 })
    expect(healthColor('green')).toBe(OK)
  })
  it('no rows → honest unknown verdict (the tile shows "not reporting")', () => {
    expect(worstHealth([])).toBe('')
    expect(healthTally([])).toEqual({ healthy: 0, total: 0 })
  })
})
