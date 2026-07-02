/**
 * fetchWithTimeout — the ONE bounded-timeout wrapper for every request-time
 * server fetch.
 *
 * A Next route handler runs while a request is in flight; if it awaits an
 * upstream `fetch()` with no timeout and that upstream is reachable-but-silent
 * (accepts the socket, never responds), the handler HANGS until the client gives
 * up. That is the exact "no timeout → the render/route blocks" hazard: a slow or
 * unresolvable per-brand/backend host (cloud-api, IAM, visor, platform, commerce,
 * kms, a per-brand luxd RPC) would otherwise wedge the request forever.
 *
 * This wraps `fetch` with a bounded `AbortSignal`, COMPOSED with any caller signal
 * (`init.signal`, e.g. a proxy's `req.signal`), so the request aborts on EITHER a
 * client disconnect OR the timeout — whichever fires first. On timeout it rejects
 * exactly like an aborted `fetch`, so every existing call site's catch (→ `null`
 * fail-closed, or an honest 502) turns an infinite hang into a fast, honest
 * failure. No request-time server call can block indefinitely. DRY: one place
 * owns the bound; consumers just swap `fetch` → `fetchWithTimeout`.
 */

/** Default upstream timeout (ms). Env-overridable per-deploy; never unbounded. */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = Number(process.env.HANZO_UPSTREAM_TIMEOUT_MS ?? 10_000)

export type FetchTimeoutOpts = {
  /** Per-call timeout override (ms). Falls back to DEFAULT_UPSTREAM_TIMEOUT_MS. */
  timeoutMs?: number
  /** Injectable fetch (tests). Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

/**
 * `fetch` with a bounded timeout, composed with any `init.signal`.
 *
 * The returned promise rejects (AbortError) when the timeout elapses OR the
 * caller's signal aborts — matching `fetch(signal)` semantics so callers need no
 * new handling. The timer is always cleared (settle or reject), so nothing dangles.
 */
export async function fetchWithTimeout(
  input: string | URL | Request,
  init?: RequestInit,
  opts: FetchTimeoutOpts = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS
  const doFetch = opts.fetchImpl ?? fetch

  // Non-positive timeout ⇒ no bound (kept only as an explicit opt-out; the
  // default is always finite). Still composes any caller signal.
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return doFetch(input, init)
  }

  const controller = new AbortController()
  const parent = init?.signal ?? null

  // Compose: our controller aborts on the timeout; it ALSO aborts immediately if
  // the caller's signal is (or becomes) aborted, so a client disconnect still
  // cancels the upstream call.
  const onParentAbort = () => controller.abort((parent as AbortSignal | null)?.reason)
  if (parent) {
    if (parent.aborted) controller.abort(parent.reason)
    else parent.addEventListener('abort', onParentAbort, { once: true })
  }

  const timer = setTimeout(
    () => controller.abort(new DOMException(`Upstream timed out after ${timeoutMs}ms`, 'TimeoutError')),
    timeoutMs,
  )

  try {
    return await doFetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    if (parent) parent.removeEventListener('abort', onParentAbort)
  }
}
