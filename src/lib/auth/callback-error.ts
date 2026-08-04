/**
 * What an OIDC error on the callback MEANS to the person looking at it.
 *
 * The issuer answers a failed authorization by redirecting back here with
 * `?error=<code>` — and most of those codes are not failures at all. Cancelling a
 * consent screen is `access_denied`; a silent `prompt=none` attempt that finds no
 * session is `login_required`. The SDK correctly refuses to treat any of them as a
 * sign-in, throwing one `Error`, and the callback screen flattened every one of
 * them to "Sign-in failed." with a Retry — so a person who simply changed their
 * mind was told the product broke.
 *
 * The code is read from the URL for DISPLAY ONLY. Authority stays with the SDK,
 * which validates `state` before honouring an error branch — without that check
 * `/callback?error=…` is a plain GET anyone can hand a victim, so an attacker
 * could otherwise choose the words on this screen. Classifying a code we only ever
 * render is safe; deciding anything from it would not be.
 */

/** What the callback should DO about an error, once it knows what it is. */
export type CallbackVerdict =
  /** No session to reuse. Not a failure — the person simply needs to sign in. */
  | { kind: 'signin'; message: string }
  /** The person declined. Their choice, not a fault; offer the door again. */
  | { kind: 'declined'; message: string }
  /** Something genuinely went wrong. Say what the issuer said. */
  | { kind: 'failed'; message: string }

/**
 * The two codes that mean "there was no usable session", which is the ordinary
 * answer to a silent attempt rather than an error. `interaction_required` is the
 * same shape: the issuer needs the person, and asking them is the whole fix.
 */
const NEEDS_SIGNIN = new Set(['login_required', 'interaction_required', 'consent_required'])

/** The person said no — to the consent screen, or to the login itself. */
const DECLINED = new Set(['access_denied'])

/**
 * Classify a callback URL's error. `null` when there is no error at all, so the
 * caller keeps its existing success path unchanged.
 *
 * `search` is the raw query string (`window.location.search`), so this stays a pure
 * function of its input and is testable without a browser.
 */
export function classifyCallback(search: string): CallbackVerdict | null {
  let code: string | null = null
  let described: string | null = null
  try {
    const q = new URLSearchParams(search)
    code = q.get('error')
    described = q.get('error_description')
  } catch {
    return null // an unparseable query is not an error response
  }
  if (!code) return null

  if (NEEDS_SIGNIN.has(code)) {
    return { kind: 'signin', message: 'Your session has ended. Sign in to continue.' }
  }
  if (DECLINED.has(code)) {
    return { kind: 'declined', message: 'Sign-in was cancelled.' }
  }

  // An unrecognized code: prefer the issuer's own words, which name the real cause
  // far better than a generic line. Trim it — this is rendered as text, and React
  // escapes it, but an unbounded string from a redirect has no business setting the
  // height of a screen whose only job is to say what happened.
  const said = (described ?? '').trim()
  return {
    kind: 'failed',
    message: said ? said.slice(0, 200) : `Sign-in failed (${code.slice(0, 60)}).`,
  }
}
