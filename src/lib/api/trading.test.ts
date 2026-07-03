import { describe, it, expect } from 'vitest'

import {
  parseMakerMetrics,
  normalizeBook,
  fmtBps,
  fmtCount,
  fmtBurn,
  fmtUptime,
  type RawBookOrder,
} from './trading'

// A realistic maker Prometheus scrape (the exact `coherence_*` exposition the
// maker's coherence_http.go emits), including per-symbol gauges + scalar counters.
const SCRAPE = `# HELP coherence_requotes_total two-sided book re-pegs to the Kraken mid
# TYPE coherence_requotes_total counter
coherence_requotes_total 42
# HELP coherence_arbs_total corrective arb swaps
# TYPE coherence_arbs_total counter
coherence_arbs_total 3
# HELP coherence_probes_total taker probe trades issued
# TYPE coherence_probes_total counter
coherence_probes_total 10
# HELP coherence_fills_total settled DEXFills measured
# TYPE coherence_fills_total counter
coherence_fills_total 7
# HELP coherence_errors_total reference/peg errors
# TYPE coherence_errors_total counter
coherence_errors_total 0
# HELP coherence_uptime_seconds service uptime
# TYPE coherence_uptime_seconds gauge
coherence_uptime_seconds 8130.5
# HELP coherence_burn_lux cumulative base-fee burn
# TYPE coherence_burn_lux gauge
coherence_burn_lux 0.00421
# HELP coherence_total_gas cumulative gas
# TYPE coherence_total_gas gauge
coherence_total_gas 168400
# HELP coherence_peg_error_bps last book-mid tracking error vs Kraken (bps)
# TYPE coherence_peg_error_bps gauge
coherence_peg_error_bps{symbol="LETH/LUX"} 3.2
coherence_peg_error_bps{symbol="LBTC/LUX"} 1.1
# HELP coherence_peg_error_p50_bps median
# TYPE coherence_peg_error_p50_bps gauge
coherence_peg_error_p50_bps{symbol="LETH/LUX"} 2.5
# HELP coherence_peg_error_p99_bps p99
# TYPE coherence_peg_error_p99_bps gauge
coherence_peg_error_p99_bps{symbol="LETH/LUX"} 9.8
# HELP coherence_realized_error_bps last realized fill vs Kraken
# TYPE coherence_realized_error_bps gauge
coherence_realized_error_bps{symbol="LETH/LUX"} -10.4
`

describe('parseMakerMetrics — Prometheus text → MakerStatus', () => {
  const s = parseMakerMetrics(SCRAPE)

  it('reads the scalar counters + gauges', () => {
    expect(s.requotes).toBe(42)
    expect(s.arbs).toBe(3)
    expect(s.probes).toBe(10)
    expect(s.fills).toBe(7)
    expect(s.errors).toBe(0)
    expect(s.uptimeSeconds).toBe(8130.5)
    expect(s.burnLux).toBeCloseTo(0.00421, 6)
  })

  it('groups per-symbol gauges by symbol, sorted', () => {
    expect(s.symbols.map((x) => x.symbol)).toEqual(['LBTC/LUX', 'LETH/LUX'])
    const leth = s.symbols.find((x) => x.symbol === 'LETH/LUX')!
    expect(leth.pegErrorBps).toBe(3.2)
    expect(leth.pegP50Bps).toBe(2.5)
    expect(leth.pegP99Bps).toBe(9.8)
    expect(leth.realizedErrorBps).toBe(-10.4)
    const lbtc = s.symbols.find((x) => x.symbol === 'LBTC/LUX')!
    expect(lbtc.pegErrorBps).toBe(1.1)
    // LBTC has no p50/p99/realized line — honest undefined, never a fabricated 0.
    expect(lbtc.pegP50Bps).toBeUndefined()
    expect(lbtc.realizedErrorBps).toBeUndefined()
  })

  it('a real 0 is 0, a missing metric is undefined (no fabrication)', () => {
    expect(s.errors).toBe(0)
    const empty = parseMakerMetrics('# nothing\n')
    expect(empty.requotes).toBeUndefined()
    expect(empty.symbols).toEqual([])
  })

  it('ignores comments, blanks, and non-coherence lines', () => {
    const noisy = parseMakerMetrics('go_gc_duration_seconds 1\n\n# c\ncoherence_fills_total 9\n')
    expect(noisy.fills).toBe(9)
  })
})

describe('normalizeBook — dex_get_orders → book orders', () => {
  it('keeps rows with an order id, drops the rest', () => {
    const raw: RawBookOrder[] = [
      { orderId: 1, user: '0xabc' },
      { user: '0xdef' }, // no orderId → dropped
      { orderId: 2 }, // no user → empty user string
    ]
    expect(normalizeBook(raw)).toEqual([
      { orderId: 1, user: '0xabc' },
      { orderId: 2, user: '' },
    ])
  })

  it('handles empty/undefined', () => {
    expect(normalizeBook(undefined)).toEqual([])
    expect(normalizeBook([])).toEqual([])
  })
})

describe('formatters — honest dashes', () => {
  it('fmtBps', () => {
    expect(fmtBps(3.2)).toBe('3.2 bps')
    expect(fmtBps(0)).toBe('0.0 bps')
    expect(fmtBps(undefined)).toBe('—')
  })
  it('fmtCount', () => {
    expect(fmtCount(1204)).toBe('1,204')
    expect(fmtCount(0)).toBe('0')
    expect(fmtCount(undefined)).toBe('—')
  })
  it('fmtBurn', () => {
    expect(fmtBurn(0.00421)).toBe('0.0042 LUX')
    expect(fmtBurn(undefined)).toBe('—')
  })
  it('fmtUptime', () => {
    expect(fmtUptime(8130)).toBe('2h 15m')
    expect(fmtUptime(90)).toBe('1m')
    expect(fmtUptime(5)).toBe('5s')
    expect(fmtUptime(undefined)).toBe('—')
  })
})
