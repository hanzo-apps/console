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
 * Known limit, stated rather than papered over: while the account DOES carry a
 * key, it wins, so clearing that key on one device can be re-asserted by a stale
 * token on the next load. Closing that needs a read-back of the stored
 * preferences (a fresh account read, or the properties riding a refreshed token)
 * — a backend/session concern. Merging cannot invent an ordering it wasn't told.
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

/**
 * Reconcile the fast-paint cache with what the account carries. Account keys win;
 * cached keys the account is silent about survive. Neither input is mutated.
 */
export function mergePrefs(cached: Preferences, fromAccount: Preferences): Preferences {
  return { ...cached, ...fromAccount }
}
