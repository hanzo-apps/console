/**
 * The console entry gate as a VALUE.
 *
 * Signing into the console is not one decision — it is five, in order: is the session
 * resolved and authenticated, does the account have product access, is it scoped to an
 * org, has first-run onboarding finished, and only then: the app. Historically each was
 * a component that wrapped the next and short-circuited — six braided places. Here the
 * whole ladder is ONE pure function over a plain `Session` value, returning ONE `Stage`.
 * `entry.tsx` gathers the session with hooks, calls `resolve`, and renders exactly one
 * surface. No JSX here — this file is unit-tested in isolation (see `resolve.test.ts`).
 *
 * FAIL-CLOSED is the one security property, and it lives here: `resolve` returns `ready`
 * (the real app + its data) ONLY for a session that is loaded, authenticated, has an org,
 * and has ENTERED that org. Anything unresolved, loading, anonymous, org-less, or on an
 * auth surface resolves to an earlier stage — the dashboard can never render for it.
 */

/** The one surface the console shows, computed from the session. A closed set. */
export type Stage = 'signin' | 'waitlist' | 'org' | 'onboard' | 'ready'

/**
 * Which entry surface the URL is, resolved AFTER mount (the served SPA shell is the `/`
 * route for every path, so the real path is only knowable client-side). `null` until then.
 *   - `callback` — `/auth/callback`: complete the PKCE exchange (before any guard bounce).
 *   - `signin`   — `/signin`: the sign-in experience owns the screen. The ONE surface that
 *     never auto-authorizes: sign-out lands here, and IAM may still hold its own session,
 *     so an automatic authorize would silently sign the user back in.
 *   - `guarded`  — everything else, `/` included: the app, gated. An anon visitor STARTS
 *     the IAM hop here rather than being parked on an interstitial.
 */
export type Surface = 'callback' | 'signin' | 'guarded' | null

/** Everything the stage decision reads. Plain values — no hooks, no JSX, no React. */
export interface Session {
  /** The IAM session is still resolving ("who am I"). */
  loading: boolean
  /** A signed-in account is present. */
  authed: boolean
  /** The entry surface the URL maps to (`null` until resolved on mount). */
  surface: Surface
  /** The account's org (the `owner` claim); `''` when the session carries none. */
  owner: string
  /** On an `admin.<brand>` host (the operator cockpit). */
  adminHost: boolean
  /** A member of the reserved `admin` org — platform SuperAdmin. */
  superAdmin: boolean
  /** The product-access (waitlist) check is still in flight. */
  waitlistLoading: boolean
  /** Product access granted. Fail-OPEN: `true` on any waitlist error — a blip never traps. */
  access: boolean
  /** An org has been explicitly ENTERED (picker → console). `null` until hydrated. */
  orgEntered: boolean | null
  /** First-run onboarding applies on this surface (not the static embed, not an admin host). */
  onboardable: boolean
  /** Onboarding inputs have resolved (client mounted + account preferences read). */
  onboardReady: boolean
  /** First-run onboarding is already finished or dismissed. */
  onboarded: boolean
}

/**
 * The whole entry ladder, in order. Each guard is fail-closed: the app (`ready`) is the
 * LAST resort, reached only after every earlier gate is satisfied.
 */
export function resolve(s: Session): Stage {
  // 1 · Auth. While the session resolves, before the surface is known, or ON the auth
  // surfaces (callback/signin) themselves, the sign-in experience owns the screen —
  // regardless of any account. The dashboard never renders for a loading/anon session.
  if (s.loading) return 'signin'
  if (s.surface === null || s.surface === 'callback' || s.surface === 'signin') return 'signin'
  if (!s.authed) return 'signin' // anon on landing/guarded → public landing or /signin bounce

  // 2 · Product access (waitlist). Operators (an admin host OR a SuperAdmin) bypass it.
  // The verdict fails OPEN, but an in-flight check HOLDS at the waitlist stage (its view
  // shows a neutral loader) rather than flashing the app.
  const operator = s.adminHost || s.superAdmin
  if (!operator && (s.waitlistLoading || !s.access)) return 'waitlist'

  // 3 · Org scope. No org → create one; a non-SuperAdmin on an admin host → bounced to the
  // tenant host; an org not yet ENTERED (or not hydrated) → pick one. Never renders org-less.
  if (!s.owner) return 'org'
  if (s.adminHost && !s.superAdmin) return 'org'
  if (s.orgEntered !== true) return 'org'

  // 4 · First-run onboarding takes the whole surface until done — but only once its inputs
  // have resolved (never block the app on an unresolved preference read; show it meanwhile).
  if (s.onboardable && s.onboardReady && !s.onboarded) return 'onboard'

  // 5 · The app.
  return 'ready'
}
