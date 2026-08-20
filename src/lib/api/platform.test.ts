import { describe, expect, it } from 'vitest'

import { driftLabel, driftReasons, driftSeverity, type PlatformApp } from './platform'

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

describe('driftSeverity', () => {
  it('is empty when nothing drifts', () => {
    expect(driftSeverity(app())).toBe('')
    expect(driftSeverity(app({ severity: 'none' }))).toBe('')
  })

  // The row that must not read as ordinary: a red flag with no summary beside it.
  it('finds the worst severity on a FLAG when the summary field is absent', () => {
    expect(driftSeverity(app({ flags: [{ kind: 'un-rolled', severity: 'red', message: '' }] }))).toBe('red')
  })

  it('prefers the worst of the summary and the flags', () => {
    expect(
      driftSeverity(
        app({ severity: 'yellow', flags: [{ kind: 'no-release', severity: 'red', message: '' }] }),
      ),
    ).toBe('red')
  })
})

describe('malformed inventory rows', () => {
  // The inventory is trusted for shape but not type-checked; a non-string field used to
  // throw inside the cell's render and blank the whole board.
  it('does not throw on a non-string kind or severity', () => {
    const bad = app({ severity: 7 as never, flags: [{ kind: 3 as never, severity: {} as never, message: '' }] })
    expect(() => driftLabel(bad)).not.toThrow()
    expect(() => driftSeverity(bad)).not.toThrow()
    expect(driftLabel(bad)).toBe('')
  })

  it('does not throw when flags is not an array', () => {
    expect(() => driftLabel(app({ severity: 'red', flags: 'nope' as never }))).not.toThrow()
    expect(driftLabel(app({ severity: 'red', flags: 'nope' as never }))).toBe('red')
  })

  it('keeps the WORST severity for a kind reported twice', () => {
    const r = driftReasons(
      app({
        flags: [
          { kind: 'stale', severity: 'yellow', message: 'first' },
          { kind: 'stale', severity: 'red', message: 'worse' },
        ],
      }),
    )
    expect(r).toHaveLength(1)
    expect(r[0].severity).toBe('red')
  })
})
