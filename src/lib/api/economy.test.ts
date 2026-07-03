import { describe, it, expect } from 'vitest'

import {
  num,
  spreadBps,
  normalizeMarket,
  normalizeMarkets,
  parseTimeMs,
  normalizeTrade,
  normalizeTrades,
  parseDaySeconds,
  normalizeDayData,
  fmtNum,
  fmtPrice,
  fmtSpread,
  type RawMarket,
  type RawFill,
  type RawMarketDayData,
} from './economy'

describe('num — string|number → finite number or honest undefined', () => {
  it('parses real values, drops junk', () => {
    expect(num('12.4875')).toBe(12.4875)
    expect(num(5)).toBe(5)
    expect(num(0)).toBe(0)
    expect(num('')).toBeUndefined()
    expect(num(null)).toBeUndefined()
    expect(num('abc')).toBeUndefined()
    expect(num(undefined)).toBeUndefined()
  })
})

describe('spreadBps — best bid/ask → bps, honest undefined without a two-sided book', () => {
  it('computes (ask-bid)/mid·1e4', () => {
    // bid 100, ask 101 → mid 100.5 → spread ~99.5 bps
    expect(spreadBps(100, 101)).toBeCloseTo(99.5, 1)
  })
  it('undefined when a side is missing or crossed', () => {
    expect(spreadBps(undefined, 5)).toBeUndefined()
    expect(spreadBps(5, undefined)).toBeUndefined()
    expect(spreadBps(0, 5)).toBeUndefined()
    expect(spreadBps(12.4875, 5)).toBeUndefined() // ask < bid (crossed testnet book)
  })
})

describe('normalizeMarket — real dex-subgraph Market shape', () => {
  // The exact wire shape from luxfi/graph indexer/clob.go writeMarket.
  const raw: RawMarket = {
    id: '4c55582f4c4554480000000000000000000000000000000000000000000000d0',
    symbol: 'LETH/LUX',
    baseToken: '0x00',
    quoteToken: '0x01',
    assetsBound: true,
    openOrders: 10,
    remaining: '26.375',
    bestBid: '0.003996',
    bestAsk: '0.004004',
    volume24h: '400',
    tradeCount: 3,
    lastPrice: '0.004',
  }

  it('maps every real field, computes spread', () => {
    const m = normalizeMarket(raw)!
    expect(m.symbol).toBe('LETH/LUX')
    expect(m.bestBid).toBe(0.003996)
    expect(m.bestAsk).toBe(0.004004)
    expect(m.volume24h).toBe(400)
    expect(m.tradeCount).toBe(3)
    expect(m.openOrders).toBe(10)
    expect(m.bookDepth).toBe(26.375)
    expect(m.lastPrice).toBe(0.004)
    expect(m.spreadBps).toBeGreaterThan(0)
  })

  it('honest undefined for absent aggregates (native-only chain)', () => {
    const m = normalizeMarket({ id: 'pool1', symbol: 'X/Y', bestBid: '1', bestAsk: '1.01' })!
    expect(m.volume24h).toBeUndefined()
    expect(m.tradeCount).toBeUndefined()
    expect(m.lastPrice).toBeUndefined()
  })

  it('drops a market with no id; falls back symbol→id when unbound', () => {
    expect(normalizeMarket({ symbol: 'X/Y' })).toBeNull()
    const unbound = normalizeMarket({ id: 'abc123' })!
    expect(unbound.symbol).toBe('abc123')
  })
})

describe('normalizeMarkets — sorted by 24h volume desc', () => {
  it('orders by volume then symbol', () => {
    const raw: RawMarket[] = [
      { id: 'a', symbol: 'A/LUX', volume24h: '100' },
      { id: 'b', symbol: 'B/LUX', volume24h: '500' },
      { id: 'c', symbol: 'C/LUX' }, // no volume → 0
    ]
    expect(normalizeMarkets(raw).map((m) => m.symbol)).toEqual(['B/LUX', 'A/LUX', 'C/LUX'])
  })
})

describe('parseTimeMs — ISO | unix s | unix ms', () => {
  it('handles seconds vs ms heuristically', () => {
    expect(parseTimeMs(1700000000)).toBe(1700000000000) // seconds → ms
    expect(parseTimeMs(1700000000000)).toBe(1700000000000) // already ms
    expect(parseTimeMs('2026-07-01T00:00:00Z')).toBe(Date.parse('2026-07-01T00:00:00Z'))
    expect(parseTimeMs('')).toBeUndefined()
    expect(parseTimeMs(null)).toBeUndefined()
  })
})

describe('normalizeTrade / normalizeTrades — the fill feed', () => {
  const fills: RawFill[] = [
    { id: '172:0', symbol: 'LUX/LUSD', price: '5.0', size: '10.0', side: 'buy', timestamp: 1700000001 },
    { id: '171:2', symbol: 'LUX/LUSD', price: '4.9', quantity: '3', side: 'sell', timestamp: 1700000000 },
    { symbol: 'X/Y' }, // no id → dropped
  ]

  it('normalizes and sorts newest-first', () => {
    const trades = normalizeTrades(fills)
    expect(trades.map((t) => t.id)).toEqual(['172:0', '171:2'])
    expect(trades[0].price).toBe(5)
    expect(trades[0].size).toBe(10)
    expect(trades[1].size).toBe(3) // from `quantity`
    expect(trades[0].side).toBe('buy')
  })

  it('handles empty', () => {
    expect(normalizeTrades(undefined)).toEqual([])
  })
})

describe('day data — honest-empty when the producer is off', () => {
  it('parseDaySeconds handles unix + iso', () => {
    expect(parseDaySeconds(1700000000)).toBe(1700000000)
    expect(parseDaySeconds('2026-07-01T00:00:00Z')).toBe(Math.floor(Date.parse('2026-07-01T00:00:00Z') / 1000))
  })

  it('normalizeDayData maps USD fields, sorts oldest-first, drops undated', () => {
    const raw: RawMarketDayData[] = [
      { id: 'd2', date: 1700086400, volumeUSD: '2000', feesUSD: '6', tvlUSD: '50000' },
      { id: 'd1', date: 1700000000, volumeUSD: '1000' },
      { id: 'bad' }, // no date → dropped
    ]
    const pts = normalizeDayData(raw)
    expect(pts.map((p) => p.date)).toEqual([1700000000, 1700086400])
    expect(pts[1].volumeUSD).toBe(2000)
    expect(pts[1].tvlUSD).toBe(50000)
    expect(pts[0].tvlUSD).toBeUndefined() // honest — not present
  })

  it('unproduced MarketDayData → empty series (never fabricated)', () => {
    expect(normalizeDayData([])).toEqual([])
    expect(normalizeDayData(undefined)).toEqual([])
  })
})

describe('formatters — honest dashes', () => {
  it('fmtNum compacts', () => {
    expect(fmtNum(1_500_000)).toBe('1.50M')
    expect(fmtNum(2_500)).toBe('2.50K')
    expect(fmtNum(42)).toBe('42')
    expect(fmtNum(undefined)).toBe('—')
  })
  it('fmtPrice + fmtSpread', () => {
    expect(fmtPrice(0.004004)).toBe('0.004004')
    expect(fmtPrice(undefined)).toBe('—')
    expect(fmtSpread(3.2)).toBe('3.2 bps')
    expect(fmtSpread(undefined)).toBe('—')
  })
})
