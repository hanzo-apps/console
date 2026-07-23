/**
 * Active actor scope — WHO the console is currently acting as (the signed-in user).
 *
 * Orthogonal to org-scope (`lib/org-scope.ts`, the acting ORG) and resource-scope
 * (`lib/scope.ts`, project + environment): this module's single concern is the user
 * identity, so the three compose into the full tenant path — org -> project ->
 * environment, acting AS this user — with no layer knowing another's internals.
 *
 * Held in localStorage (browser-only) and read SYNCHRONOUSLY by `client.ts`'s
 * `baseHeaders`, which stamps it as `X-Actor-Id` on every call (present only once a
 * session is resolved — absent pre-sign-in / SSR). The value is the casibase
 * principal `<owner>/<name>` (globally unique). `SessionProvider` is the ONE writer,
 * keeping it in lockstep with the resolved account (set on sign-in, cleared on
 * sign-out) — the auth twin of how `Scope` keeps org-scope in sync.
 */
const KEY = 'hanzo.console.actor'

/** The signed-in user's principal id (`<owner>/<name>`), or '' when none is set. */
export function currentActor(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(KEY) ?? ''
  } catch {
    // localStorage blocked (private mode) — no actor id; the call omits X-Actor-Id.
    return ''
  }
}

/** Set (or clear, with '') the active actor id. Browser-only; a no-op on the server. */
export function setCurrentActor(actor: string): void {
  if (typeof window === 'undefined') return
  try {
    if (actor) window.localStorage.setItem(KEY, actor)
    else window.localStorage.removeItem(KEY)
  } catch {
    // Storage blocked — the actor simply stays unset (X-Actor-Id omitted).
  }
}
