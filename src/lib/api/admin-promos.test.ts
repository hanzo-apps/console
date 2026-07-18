import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./client', () => ({
  originGet: vi.fn(),
  originPut: vi.fn(),
}))

import { originGet, originPut } from './client'
import { AdminPromosApi, clampPercent, normalizePromo } from './admin-promos'

const mGet = originGet as unknown as ReturnType<typeof vi.fn>
const mPut = originPut as unknown as ReturnType<typeof vi.fn>

describe('normalizePromo', () => {
  it('zeroes an empty/absent payload', () => {
    const zero = { percentOff: 0, start: '', end: '', plans: [], active: false }
    expect(normalizePromo(undefined)).toEqual(zero)
    expect(normalizePromo({})).toEqual(zero)
  })
  it('reads all fields, clamps percent, and cleans the plans list', () => {
    expect(normalizePromo({ percentOff: 150, start: 'S', end: 'E', plans: ['pro', '', ' team '], active: true })).toEqual({
      percentOff: 100,
      start: 'S',
      end: 'E',
      plans: ['pro', 'team'],
      active: true,
    })
  })
  it('coerces a stringy percent and truthy active', () => {
    expect(normalizePromo({ percentOff: '25' }).percentOff).toBe(25)
    expect(normalizePromo({ active: 'true' }).active).toBe(true)
    expect(normalizePromo({ active: 1 }).active).toBe(true)
  })
})

describe('clampPercent', () => {
  it('clamps to 0..100', () => {
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(50)).toBe(50)
    expect(clampPercent(200)).toBe(100)
  })
})

describe('AdminPromosApi', () => {
  beforeEach(() => {
    mGet.mockReset()
    mPut.mockReset()
  })

  it('get reads the /v1/admin/promos singleton and normalizes', async () => {
    mGet.mockResolvedValueOnce({ percentOff: 50, plans: ['pro'], active: true })
    const p = await AdminPromosApi.get()
    expect(mGet).toHaveBeenCalledWith('admin/promos')
    expect(p).toMatchObject({ percentOff: 50, plans: ['pro'], active: true })
  })

  it('put upserts a clamped, cleaned body and normalizes the response', async () => {
    mPut.mockResolvedValueOnce({ percentOff: 100, plans: ['pro'], active: true })
    const p = await AdminPromosApi.put({ percentOff: 150, start: '', end: '', plans: ['pro'], active: true })
    expect(mPut).toHaveBeenCalledWith('admin/promos', {
      percentOff: 100,
      start: '',
      end: '',
      plans: ['pro'],
      active: true,
    })
    expect(p.percentOff).toBe(100)
  })
})
