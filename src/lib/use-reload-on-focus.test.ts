import { describe, expect, it } from 'vitest'

import { armReloadOnFocus, type FocusReloadTarget } from './use-reload-on-focus'

function fakeTarget(visible = true) {
  const handlers: Record<string, Array<() => void>> = {}
  const target: FocusReloadTarget = {
    add: (t, cb) => (handlers[t] = [...(handlers[t] ?? []), cb]),
    remove: (t, cb) => (handlers[t] = (handlers[t] ?? []).filter((h) => h !== cb)),
    isVisible: () => visible,
  }
  return {
    target,
    fire: (t: string) => (handlers[t] ?? []).forEach((h) => h()),
    count: (t: string) => (handlers[t] ?? []).length,
  }
}

describe('armReloadOnFocus', () => {
  it('reloads on window focus', () => {
    const f = fakeTarget()
    let n = 0
    armReloadOnFocus(f.target, () => n++)
    f.fire('focus')
    f.fire('focus')
    expect(n).toBe(2)
  })

  it('reloads on visibilitychange only when the tab is visible', () => {
    const visible = fakeTarget(true)
    let a = 0
    armReloadOnFocus(visible.target, () => a++)
    visible.fire('visibilitychange')
    expect(a).toBe(1)

    const hidden = fakeTarget(false)
    let b = 0
    armReloadOnFocus(hidden.target, () => b++)
    hidden.fire('visibilitychange')
    expect(b).toBe(0)
  })

  it('cleanup unbinds both listeners — no leaks, no reload after teardown', () => {
    const f = fakeTarget()
    let n = 0
    const cleanup = armReloadOnFocus(f.target, () => n++)
    expect(f.count('focus')).toBe(1)
    expect(f.count('visibilitychange')).toBe(1)
    cleanup()
    expect(f.count('focus')).toBe(0)
    expect(f.count('visibilitychange')).toBe(0)
    f.fire('focus')
    expect(n).toBe(0)
  })
})
