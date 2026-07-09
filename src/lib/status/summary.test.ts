import { describe, expect, it } from 'vitest'

import { summarizeStatuses } from './summary'

/** A Gatus endpoint row with `n` results, the last one carrying `lastSuccess`. */
function ep(name: string, group: string, lastSuccess: boolean | null) {
  const results =
    lastSuccess === null
      ? []
      : [
          { success: true }, // an older result
          { success: lastSuccess }, // the CURRENT one (last wins)
        ]
  return { key: `${group}_${name}`.toLowerCase(), name, group, results }
}

describe('summarizeStatuses', () => {
  it('all up → operational', () => {
    const s = summarizeStatuses([ep('api', 'Core API', true), ep('IAM', 'Identity', true)])
    expect(s.overall).toBe('operational')
    expect(s.total).toBe(2)
    expect(s.up).toBe(2)
    expect(s.down).toEqual([])
  })

  it('some down → degraded, lists the down components', () => {
    const s = summarizeStatuses([ep('api', 'Core API', true), ep('Base', 'Data', false)])
    expect(s.overall).toBe('degraded')
    expect(s.total).toBe(2)
    expect(s.up).toBe(1)
    expect(s.down).toEqual([{ name: 'Base', group: 'Data' }])
  })

  it('every endpoint down → down', () => {
    const s = summarizeStatuses([ep('api', 'Core API', false), ep('IAM', 'Identity', false)])
    expect(s.overall).toBe('down')
    expect(s.up).toBe(0)
    expect(s.down).toHaveLength(2)
  })

  it('current state is the LAST result, not the first', () => {
    // recovered: older result failed, latest succeeded → up
    const recovered = { name: 'x', group: 'g', results: [{ success: false }, { success: true }] }
    expect(summarizeStatuses([recovered]).overall).toBe('operational')
  })

  it('endpoints with no results yet are excluded from totals', () => {
    const s = summarizeStatuses([ep('api', 'Core API', true), ep('pending', 'Data', null)])
    expect(s.total).toBe(1)
    expect(s.up).toBe(1)
    expect(s.overall).toBe('operational')
  })

  it('empty array → unknown', () => {
    expect(summarizeStatuses([])).toEqual({ overall: 'unknown', total: 0, up: 0, down: [] })
  })

  it('garbage / non-array input → unknown, never throws', () => {
    for (const bad of [null, undefined, 42, 'nope', {}, { endpoints: [] }, [null, 1, 'x', {}]]) {
      const s = summarizeStatuses(bad as unknown)
      expect(s.overall).toBe('unknown')
      expect(s.total).toBe(0)
    }
  })
})
