import { describe, expect, it } from 'vitest'

import { driftLabel, driftReasons, type PlatformApp } from './platform'

const app = (drift?: PlatformApp['drift']): PlatformApp => ({
  id: 'a',
  org: 'hanzo',
  app: 'cloud',
  env: 'main',
  health: 'green',
  cluster: 'hanzo-k8s',
  drift,
})

describe('driftReasons', () => {
  it('is empty when the app carries no drift', () => {
    expect(driftReasons(app())).toEqual([])
    expect(driftReasons(app({ severity: 'none' }))).toEqual([])
  })

  it('orders flags worst-first and drops duplicate kinds', () => {
    const r = driftReasons(
      app({
        severity: 'red',
        flags: [
          { kind: 'stale', severity: 'yellow', message: 'declared is behind latest' },
          { kind: 'un-rolled', severity: 'red', message: 'running is behind declared' },
          { kind: 'stale', severity: 'yellow', message: 'duplicate' },
        ],
      }),
    )
    expect(r.map((f) => f.kind)).toEqual(['un-rolled', 'stale'])
  })

  it('ignores a flag with no kind — a nameless reason is no reason', () => {
    expect(driftReasons(app({ severity: 'red', flags: [{ kind: '', severity: 'red', message: 'x' }] }))).toEqual([])
  })
})

describe('driftLabel', () => {
  it('is empty for a healthy app, so the row renders its usual em dash', () => {
    expect(driftLabel(app())).toBe('')
    expect(driftLabel(app({ severity: 'None' }))).toBe('')
  })

  it('names the kinds, worst first', () => {
    expect(
      driftLabel(
        app({
          severity: 'red',
          flags: [
            { kind: 'floating-declared', severity: 'yellow', message: '' },
            { kind: 'no-release', severity: 'red', message: '' },
          ],
        }),
      ),
    ).toBe('no-release, floating-declared')
  })

  it('falls back to the severity when the inventory reports one with no flags', () => {
    expect(driftLabel(app({ severity: 'yellow' }))).toBe('yellow')
  })
})
