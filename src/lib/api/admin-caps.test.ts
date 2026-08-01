import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./client', () => ({
  originGet: vi.fn(),
  originPost: vi.fn(),
  originPatch: vi.fn(),
  originDelete: vi.fn(),
}))

import { originGet, originPost, originPatch, originDelete } from './client'
import { AdminCapsApi, normalizeAdminCap } from './admin-caps'

const mGet = originGet as unknown as ReturnType<typeof vi.fn>
const mPost = originPost as unknown as ReturnType<typeof vi.fn>
const mPatch = originPatch as unknown as ReturnType<typeof vi.fn>
const mDelete = originDelete as unknown as ReturnType<typeof vi.fn>

describe('normalizeAdminCap', () => {
  it('maps threshold→cents + the admin oversight fields, snake_case tolerant', () => {
    const c = normalizeAdminCap({
      id: 'a1',
      user_id: 'maxpower/dave',
      title: 'Cap',
      threshold: 50000,
      currency: 'USD',
      project: 'prod',
      service: 'inference',
      enforce: true,
      soft_pct: 90,
      rate_limit_rpm: 600,
      period_spent_cents: 12000,
      over: false,
      warn: true,
      period: '2026-07',
      resets_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-07-15T00:00:00Z',
    })
    expect(c).toMatchObject({
      id: 'a1',
      userId: 'maxpower/dave',
      thresholdCents: 50000,
      currency: 'usd',
      project: 'prod',
      service: 'inference',
      enforce: true,
      softPct: 90,
      rateLimitRpm: 600,
      periodSpentCents: 12000,
      over: false,
      warn: true,
      period: '2026-07',
      resetsAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-07-15T00:00:00Z',
    })
  })

  it('defaults a sparse row (softPct 80, alert-only, unlimited, zeroed spend)', () => {
    expect(normalizeAdminCap({})).toMatchObject({
      id: '',
      userId: '',
      title: '—',
      thresholdCents: 0,
      softPct: 80,
      enforce: false,
      rateLimitRpm: 0,
      periodSpentCents: 0,
      over: false,
      warn: false,
      period: '',
      resetsAt: '',
    })
  })

  it('reads camelCase thresholdCents as an alternative to threshold', () => {
    expect(normalizeAdminCap({ thresholdCents: 999 }).thresholdCents).toBe(999)
  })
})

describe('AdminCapsApi', () => {
  beforeEach(() => {
    mGet.mockReset()
    mPost.mockReset()
    mPatch.mockReset()
    mDelete.mockReset()
  })

  it('list GETs the org-scoped surface and normalizes the array', async () => {
    mGet.mockResolvedValueOnce([
      { id: 'a1', threshold: 100 },
      { id: 'a2', threshold: 200 },
    ])
    const rows = await AdminCapsApi.list('acme')
    expect(mGet).toHaveBeenCalledWith('admin/caps', { org: 'acme' })
    expect(rows.map((r) => r.id)).toEqual(['a1', 'a2'])
    expect(rows[0].thresholdCents).toBe(100)
  })

  it('list tolerates a non-array payload → honest empty', async () => {
    mGet.mockResolvedValueOnce(null)
    expect(await AdminCapsApi.list('acme')).toEqual([])
  })

  it('create POSTs the wire body (threshold cents), org-scoped, omitting absent currency', async () => {
    mPost.mockResolvedValueOnce({ id: 'new', threshold: 50000 })
    await AdminCapsApi.create('acme', {
      title: 'Cap',
      thresholdCents: 50000,
      project: '',
      service: '',
      enforce: true,
      softPct: 80,
      rateLimitRpm: 0,
    })
    expect(mPost).toHaveBeenCalledWith(
      'admin/caps',
      { title: 'Cap', threshold: 50000, project: '', service: '', enforce: true, softPct: 80, rateLimitRpm: 0 },
      { org: 'acme' },
    )
  })

  it('update PATCHes only the provided fields (partial), org-scoped', async () => {
    mPatch.mockResolvedValueOnce({ id: 'a1', threshold: 100 })
    await AdminCapsApi.update('acme', 'a1', { thresholdCents: 100 })
    expect(mPatch).toHaveBeenCalledWith('admin/caps/a1', { threshold: 100 }, { org: 'acme' })
  })

  it('remove DELETEs the :id sub-path, org-scoped, and url-encodes the id', async () => {
    mDelete.mockResolvedValueOnce(undefined)
    await AdminCapsApi.remove('acme', 'a/b')
    expect(mDelete).toHaveBeenCalledWith('admin/caps/a%2Fb', { org: 'acme' })
  })
})
