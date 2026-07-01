import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * The shared live-balance store — the ONE source every money surface reads. These
 * prove the liveness contract that fixes "I don't see my balance change":
 * de-duplicated in-flight fetches, a freshness window that collapses mount/focus/
 * poll bursts into one call, honest phase mapping (noauth/unconfigured/error), and
 * `invalidateBalance()` forcing an immediate refetch past the freshness window.
 *
 * Runs in the repo's node env (no jsdom): the store guards all window/document use,
 * so focus/visibility/poll wiring is inert here and we test the fetch/phase core.
 */

// Real ApiError (the store does `instanceof ApiError`), mocked WalletApi.cloudBalance.
// `vi.hoisted` runs before the hoisted `vi.mock` factory, so both are in scope there.
const { ApiError, cloudBalance } = vi.hoisted(() => {
  class ApiError extends Error {
    readonly status: number
    constructor(message: string, status = 0) {
      super(message)
      this.name = 'ApiError'
      this.status = status
    }
  }
  return { ApiError, cloudBalance: vi.fn() }
})
vi.mock('~/lib/api/wallet', () => ({
  ApiError,
  WalletApi: { cloudBalance },
}))

import {
  getBalanceSnapshot,
  refreshBalance,
  invalidateBalance,
  subscribeBalance,
  spendableCents,
  __resetBalanceStore,
} from './live-balance'

const bal = (available: number, balance = available, holds = 0) => ({ available, balance, holds })
const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  __resetBalanceStore()
  cloudBalance.mockReset()
})

describe('spendableCents', () => {
  it('prefers available, falls back to balance, null when absent', () => {
    expect(spendableCents(bal(9974))).toBe(9974)
    expect(spendableCents({ available: undefined as unknown as number, balance: 500, holds: 0 })).toBe(500)
    expect(spendableCents(null)).toBeNull()
  })
})

describe('refreshBalance', () => {
  it('loads the real balance and publishes a ready snapshot', async () => {
    cloudBalance.mockResolvedValue(bal(9974))
    await refreshBalance()
    const s = getBalanceSnapshot()
    expect(s.phase).toBe('ready')
    expect(s.balance).toEqual(bal(9974))
    expect(spendableCents(s.balance)).toBe(9974)
    expect(cloudBalance).toHaveBeenCalledTimes(1)
  })

  it('de-duplicates concurrent calls into ONE fetch', async () => {
    let resolve!: (v: unknown) => void
    cloudBalance.mockReturnValue(new Promise((r) => (resolve = r)))
    const a = refreshBalance()
    const b = refreshBalance()
    const c = refreshBalance()
    resolve(bal(100))
    await Promise.all([a, b, c])
    expect(cloudBalance).toHaveBeenCalledTimes(1)
  })

  it('collapses a fresh re-read (freshness window) but a forced call always refetches', async () => {
    cloudBalance.mockResolvedValue(bal(100))
    await refreshBalance()
    await refreshBalance() // within FRESH_MS, non-forced ⇒ skipped
    expect(cloudBalance).toHaveBeenCalledTimes(1)
    await refreshBalance({ force: true }) // forced ⇒ refetch
    expect(cloudBalance).toHaveBeenCalledTimes(2)
  })

  it('maps 401/403 → noauth (balance cleared, no scary error)', async () => {
    cloudBalance.mockRejectedValue(new ApiError('Not authorized', 401))
    await refreshBalance()
    const s = getBalanceSnapshot()
    expect(s.phase).toBe('noauth')
    expect(s.balance).toBeNull()
    expect(s.error).toBeUndefined()
  })

  it('maps 404/501 → unconfigured (honest "not available")', async () => {
    cloudBalance.mockRejectedValue(new ApiError('nope', 501))
    await refreshBalance()
    expect(getBalanceSnapshot().phase).toBe('unconfigured')
  })

  it('maps other failures → error with the message', async () => {
    cloudBalance.mockRejectedValue(new ApiError('upstream down', 502))
    await refreshBalance()
    const s = getBalanceSnapshot()
    expect(s.phase).toBe('error')
    expect(s.error).toBe('upstream down')
  })

  it('keeps the last real number on screen across a refresh (no flicker to loading)', async () => {
    cloudBalance.mockResolvedValueOnce(bal(9974))
    await refreshBalance()
    cloudBalance.mockImplementationOnce(() => new Promise(() => {})) // never resolves
    void refreshBalance({ force: true })
    await tick()
    const s = getBalanceSnapshot()
    expect(s.phase).toBe('ready') // still ready, not 'loading'
    expect(spendableCents(s.balance)).toBe(9974)
  })
})

describe('invalidateBalance', () => {
  it('forces an immediate refetch (a completion / top-up moved the balance)', async () => {
    cloudBalance.mockResolvedValueOnce(bal(9974))
    await refreshBalance()
    cloudBalance.mockResolvedValueOnce(bal(9973)) // a completion debited 1¢
    invalidateBalance()
    await tick()
    expect(cloudBalance).toHaveBeenCalledTimes(2)
    expect(spendableCents(getBalanceSnapshot().balance)).toBe(9973)
  })

  it('notifies subscribers when the value changes', async () => {
    const seen: number[] = []
    const unsub = subscribeBalance(() => {
      const c = spendableCents(getBalanceSnapshot().balance)
      if (c != null) seen.push(c)
    })
    cloudBalance.mockResolvedValueOnce(bal(9974))
    await refreshBalance()
    cloudBalance.mockResolvedValueOnce(bal(10974)) // a $10 top-up landed
    invalidateBalance()
    await tick()
    unsub()
    expect(seen).toContain(9974)
    expect(seen).toContain(10974)
  })
})
