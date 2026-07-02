/**
 * Silent console-session refresh — the ONE client entry point, single-flight.
 *
 * Both the proactive timer (SessionProvider) and the reactive 401 handler (the API
 * client) call `refreshSession()`. It POSTs `/auth/refresh` (server-side rotation —
 * the browser holds no token) and returns whether the session was renewed.
 *
 * SINGLE-FLIGHT is load-bearing, not an optimization: IAM refresh tokens are
 * one-time-use rotating, so two concurrent refreshes would race — the first rotates
 * the token, the second replays the now-invalid one and 400s, needlessly killing a
 * healthy session. Sharing ONE in-flight promise means every concurrent caller (the
 * timer + N parallel 401s) awaits the SAME single rotation.
 */

let inflight: Promise<boolean> | null = null

/**
 * Refresh the console session if one exists. Resolves true when the session was
 * renewed (HTTP 200), false otherwise (no session, or the refresh token is
 * expired/revoked → the caller falls through to graceful re-auth). Never throws.
 */
export function refreshSession(): Promise<boolean> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch('/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      return res.ok
    } catch {
      return false
    } finally {
      // Cleared AFTER this round settles, so a caller arriving mid-flight joins THIS
      // rotation and one arriving after it starts a fresh one.
      inflight = null
    }
  })()
  return inflight
}
