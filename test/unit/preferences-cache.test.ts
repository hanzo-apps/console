import { describe, it, expect, beforeEach } from 'vitest'

import { PREFS_CACHE_PREFIX, prefsCacheKey, clearPreferencesCache } from '~/lib/products/preferences-cache'

/** Map-backed localStorage double (Node 26's jsdom doesn't wire a usable one). */
function installLocalStorage(): Storage {
  const store = new Map<string, string>()
  const mock: Storage = {
    get length() {
      return store.size
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v))
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => store.clear(),
  }
  Object.defineProperty(window, 'localStorage', { value: mock, configurable: true })
  return mock
}

describe('preferences cache', () => {
  let ls: Storage
  beforeEach(() => {
    ls = installLocalStorage()
  })

  it('prefsCacheKey is per-user with an anon fallback', () => {
    expect(prefsCacheKey('ada')).toBe(`${PREFS_CACHE_PREFIX}ada`)
    expect(prefsCacheKey(undefined)).toBe(`${PREFS_CACHE_PREFIX}anon`)
  })

  it('clearPreferencesCache removes ONLY prefs.* keys (leaves the rest)', () => {
    ls.setItem(prefsCacheKey('ada'), '{"favorites":["chat"]}')
    ls.setItem(prefsCacheKey(undefined), '{}')
    ls.setItem('unrelated.key', 'keep-me')

    clearPreferencesCache()

    expect(ls.getItem(prefsCacheKey('ada'))).toBeNull()
    expect(ls.getItem(prefsCacheKey(undefined))).toBeNull()
    expect(ls.getItem('unrelated.key')).toBe('keep-me')
  })

  it('is a no-op when there is nothing cached', () => {
    expect(() => clearPreferencesCache()).not.toThrow()
  })
})
