import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// refreshSession is browser-only and delegates to the IAM SDK; mock the SDK wrapper so
// the single-flight wiring is exercised in the node test env. resilientRefresh below is
// pure over injected deps, so it needs no mock (it never touches iam).
vi.mock('./iam', () => ({
  iamRefresh: vi.fn(),
  iamHasSession: vi.fn(() => true),
}))

import { resilientRefresh, refreshSession, REFRESH_RETRY_MS } from './refresh'
import { iamRefresh } from './iam'

const noSleep = (_ms: number) => Promise.resolve()

// The FIX itself — the exact `resilientFetch` injected-deps idiom the API client uses.
describe('resilientRefresh — a blip self-heals; a refused grant stops dead', () => {
  it('returns live on the first attempt, no retry, no sleep', async () => {
    const attempt = vi.fn().mockResolvedValue('live')
    const sleep = vi.fn(noSleep)
    expect(await resilientRefresh({ attempt, hasSession: () => true, sleep })).toBe('live')
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('recovers a TRANSIENT failure: transient then live (the whole point of the retry)', async () => {
    const attempt = vi.fn().mockResolvedValueOnce('transient').mockResolvedValue('live')
    const sleep = vi.fn(noSleep)
    expect(await resilientRefresh({ attempt, hasSession: () => true, sleep })).toBe('live')
    expect(attempt).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(REFRESH_RETRY_MS[0])
  })

  it('an unreachable IAM exhausts the bounded retries, then reports transient', async () => {
    const attempt = vi.fn().mockResolvedValue('transient')
    const sleep = vi.fn(noSleep)
    expect(await resilientRefresh({ attempt, hasSession: () => true, sleep })).toBe('transient')
    // one initial attempt + one per backoff slot
    expect(attempt).toHaveBeenCalledTimes(REFRESH_RETRY_MS.length + 1)
    expect(sleep).toHaveBeenCalledTimes(REFRESH_RETRY_MS.length)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual(REFRESH_RETRY_MS)
  })

  // THE DEFECT: a revoked refresh token was retried until the budget ran out, five
  // POSTs a page. IAM answered on the first one; nothing was listening.
  it('a REFUSED grant costs exactly one attempt and no backoff', async () => {
    const attempt = vi.fn().mockResolvedValue('refused')
    const sleep = vi.fn(noSleep)
    expect(await resilientRefresh({ attempt, hasSession: () => true, sleep })).toBe('refused')
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('a refusal ARRIVING mid-retry ends it there, without spending the rest of the budget', async () => {
    const attempt = vi.fn().mockResolvedValueOnce('transient').mockResolvedValue('refused')
    const sleep = vi.fn(noSleep)
    expect(await resilientRefresh({ attempt, hasSession: () => true, sleep })).toBe('refused')
    expect(attempt).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('never waits through the backoff when there is no session to refresh (anonymous)', async () => {
    const attempt = vi.fn().mockResolvedValue('transient')
    const sleep = vi.fn(noSleep)
    expect(await resilientRefresh({ attempt, hasSession: () => false, sleep })).toBe('transient')
    expect(attempt).toHaveBeenCalledTimes(1) // one try, then hasSession() false → stop
    expect(sleep).not.toHaveBeenCalled()
  })

  it('stops the moment the session disappears mid-retry (a refused attempt cleared it)', async () => {
    const attempt = vi.fn().mockResolvedValue('transient')
    const sleep = vi.fn(noSleep)
    const hasSession = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
    expect(await resilientRefresh({ attempt, hasSession, sleep })).toBe('transient')
    expect(attempt).toHaveBeenCalledTimes(2) // initial + one retry, then session gone
    expect(sleep).toHaveBeenCalledTimes(1)
  })
})

const mockAttempt = iamRefresh as ReturnType<typeof vi.fn>

// The wiring: browser-only + single-flight (concurrent callers share ONE rotation —
// load-bearing for a one-time-use rotating refresh token).
describe('refreshSession — browser-only, single-flight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('window', {} as unknown as Window & typeof globalThis)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is a no-op on the server (no window) — resolves false, never touches the SDK', async () => {
    vi.unstubAllGlobals() // remove the window stub → typeof window === 'undefined'
    expect(await refreshSession()).toBe(false)
    expect(mockAttempt).not.toHaveBeenCalled()
  })

  it('collapses concurrent callers onto ONE rotation (the timer + N parallel 401s)', async () => {
    mockAttempt.mockResolvedValue('live')
    const p1 = refreshSession()
    const p2 = refreshSession()
    expect(p1).toBe(p2) // same in-flight promise
    expect(await Promise.all([p1, p2])).toEqual([true, true])
    expect(mockAttempt).toHaveBeenCalledTimes(1) // one rotation, not two
    // Settled → a later caller starts a fresh rotation (inflight cleared).
    expect(await refreshSession()).toBe(true)
    expect(mockAttempt).toHaveBeenCalledTimes(2)
  })

  it('reports false — not a thrown grant — when IAM refuses, so callers surface the 401', async () => {
    mockAttempt.mockResolvedValue('refused')
    expect(await refreshSession()).toBe(false)
    expect(mockAttempt).toHaveBeenCalledTimes(1)
  })

  it('reports false when IAM is unreachable, after the bounded retries', async () => {
    mockAttempt.mockResolvedValue('transient')
    expect(await refreshSession()).toBe(false)
    expect(mockAttempt).toHaveBeenCalledTimes(REFRESH_RETRY_MS.length + 1)
  })
})
