import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  DEFAULT_ENVIRONMENT,
  STOCK_ENVIRONMENTS,
  getScope,
  setScope,
  loadPersistedScope,
  persistScope,
} from './scope'
import { projectEnvironments } from './api/projects'

/** A minimal in-memory localStorage, enough for the scope store. */
function fakeStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    get size() {
      return m.size
    },
  }
}

describe('resource scope store (project + environment, within the active org)', () => {
  let store: ReturnType<typeof fakeStorage>
  beforeEach(() => {
    store = fakeStorage()
    ;(globalThis as { window?: unknown }).window = { localStorage: store }
    // Reset the module singleton to its default between tests.
    setScope({ project: undefined, environment: DEFAULT_ENVIRONMENT })
  })
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('defaults to org-level mainnet (no project)', () => {
    expect(getScope()).toEqual({ project: undefined, environment: 'mainnet' })
    expect(DEFAULT_ENVIRONMENT).toBe('mainnet')
  })

  it('merges a project selection without touching the environment', () => {
    setScope({ environment: 'testnet' })
    setScope({ project: 'my-app' })
    expect(getScope()).toEqual({ project: 'my-app', environment: 'testnet' })
  })

  it('clears the project by setting it undefined (org-level scope)', () => {
    setScope({ project: 'my-app' })
    setScope({ project: undefined })
    expect(getScope().project).toBeUndefined()
  })

  it('persists only { project, environment } and restores it', () => {
    setScope({ project: 'my-app', environment: 'devnet' })
    persistScope(getScope())
    expect(store.size).toBe(1)
    expect(loadPersistedScope()).toEqual({ project: 'my-app', environment: 'devnet' })
  })

  it('reads null when nothing is persisted', () => {
    expect(loadPersistedScope()).toBeNull()
  })
})

describe('projectEnvironments (intrinsic 3 + custom)', () => {
  it('lists the stock three for a project with no custom envs', () => {
    expect(projectEnvironments({ name: 'p' })).toEqual(['mainnet', 'testnet', 'devnet'])
  })

  it('appends custom envs after the intrinsic three, in order', () => {
    expect(projectEnvironments({ name: 'p', environments: ['staging', 'qa'] })).toEqual([
      'mainnet',
      'testnet',
      'devnet',
      'staging',
      'qa',
    ])
  })

  it('never duplicates a stock env passed in the custom list', () => {
    const envs = projectEnvironments({ name: 'p', environments: ['mainnet', 'staging'] })
    expect(envs.filter((e) => e === 'mainnet')).toHaveLength(1)
    expect(envs).toEqual(['mainnet', 'testnet', 'devnet', 'staging'])
  })

  it('falls back to the stock three for an undefined project', () => {
    expect(projectEnvironments(undefined)).toEqual([...STOCK_ENVIRONMENTS])
  })
})
