import { describe, it, expect, afterEach } from 'vitest'

import { currentActor, setCurrentActor } from './actor-scope'

/** A Map-backed localStorage so set/get round-trips (real browser semantics). */
function stubWindow(): void {
  const store = new Map<string, string>()
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, val: string) => void store.set(k, val),
      removeItem: (k: string) => void store.delete(k),
    },
  }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('actor-scope', () => {
  it('defaults to empty (no actor before sign-in)', () => {
    stubWindow()
    expect(currentActor()).toBe('')
  })

  it('round-trips a principal id and clears on empty', () => {
    stubWindow()
    setCurrentActor('hanzo/z')
    expect(currentActor()).toBe('hanzo/z')
    setCurrentActor('')
    expect(currentActor()).toBe('')
  })

  it('is empty on the server (no window)', () => {
    expect(currentActor()).toBe('')
  })
})
