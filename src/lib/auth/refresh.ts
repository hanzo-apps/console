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
 *
 * RESILIENT, not jumpy — and it tells the two failures apart. One attempt used to be
 * the whole story: a single transient failure (a network blip, a 5xx from IAM, a lost
 * rotation race) yielded a bare `false`, and the caller took that one "no" as a
 * definitive sign-out — the "session expired, sign in again" card fired mid-task on a
 * hiccup. The cure was to RETRY a bounded few times, on the premise that a blip and a
 * dead refresh token look alike here.
 *
 * They do not. OAuth 2 already separates them: a 4xx is IAM's verdict on the GRANT,
 * a 5xx or a network error is not. `iamRefresh` reports which (`Grant`), so a blip
 * still self-heals across the backoff while a REFUSED grant stops on the first answer
 * — one token POST, no backoff, session cleared. What made the revoked session retry
 * five times a page and still render the signed-in shell was the missing distinction,
 * not the retry.
 */
import { iamRefresh, iamHasSession, type Grant } from './iam'

/** Backoff before each retry AFTER the first attempt — transient recovery only, so it
 *  is spent on blips alone. A refused grant never reaches it. Worst case ~1.6s. */
export const REFRESH_RETRY_MS = [400, 1200]

/** Injected dependencies for `resilientRefresh` — real ones in `refreshSession`, fakes
 *  in tests. Mirrors the `ResilientDeps` idiom the API client uses for `resilientFetch`. */
export interface RefreshDeps {
  /** One refresh attempt, classified — exactly one token POST. Never throws. */
  attempt: () => Promise<Grant>
  /** True while the browser still holds a session to refresh (else retrying is futile). */
  hasSession: () => boolean
  sleep: (ms: number) => Promise<void>
}

/**
 * Pure refresh orchestration (over its injected deps). Retry ONLY what is worth
 * retrying: a `transient` answer waits and tries again while a session remains, so a
 * network blip / lost rotation race self-heals. `live` and `refused` are both final —
 * IAM has already answered, so a refused grant costs ONE POST and no backoff.
 * Bounded by `REFRESH_RETRY_MS`.
 */
export async function resilientRefresh(deps: RefreshDeps): Promise<Grant> {
  for (let i = 0; ; i++) {
    const grant = await deps.attempt()
    if (grant !== 'transient') return grant
    // Transient. Stop if we've exhausted the budget OR the session is gone from storage
    // (an anonymous visitor, or a credential a refused attempt cleared). Else wait and retry.
    if (i >= REFRESH_RETRY_MS.length || !deps.hasSession()) return 'transient'
    await deps.sleep(REFRESH_RETRY_MS[i])
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let inflight: Promise<boolean> | null = null

/**
 * Refresh the IAM access token if a valid refresh token exists. Resolves true when a
 * live token is available afterwards, false otherwise. False now carries a consequence:
 * a REFUSED grant has already cleared the credential, so the next session read resolves
 * anonymous and the entry gate starts the IAM hop. Never throws.
 */
export function refreshSession(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (inflight) return inflight
  inflight = resilientRefresh({
    // One classified rotation. `iamRefresh` clears the tokens itself when IAM refuses
    // the grant, so the entry gate resolves anonymous and starts the IAM hop — this
    // layer reports the outcome and never redirects, keeping ONE way in.
    attempt: iamRefresh,
    hasSession: iamHasSession,
    sleep,
  }).then((grant) => grant === 'live')
  // Cleared AFTER this round settles, so a caller arriving mid-flight joins THIS
  // rotation and one arriving after it starts a fresh one.
  void inflight.finally(() => {
    inflight = null
  })
  return inflight
}
