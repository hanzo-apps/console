import { describe, it, expect } from 'vitest'

import { toProjectRow, groupByOrg, type ProjectRow } from './admin-projects'
import type { PlatformApp } from './platform'

/**
 * The staff Projects board is a pure projection over the global apps inventory
 * (PlatformApi.apps → /v1/platform/apps) — no new backend. These pin the projection (health →
 * status, releaseUrl → live URL, drift severity) and the drill-by-org grouping, so a
 * missing field degrades to '' rather than throwing (honest, never fabricated).
 */
const app = (over: Partial<PlatformApp> = {}): PlatformApp => ({
  id: 'a1',
  org: 'acme',
  app: 'web',
  env: 'main',
  health: 'green',
  cluster: 'hanzo-k8s',
  ...over,
})

describe('toProjectRow', () => {
  it('projects a platform app to the staff row shape', () => {
    const r = toProjectRow(app({ releaseUrl: 'https://acme.hanzo.app', updatedAt: '2026-07-01T00:00:00Z', drift: { severity: 'warn' } }))
    expect(r).toEqual<ProjectRow>({
      org: 'acme',
      app: 'web',
      status: 'green',
      cluster: 'hanzo-k8s',
      url: 'https://acme.hanzo.app',
      namespace: '',
      env: 'main',
      drift: 'warn',
      updatedAt: '2026-07-01T00:00:00Z',
    })
  })

  it('degrades missing fields to empty (no live URL, no drift, falls back to lastObserved)', () => {
    const r = toProjectRow(app({ id: 'x', app: '', releaseUrl: null, lastObserved: '2026-06-30T00:00:00Z' }))
    expect(r.app).toBe('x') // falls back to id when app is blank
    expect(r.url).toBe('')
    expect(r.drift).toBe('')
    expect(r.updatedAt).toBe('2026-06-30T00:00:00Z')
  })
})

describe('groupByOrg', () => {
  it('groups rows by org, orgs sorted A→Z', () => {
    const rows = [app({ org: 'zeta' }), app({ org: 'acme', app: 'api' }), app({ org: 'acme', app: 'web' })].map(toProjectRow)
    const grouped = groupByOrg(rows)
    expect(grouped.map((g) => g.org)).toEqual(['acme', 'zeta'])
    expect(grouped[0].rows).toHaveLength(2)
    expect(grouped[1].rows).toHaveLength(1)
  })

  it('buckets an org-less row under "—"', () => {
    const grouped = groupByOrg([toProjectRow(app({ org: '' }))])
    expect(grouped[0].org).toBe('—')
  })
})
