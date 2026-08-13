/**
 * Pure honest-error classification — the VALUE half of `States.tsx`.
 *
 * Lives in a plain `.ts` (no `@hanzo/gui` / lucide-icon imports) so it is
 * unit-testable in the node vitest env; `States.tsx` renders it. It maps an
 * `ApiError` to a specific, truthful title + body plus an optional affordance flag
 * — never a generic crash, never fabricated data.
 */
import { ApiError } from '~/lib/api'

/** Surface-specific overrides for the 404/unauthorized explanations. */
export type HonestCopy = { notFound?: string; unauthorized?: string }

/**
 * The honest render model: a title + body, plus AT MOST ONE affordance flag —
 * `reauth` (401 → re-sign-in) or `topUp` (402 → add credits). A plain failure sets
 * neither; the two are mutually exclusive by construction (distinct statuses).
 */
export type HonestError = {
  title: string
  body: string
  reauth?: boolean
  topUp?: boolean
  subscribe?: boolean
}

/**
 * Map an ApiError to an honest title + body. Defaults are generic and truthful.
 *
 * 401 and 403 are DISTINCT: a 401 means the session lapsed (re-auth fixes it →
 * `reauth`), a 403 means the signed-in account isn't authorized for this surface.
 * A signed-in user is NEVER told to "sign in" for a 403.
 *
 * A 402 is DISTINCT again, and it is TWO different asks that must not be conflated:
 *
 *   - `subscription_required` — the paywall refused a gated product route because the
 *     org holds no paid plan. The fix is to SUBSCRIBE (`subscribe`), so the caller
 *     offers "See plans" and sends them to the plans page.
 *   - anything else — the org has no funded balance for a metered call. The fix is to
 *     top up (`topUp`), so the caller offers "Add credits".
 *
 * Sending a planless org to /billing/credits buys credits it cannot spend, and the
 * paywall would refuse the very next request. Neither is a crash or an access failure.
 */
export function honestError(err: ApiError, copy: HonestCopy = {}): HonestError {
  if (err.status === 404)
    return {
      title: 'Not available on this deployment',
      body:
        copy.notFound ??
        'This API is not routed on this host yet. It appears automatically once the deployment proxies it through the gateway.',
    }
  if (err.status === 503)
    return {
      title: 'Service unavailable',
      body: 'The service is starting up or temporarily unavailable. Retry in a moment.',
    }
  if (err.status === 402) {
    // The paywall answers {"error":"subscription_required"}; the API clients surface
    // that as the message. Match the machine-readable token, not prose.
    if (/subscription_required/i.test(err.message))
      return {
        title: 'Subscribe to continue',
        body: 'This product is included with a paid plan. Your organization does not have one yet — pick a plan to turn it on.',
        subscribe: true,
      }
    return {
      title: 'Add credits to continue',
      body: 'This product needs a funded balance to load. Add credits to your organization to get started.',
      topUp: true,
    }
  }
  if (err.status === 401)
    return {
      title: 'Your session expired',
      body: 'Your session has expired or isn’t recognized here. Sign in again to continue where you left off.',
      reauth: true,
    }
  if (err.status === 403 || /sign ?in|login|unauthorized/i.test(err.message)) {
    // An org-scoped read refused because the SIGN-IN belongs to another org is not an
    // authorization level at all — the account may be an admin here and still be
    // refused, because IAM pins a credential to the org it was minted in and names
    // that org in its refusal. Read the org out of it (machine-readable, like the 402
    // token above) and say which one you are actually signed in to. The generic 403
    // copy guessed "admin-only surface, or not enabled for your organization", and
    // both halves were false: a person watching that card had no way to learn that
    // switching back to their own org is the whole fix.
    const pinned = /scoped to organization (\S+)/.exec(err.message)?.[1]
    if (pinned)
      return {
        title: `Signed in to ${pinned}`,
        body: `This belongs to another organization. Your sign-in is scoped to ${pinned}, so only ${pinned}'s resources load here — switch back to ${pinned}, or sign in to the organization that owns this.`,
      }
    return {
      title: 'Access required',
      body:
        copy.unauthorized ??
        "You're signed in, but this account isn't authorized for this — it's an admin-only surface, or it isn't enabled for your organization yet.",
    }
  }
  return { title: 'Could not load', body: err.message }
}
