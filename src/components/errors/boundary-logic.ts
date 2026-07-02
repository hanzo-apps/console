/**
 * Pure decisions for the product-route error boundary.
 *
 * A `'use client'` product module mounts CLIENT-ONLY under the catch-all route
 * (the authed dashboard renders a loader during SSR, so the module never renders
 * server-side — verified: the /playground server HTML carries no module markup).
 * That means a throw during a module's first client render has no error boundary
 * to catch it, so it bubbles to Next's built-in root fallback and white-screens
 * the whole console with "Application error: a client-side exception has
 * occurred" — losing the shell, nav, and the URL. `ProductErrorBoundary` is the
 * one boundary that closes that class for every product route; this module is its
 * decision logic, kept pure so it is unit-tested without a browser.
 *
 * Three orthogonal decisions:
 *  - `isChunkLoadError`  — a dynamic-import/chunk fetch failed. On a rolling
 *    deploy the just-served HTML references new content-hashed chunks; a refresh
 *    that lands on the other replica (or a stale CDN edge) can 404 a chunk. This
 *    is the most likely real cause of a "direct-load / refresh only" crash.
 *  - `isNextControlFlowError` — `notFound()` / `redirect()` (and the CSR bailout)
 *    throw a tagged error as CONTROL FLOW. A custom boundary MUST re-throw these
 *    so Next renders the 404/redirect instead of swallowing them into a fallback.
 *  - `shouldReloadForChunk` — recover from chunk skew by reloading ONCE per short
 *    window, never looping when a chunk is genuinely gone.
 */

/**
 * True for a webpack/Next dynamic chunk (JS or CSS) load failure — including the
 * stale-deploy case where a 404'd chunk URL falls through to the SPA and the
 * browser parses HTML as JS ("Unexpected token '<'" / module-script failed). In a
 * PRODUCTION build user code never throws "Unexpected token '<'" at runtime (that
 * is a build-time syntax error), so at runtime it is a chunk skew — recover, don't
 * crash. Kept in sync with `ChunkGuard`'s window-level pattern (one definition of
 * "this is a chunk skew" for both the boundary and the global listeners).
 */
export function isChunkLoadError(e: unknown): boolean {
  if (!e) return false
  const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name?: unknown }).name) : ''
  const msg = e instanceof Error ? e.message : String(e)
  return (
    name === 'ChunkLoadError' ||
    /ChunkLoadError/i.test(msg) ||
    /Loading (?:CSS )?chunk [\w./-]+ failed/i.test(msg) ||
    /(?:Failed to fetch|error loading|Importing a module script failed).*dynamically imported module/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    // Stale chunk URL served the HTML shell → parsed as JS.
    /Unexpected token '<'|expected expression, got '<'|Unexpected token <|<!DOCTYPE/i.test(msg)
  )
}

/**
 * True for Next.js control-flow throws (`notFound()`, `redirect()`, the
 * `useSearchParams` CSR bailout). These are tagged with a `digest` and MUST be
 * re-thrown by a custom error boundary so Next handles them, never rendered as a
 * crash.
 */
export function isNextControlFlowError(e: unknown): boolean {
  const digest = typeof e === 'object' && e !== null && 'digest' in e ? (e as { digest?: unknown }).digest : undefined
  if (typeof digest !== 'string') return false
  return digest.startsWith('NEXT_') || digest === 'BAILOUT_TO_CLIENT_SIDE_RENDERING'
}

/**
 * Reload at most once per `windowMs` to recover from a chunk skew. `lastReloadAt`
 * is the epoch-ms of the last recovery reload (null when we have not reloaded);
 * returns true when a fresh reload is safe (no reload in the window → no loop).
 */
export function shouldReloadForChunk(now: number, lastReloadAt: number | null, windowMs = 15_000): boolean {
  if (lastReloadAt == null || !Number.isFinite(lastReloadAt)) return true
  return now - lastReloadAt >= windowMs
}
