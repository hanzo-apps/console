/**
 * Preference reconciliation — the pure half of the account-backed store, so the
 * one decision that decides whether a user's customizations survive a reload is
 * unit-tested in isolation (no React, no session, no network).
 *
 * The decision: the account is authoritative for every key it ACTUALLY CARRIES;
 * the local cache fills the rest. It is NOT authoritative for keys it is silent
 * about, because silence and emptiness are different things.
 *
 * Why that distinction is load-bearing (measured in a browser, not inferred):
 * the console reads `properties['hanzo.preferences']` off the IAM access token's
 * claims, and a preference written AFTER sign-in is not in a token minted BEFORE
 * it. So a freshly-pinned product is absent from `fromAccount` until the token is
 * re-minted. Treating that absence as "the account says you have no pins" wiped
 * the cache on every reload and lost pins, pin groups, product colors, and the
 * nav's open sections — everything the user had configured.
 *
 * That fixed the SILENT case. The other half is the case where the account is not
 * silent at all: once the user has saved anything, the next token carries a
 * SNAPSHOT of the document as it stood when that token was minted. Every change
 * made afterwards is newer than the snapshot, and letting the snapshot win threw
 * it away on the next reload — a pin that reads as pinned, and is gone after F5.
 *
 * The old version of this comment named the missing piece exactly — "merging
 * cannot invent an ordering it wasn't told" — and left it there. So it is told:
 *
 *   - `tokenIssuedAt` — the identity token's own `iat` (seconds). This is the
 *     instant the snapshot in `fromAccount` was taken.
 *   - `cacheWrittenAt` — when the SERVER last CONFIRMED a write for this user
 *     (ms). Not when the browser optimistically painted one: a write the server
 *     never acknowledged records nothing, so a failed save can never out-rank the
 *     real stored document. That is the difference between ordering two real
 *     writes and inventing durability in localStorage.
 *
 * Last writer wins: a confirmed write that is newer than the snapshot wins, and
 * anything else leaves the account authoritative — so a fresh device (no cache,
 * no stamp) and a fresh sign-in (a token minted after the write) both still pick
 * up what was saved elsewhere.
 *
 * Residual gap, stated rather than papered over: there is no READ endpoint for
 * this document. `PATCH /v1/ai/preferences` (hanzoai/ai `UpdatePreferences`)
 * writes it to the IAM user's `properties['hanzo.preferences']` and returns the
 * merged result, but nothing serves a GET, so the only read the console has is
 * the token's snapshot. The smallest seam that removes the ordering problem
 * entirely is a `GET /v1/ai/preferences` returning that same property after the
 * handler's existing `refreshSessionUser` — the write path already does every
 * part of it. (`GET/PATCH /v1/prefs` in hanzoai/cloud `apps/prefs` is the
 * canonical cross-surface plane and would be better still; it answers 503 on
 * api.hanzo.ai today.)
 */

/** A user's preferences: an open map of key → whatever that key stores. */
export type Preferences = Record<string, unknown>

/**
 * Parse a stored preferences blob. Anything that isn't a JSON object — absent,
 * malformed, an array, a bare string — reads as empty rather than throwing, so a
 * corrupt cache degrades to "no customizations" instead of a blank console.
 */
export function parsePrefs(raw: string | undefined | null): Preferences {
  if (!raw) return {}
  try {
    const p: unknown = JSON.parse(raw)
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Preferences) : {}
  } catch {
    return {}
  }
}

/** When each side was written, so the merge can order them. Both optional: absent
 *  means "unknown", and an unknown side never wins. */
export type PrefsOrder = {
  /** The identity token's `iat`, in SECONDS (the JWT unit). */
  tokenIssuedAt?: number
  /** The last SERVER-CONFIRMED local write, in MILLISECONDS. */
  cacheWrittenAt?: number
}

/**
 * True when the cache holds a confirmed write the account's snapshot cannot know
 * about — i.e. the write landed after the token was minted. Unknown token age with
 * a confirmed write also counts: we can prove the write happened and cannot prove
 * the snapshot is newer, and the direction that loses a user's work is the wrong
 * one to guess in.
 */
export function cacheIsNewer(order: PrefsOrder | undefined): boolean {
  const written = order?.cacheWrittenAt
  if (!written) return false
  const minted = order?.tokenIssuedAt
  return !minted || written > minted * 1000
}

/**
 * Reconcile the fast-paint cache with what the account carries. Account keys win;
 * cached keys the account is silent about survive — UNLESS the cache holds a
 * server-confirmed write newer than the account's snapshot, in which case the
 * cache wins for the keys they disagree on. Neither input is mutated.
 */
export function mergePrefs(cached: Preferences, fromAccount: Preferences, order?: PrefsOrder): Preferences {
  return cacheIsNewer(order) ? { ...fromAccount, ...cached } : { ...cached, ...fromAccount }
}
