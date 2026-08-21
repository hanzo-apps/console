import { describe, it, expect, vi } from 'vitest'
import {
  resilientFetch,
  isIdempotentMethod,
  isTransientStatus,
  RETRY_BACKOFF_MS,
  type ResilientDeps,
} from './client'

/** A fake fetch that returns a scripted sequence of statuses (or throws for a network error). */
function scriptedFetch(steps: (number | 'network')[]) {
  let i = 0
  const fn = vi.fn(async () => {
    const step = steps[Math.min(i, steps.length - 1)]
    i++
    if (step === 'network') throw new TypeError('fetch failed')
    return new Response('{}', { status: step })
  })
  return fn
}

/** Deps with an INSTANT sleep (no real backoff wait) so the retry logic is deterministic + fast. */
function deps(doFetch: ResilientDeps['doFetch'], over: Partial<ResilientDeps> = {}): ResilientDeps {
  return { doFetch, refresh: vi.fn(async () => false), sleep: vi.fn(async () => {}), canRefresh: true, ...over }
}

describe('resilientFetch — transient-retry so backend rolls are invisible', () => {
  it('calls doFetch as a BARE function (this=undefined) — a global-fetch-like doFetch does NOT throw "Illegal invocation"', async () => {
    // REGRESSION (v8.4.33 P0): the browser global `fetch` throws "Illegal invocation" when
    // its `this` isn't the global. If resilientFetch calls `deps.doFetch(url,init)` (a METHOD
    // call → this=deps), a raw global fetch as doFetch breaks EVERY request. Simulate it:
    const globalOnlyFetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    }
    // resilientFetch must invoke it bare (this=undefined) → no throw.
    const res = await resilientFetch('/v1/x', { method: 'GET' }, deps(globalOnlyFetch as unknown as ResilientDeps['doFetch']))
    expect(res.status).toBe(200)
  })

  it('a GET that hits a transient 503 then 200 SELF-HEALS (the Models-catalog case)', async () => {
    // Exactly Dave/maxpower: /v1/models lands mid-roll → 503 → retry → 200.
    const fetchFn = scriptedFetch([503, 200])
    const res = await resilientFetch('/v1/models', { method: 'GET' }, deps(fetchFn))
    expect(res.status).toBe(200)
    expect(fetchFn).toHaveBeenCalledTimes(2) // one retry, then success — user never sees an error
  })

  it('retries up to the backoff budget, then returns the last transient status (honest error card)', async () => {
    const fetchFn = scriptedFetch([503, 503, 503, 503, 503])
    const res = await resilientFetch('/v1/agents', { method: 'GET' }, deps(fetchFn))
    expect(res.status).toBe(503) // persistent outage → the caller shows "Could not load"
    expect(fetchFn).toHaveBeenCalledTimes(RETRY_BACKOFF_MS.length + 1) // initial + 3 retries
  })

  it('retries a NETWORK error (connection refused during a roll) then succeeds', async () => {
    const fetchFn = scriptedFetch(['network', 'network', 200])
    const res = await resilientFetch('/v1/o11y/summary', { method: 'GET' }, deps(fetchFn))
    expect(res.status).toBe(200)
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('does NOT retry a genuine 4xx (403/404) — honest state immediately, one fetch', async () => {
    for (const status of [403, 404, 402]) {
      const fetchFn = scriptedFetch([status])
      const res = await resilientFetch('/v1/prompts', { method: 'GET' }, deps(fetchFn))
      expect(res.status).toBe(status)
      expect(fetchFn).toHaveBeenCalledTimes(1)
    }
  })

  it('does NOT auto-retry a MUTATION (POST) on 503 — a 5xx write may have applied', async () => {
    const fetchFn = scriptedFetch([503, 200])
    const res = await resilientFetch('/v1/commerce/product', { method: 'POST' }, deps(fetchFn))
    expect(res.status).toBe(503) // returned as-is; the user retries the create manually
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry a MUTATION network error either (idempotent-only)', async () => {
    const fetchFn = scriptedFetch(['network'])
    await expect(resilientFetch('/v1/commerce/product', { method: 'DELETE' }, deps(fetchFn))).rejects.toThrow()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('honors a caller-aborted signal — never retries a request the caller cancelled', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const fetchFn = scriptedFetch(['network'])
    await expect(
      resilientFetch('/v1/agents', { method: 'GET', signal: ctrl.signal }, deps(fetchFn)),
    ).rejects.toThrow()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('401 → one silent refresh then retry with the rotated cookie (self-heals a session lapse)', async () => {
    const fetchFn = scriptedFetch([401, 200])
    const refresh = vi.fn(async () => true)
    const res = await resilientFetch('/v1/agents', { method: 'GET' }, deps(fetchFn, { refresh }))
    expect(res.status).toBe(200)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('401 refresh does NOT loop — a second 401 after a failed refresh surfaces honestly', async () => {
    const fetchFn = scriptedFetch([401, 401])
    const refresh = vi.fn(async () => false) // no console session
    const res = await resilientFetch('/v1/agents', { method: 'GET' }, deps(fetchFn, { refresh }))
    expect(res.status).toBe(401)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe('retry classification helpers', () => {
  it('isIdempotentMethod: only GET/HEAD auto-retry', () => {
    expect(isIdempotentMethod('GET')).toBe(true)
    expect(isIdempotentMethod('HEAD')).toBe(true)
    expect(isIdempotentMethod(undefined)).toBe(true) // default GET
    expect(isIdempotentMethod('get')).toBe(true) // case-insensitive
    expect(isIdempotentMethod('POST')).toBe(false)
    expect(isIdempotentMethod('PUT')).toBe(false)
    expect(isIdempotentMethod('DELETE')).toBe(false)
  })

  it('isTransientStatus: only 502/503/504 are the retryable class (not 4xx/500)', () => {
    expect(isTransientStatus(502)).toBe(true)
    expect(isTransientStatus(503)).toBe(true)
    expect(isTransientStatus(504)).toBe(true)
    expect(isTransientStatus(500)).toBe(false) // a real app error, not a roll — surface it
    expect(isTransientStatus(403)).toBe(false)
    expect(isTransientStatus(404)).toBe(false)
    expect(isTransientStatus(200)).toBe(false)
  })
})
