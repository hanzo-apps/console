/**
 * Silent session refresh — the ONE client entry point, single-flight.
 *
 * Both the proactive timer (SessionProvider) and the reactive 401 handler (the API
 * client) call `refreshSession()`. It delegates to the `@hanzo/iam` SDK's refresh
 * grant (RFC 6749 `refresh_token`) — IAM owns the credential, the console holds only
 * the SDK's token store. There is NO `/auth/refresh` BFF POST any more.
 *
 * SINGLE-FLIGHT is load-bearing, not an optimization: IAM refresh tokens are
 * one-time-use rotating, so two concurrent refreshes would race — the first rotates
 * the token, the second replays the now-invalid one and 400s, needlessly killing a
 * healthy session. Sharing ONE in-flight promise means every concurrent caller (the
 * timer + N parallel 401s) awaits the SAME single rotation.
 */
import { iamValidAccessToken } from './iam'

let inflight: Promise<boolean> | null = null

/**
 * Refresh the IAM access token if a valid refresh token exists. Resolves true when a
 * live token is available afterwards, false otherwise (signed out, or the refresh
 * token is expired/revoked → the caller falls through to graceful re-auth). Never throws.
 */
export function refreshSession(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (inflight) return inflight
  inflight = (async () => {
    try {
      // getValidAccessToken() returns the current token, or transparently runs the
      // refresh grant when it is expired — the SDK's own single rotation.
      const token = await iamValidAccessToken()
      return !!token
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
