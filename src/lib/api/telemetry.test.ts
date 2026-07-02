import { describe, expect, it } from 'vitest'

import {
  parseInstant,
  parseRange,
  serviceNameOf,
  toServiceHealth,
  summarizeHealth,
  windowOf,
  type Sample,
} from './telemetry'

describe('parseInstant', () => {
  it('parses an instant vector into finite samples', () => {
    const body = {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          { metric: { __name__: 'up', job: 'iam-health', instance: 'iam.hanzo.svc:80' }, value: [1783024403, '1'] },
          { metric: { __name__: 'up', job: 'cloud-health', instance: 'cloud.hanzo.svc:80' }, value: [1783024403, '0'] },
        ],
      },
    }
    const out = parseInstant(body)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ metric: expect.objectContaining({ job: 'iam-health' }), value: 1, ts: 1783024403 })
    expect(out[1].value).toBe(0)
  })

  it('drops non-finite values and tolerates a missing/empty result', () => {
    const body = { data: { result: [{ metric: { job: 'x' }, value: [1, 'NaN'] }, { metric: { job: 'y' } }] } }
    expect(parseInstant(body)).toEqual([])
    expect(parseInstant({})).toEqual([])
    expect(parseInstant(null)).toEqual([])
  })
})

describe('parseRange', () => {
  it('parses a matrix into ordered finite points', () => {
    const body = {
      data: {
        resultType: 'matrix',
        result: [{ metric: {}, values: [[100, '5'], [160, '6'], [220, 'NaN']] }],
      },
    }
    const s = parseRange(body)
    expect(s).toHaveLength(1)
    expect(s[0].points).toEqual([
      { t: 100, v: 5 },
      { t: 160, v: 6 },
    ]) // NaN point dropped
  })

  it('tolerates empty', () => {
    expect(parseRange({})).toEqual([])
    expect(parseRange({ data: { result: [] } })).toEqual([])
  })
})

describe('serviceNameOf', () => {
  it('strips the -health suffix, else returns the job verbatim', () => {
    expect(serviceNameOf('iam-health')).toBe('iam')
    expect(serviceNameOf('cloud-api-health')).toBe('cloud-api')
    expect(serviceNameOf('studio')).toBe('studio')
    expect(serviceNameOf('lux-validators')).toBe('lux-validators')
  })
})

describe('toServiceHealth', () => {
  it('maps up samples to the health board, down-first then alphabetical', () => {
    const samples: Sample[] = [
      { metric: { job: 'iam-health', instance: 'iam:80' }, value: 1, ts: 1 },
      { metric: { job: 'cloud-health', instance: 'cloud:80' }, value: 0, ts: 1 },
      { metric: { job: 'agents', instance: 'agents:8080' }, value: 0, ts: 1 },
      { metric: { job: 'lux-validators', instance: 'x:9101', brand: 'lux' }, value: 1, ts: 1 },
    ]
    const rows = toServiceHealth(samples)
    // down first: agents (0), cloud (0), then up: iam, lux-validators
    expect(rows.map((r) => r.service)).toEqual(['agents', 'cloud', 'iam', 'lux-validators'])
    expect(rows[0].up).toBe(false)
    expect(rows.find((r) => r.service === 'lux-validators')?.brand).toBe('lux')
  })

  it('falls back to instance when a series carries no job label', () => {
    const rows = toServiceHealth([{ metric: { instance: 'x:9000' }, value: 1, ts: 1 }])
    expect(rows[0].job).toBe('x:9000')
    expect(rows[0].up).toBe(true)
  })
})

describe('summarizeHealth', () => {
  it('counts total / healthy / down', () => {
    const rows = toServiceHealth([
      { metric: { job: 'a' }, value: 1, ts: 1 },
      { metric: { job: 'b' }, value: 0, ts: 1 },
      { metric: { job: 'c' }, value: 1, ts: 1 },
    ])
    expect(summarizeHealth(rows)).toEqual({ total: 3, healthy: 2, down: 1 })
  })

  it('is honest-zero on empty', () => {
    expect(summarizeHealth([])).toEqual({ total: 0, healthy: 0, down: 0 })
  })
})

describe('windowOf', () => {
  it('builds a range ending ~now with a >=15s step and the requested span', () => {
    const w = windowOf(3600, 60)
    expect(w.end - w.start).toBe(3600)
    expect(w.step).toBeGreaterThanOrEqual(15)
    expect(w.end).toBeGreaterThan(1_700_000_000)
  })

  it('clamps the step to a 15s floor for tiny windows', () => {
    expect(windowOf(60, 60).step).toBe(15)
  })
})
