import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchWithTimeout } from './fetch-timeout'

/**
 * A fake fetch that resolves only when `settleAfterMs` elapses, and rejects with
 * an AbortError if its signal aborts first — the real `fetch(signal)` contract.
 * Uses fake timers, so we advance time deterministically.
 */
function fakeFetch(settleAfterMs: number, response = new Response('ok', { status: 200 })): typeof fetch {
  return ((_input: unknown, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal
      const t = setTimeout(() => resolve(response), settleAfterMs)
      if (signal) {
        if (signal.aborted) {
          clearTimeout(t)
          reject(signal.reason ?? new DOMException('aborted', 'AbortError'))
          return
        }
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(t)
            reject(signal.reason ?? new DOMException('aborted', 'AbortError'))
          },
          { once: true },
        )
      }
    })) as unknown as typeof fetch
}

afterEach(() => {
  vi.useRealTimers()
})

describe('fetchWithTimeout', () => {
  it('resolves when the upstream responds before the timeout', async () => {
    vi.useFakeTimers()
    const p = fetchWithTimeout('https://x/y', {}, { timeoutMs: 1000, fetchImpl: fakeFetch(200) })
    await vi.advanceTimersByTimeAsync(200)
    const res = await p
    expect(res.status).toBe(200)
  })

  it('aborts (rejects) when the upstream exceeds the timeout — no infinite hang', async () => {
    vi.useFakeTimers()
    const p = fetchWithTimeout('https://x/y', {}, { timeoutMs: 500, fetchImpl: fakeFetch(10_000) })
    const assertion = expect(p).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(500)
    await assertion
  })

  it('aborts when the caller signal aborts first (client disconnect)', async () => {
    vi.useFakeTimers()
    const ctrl = new AbortController()
    const p = fetchWithTimeout('https://x/y', { signal: ctrl.signal }, { timeoutMs: 10_000, fetchImpl: fakeFetch(10_000) })
    const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' })
    ctrl.abort(new DOMException('client gone', 'AbortError'))
    await vi.advanceTimersByTimeAsync(0)
    await assertion
  })

  it('rejects immediately when the caller signal is already aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort(new DOMException('already gone', 'AbortError'))
    await expect(
      fetchWithTimeout('https://x/y', { signal: ctrl.signal }, { timeoutMs: 10_000, fetchImpl: fakeFetch(50) }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('clears the timer once the upstream resolves (no dangling abort after settle)', async () => {
    vi.useFakeTimers()
    const p = fetchWithTimeout('https://x/y', {}, { timeoutMs: 500, fetchImpl: fakeFetch(100) })
    await vi.advanceTimersByTimeAsync(100)
    await p
    // Advancing past the original timeout must not throw / re-abort anything.
    await vi.advanceTimersByTimeAsync(1000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('treats a non-positive timeout as an explicit no-bound opt-out', async () => {
    vi.useFakeTimers()
    const p = fetchWithTimeout('https://x/y', {}, { timeoutMs: 0, fetchImpl: fakeFetch(50) })
    await vi.advanceTimersByTimeAsync(50)
    expect((await p).status).toBe(200)
  })
})
