/**
 * withTimeout — race a promise against a deadline, resolving to `fallback` if it
 * doesn't settle in time instead of awaiting forever. The ONE reusable primitive
 * for "a UX path must degrade gracefully, never hang on a slow/dead backend".
 *
 * Client-safe (no next/server); the server BFF has its own AbortSignal-based
 * `lib/server/fetch-timeout` for outbound fetch — this is the client-side,
 * promise-level twin for boot/auth gates that can't hold the browser hostage to
 * one request. A rejection is treated exactly like a timeout: the fallback wins.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const done = (v: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => done(fallback), ms)
    promise.then(done, () => done(fallback))
  })
}
