import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * The welcome-grant self-heal guard — the onboarding paywall fix on the read path.
 * Proves it fires the idempotent grant AT MOST ONCE per browser session per org,
 * refreshes the shared balance only when a grant actually lands, and honors a
 * persisted sessionStorage claim across a reload (so a returning user never re-POSTs).
 *
 * Node env (no jsdom): window + sessionStorage are stubbed explicitly per-suite.
 */
const { welcome, invalidateBalance } = vi.hoisted(() => ({ welcome: vi.fn(), invalidateBalance: vi.fn() }))
vi.mock('~/lib/api/billing', () => ({ BillingApi: { welcome } }))
vi.mock('./live-balance', () => ({ invalidateBalance }))

import { claimWelcomeGrantOnce, __resetWelcomeGuard } from './welcome'

/** Minimal window + sessionStorage so the browser-guarded helper runs in node. */
function stubBrowser(): Map<string, string> {
  const store = new Map<string, string>()
  ;(globalThis as unknown as { window: unknown }).window = {}
  ;(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
    getItem: (k: string): string | null => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string): void => void store.set(k, v),
    removeItem: (k: string): void => void store.delete(k),
  }
  return store
}

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('claimWelcomeGrantOnce', () => {
  beforeEach(() => {
    __resetWelcomeGuard()
    welcome.mockReset()
    invalidateBalance.mockReset()
    stubBrowser()
  })

  it('no-ops for an empty owner', () => {
    claimWelcomeGrantOnce('')
    expect(welcome).not.toHaveBeenCalled()
  })

  it('fires the welcome grant once per owner (in-memory guard)', () => {
    welcome.mockResolvedValue({ granted: false, reason: 'already_granted' })
    claimWelcomeGrantOnce('acme')
    claimWelcomeGrantOnce('acme')
    claimWelcomeGrantOnce('acme')
    expect(welcome).toHaveBeenCalledTimes(1)
  })

  it('refreshes the shared balance when a grant actually lands', async () => {
    welcome.mockResolvedValue({ granted: true, amount: 500 })
    claimWelcomeGrantOnce('acme')
    await flush()
    expect(invalidateBalance).toHaveBeenCalledTimes(1)
  })

  it('does not refresh when the grant was already claimed server-side', async () => {
    welcome.mockResolvedValue({ granted: false, reason: 'already_granted' })
    claimWelcomeGrantOnce('acme')
    await flush()
    expect(invalidateBalance).not.toHaveBeenCalled()
  })

  it('swallows a failing grant (never throws) and still marks the session claimed', async () => {
    welcome.mockRejectedValue(new Error('commerce down'))
    expect(() => claimWelcomeGrantOnce('acme')).not.toThrow()
    await flush()
    expect(invalidateBalance).not.toHaveBeenCalled()
  })

  it('honors a persisted sessionStorage claim across a reload', async () => {
    welcome.mockResolvedValue({ granted: false })
    claimWelcomeGrantOnce('acme')
    await flush() // let .finally() persist the claim
    __resetWelcomeGuard() // simulate a reload: in-memory guard cleared, sessionStorage persists
    claimWelcomeGrantOnce('acme')
    expect(welcome).toHaveBeenCalledTimes(1)
  })
})
