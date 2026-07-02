import { describe, it, expect, vi, afterEach } from 'vitest'

import { normalizeOverview, AdminApi } from './admin-overview'

/**
 * The admin-overview client is coded to the documented `/v1/admin/overview` shape
 * and must be OPTIONAL-SAFE: whatever the backend returns (or omits) maps onto
 * `AdminOverview` with every missing field degrading to a real empty/`null` — an
 * org with no data or a host where the admin backend isn't routed renders honest
 * skeletons + em-dashes, never fabricated numbers. These pin the normalizer and
 * the two request shapes (full board + cheap activity poll).
 */

describe('normalizeOverview — optional-safe mapping', () => {
  it('maps a full documented payload', () => {
    const ov = normalizeOverview({
      range: '7d',
      kpis: [
        { key: 'tokens', value: 1234, prior: 1000, series: [1, 2, 3], unit: 'count' },
        { key: 'spendCents', value: 5000, unit: 'cents' },
      ],
      series: [{ key: 'tokens', interval: 'day', points: [{ t: '2026-06-30T00:00:00Z', value: 42 }] }],
      distribution: [{ label: 'Inference', value: 4000, hint: 'gpt' }],
      activity: [{ id: 'e1', time: '2026-06-30T12:00:00Z', kind: 'inference', title: 'Chat', subtitle: 'gpt', status: 'success', org: 'acme' }],
      alerts: [{ id: 'a1', severity: 'critical', title: 'DB down', detail: 'peer lost', time: 't' }],
      health: [{ service: 'gateway', health: 'green', cluster: 'nyc1', detail: 'ok' }],
    })
    expect(ov.range).toBe('7d')
    expect(ov.kpis[0]).toEqual({ key: 'tokens', value: 1234, prior: 1000, series: [1, 2, 3], unit: 'count' })
    expect(ov.kpis[1]).toEqual({ key: 'spendCents', value: 5000, unit: 'cents' })
    expect(ov.series[0].points[0]).toEqual({ t: '2026-06-30T00:00:00Z', value: 42 })
    expect(ov.distribution[0]).toEqual({ label: 'Inference', value: 4000, hint: 'gpt' })
    expect(ov.activity[0].org).toBe('acme')
    expect(ov.alerts[0].severity).toBe('critical')
    expect(ov.health[0].health).toBe('green')
  })

  it('degrades an empty/partial payload to honest empties, never throws', () => {
    const ov = normalizeOverview({})
    // No `distributions` key on an empty payload — the business tiles render honest empties.
    expect(ov).toEqual({ range: '24h', kpis: [], series: [], distribution: [], activity: [], alerts: [], health: [] })
    expect(normalizeOverview(null).kpis).toEqual([])
    expect(normalizeOverview(undefined).activity).toEqual([])
  })

  it('parses named business distributions (revenue / plans / topAgents by cost)', () => {
    const ov = normalizeOverview({
      distributions: {
        revenue: [{ label: 'Inference', value: 4000, hint: 'gpt' }],
        plans: [{ label: 'Pro', value: 12 }],
        topAgents: [{ label: 'hanzo-support-bot', value: 900 }],
        empty: [], // an empty list is dropped, never a phantom tile
      },
    })
    expect(ov.distributions?.revenue).toEqual([{ label: 'Inference', value: 4000, hint: 'gpt' }])
    expect(ov.distributions?.plans).toEqual([{ label: 'Pro', value: 12 }])
    expect(ov.distributions?.topAgents[0].label).toBe('hanzo-support-bot')
    expect(ov.distributions && 'empty' in ov.distributions).toBe(false)
  })

  it('omits distributions entirely when the map is absent or all-empty (honest)', () => {
    expect(normalizeOverview({ distributions: {} }).distributions).toBeUndefined()
    expect(normalizeOverview({ distributions: { plans: [] } }).distributions).toBeUndefined()
    expect(normalizeOverview({ distributions: 'garbage' }).distributions).toBeUndefined()
  })

  it('coerces junk fields to safe types (no NaN, no undefined leaks)', () => {
    const ov = normalizeOverview({
      kpis: [{ key: 'x', value: 'not-a-number', series: [1, 'bad', 3] }],
      series: [{ key: 'y', interval: 'weird', points: [{ t: 5, value: null }] }],
      activity: [{}],
      alerts: [{}],
    })
    expect(ov.kpis[0].value).toBe(0)
    expect(ov.kpis[0].series).toEqual([1, 0, 3]) // junk sample → 0, not dropped (fixed-length series)
    expect(ov.kpis[0].prior).toBeUndefined() // no prior basis
    expect(ov.series[0].interval).toBe('weird') // preserved as free-form string
    expect(ov.series[0].points[0]).toEqual({ t: '', value: 0 })
    expect(ov.activity[0].kind).toBe('event') // default kind
    expect(ov.alerts[0].severity).toBe('info') // default severity
  })
})

describe('AdminApi — request shapes + honest failure', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  const okEnvelope = (data: unknown) =>
    ({ ok: true, status: 200, json: async () => ({ status: 'ok', msg: '', data }) }) as unknown as Response

  it('overview() hits /v1/admin/overview with range + activityLimit and normalizes', async () => {
    let called = ''
    globalThis.fetch = vi.fn(async (url: unknown) => {
      called = String(url)
      return okEnvelope({ range: '7d', kpis: [{ key: 'orgs', value: 3 }] })
    }) as unknown as typeof fetch

    const ov = await AdminApi.overview({ range: '7d', activityLimit: 5 })
    expect(called).toContain('/v1/admin/overview')
    expect(called).toContain('range=7d')
    expect(called).toContain('activityLimit=5')
    expect(ov.kpis[0]).toEqual({ key: 'orgs', value: 3 })
  })

  it('overview({allOrgs}) forwards org=all (god view)', async () => {
    let called = ''
    globalThis.fetch = vi.fn(async (url: unknown) => {
      called = String(url)
      return okEnvelope({})
    }) as unknown as typeof fetch
    await AdminApi.overview({ allOrgs: true })
    expect(called).toContain('org=all')
  })

  it('activity() unwraps a bare list AND an {events}/{activity} envelope', async () => {
    globalThis.fetch = vi.fn(async () =>
      okEnvelope({ events: [{ id: 'e1', time: 't', kind: 'signin', title: 'Login', status: 'success' }] }),
    ) as unknown as typeof fetch
    const a = await AdminApi.activity({ limit: 3 })
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ id: 'e1', kind: 'signin', title: 'Login' })
  })

  it('propagates a 404 as a typed ApiError (admin backend not routed → honest state upstream)', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ status: 'error', msg: 'not found' }) }) as unknown as Response) as unknown as typeof fetch
    await expect(AdminApi.overview()).rejects.toMatchObject({ status: 404 })
  })
})
