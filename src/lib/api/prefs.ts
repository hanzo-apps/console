/**
 * User preferences — the ONE cross-product store for a signed-in person's own UI
 * state (theme, density, pinned nav, and anything a surface adds later).
 *
 * Backed by cloud `GET/PATCH /v1/prefs` (`clients/prefs`), a per-USER SQLite
 * document keyed on the canonical `<owner>/<name>` identity the server derives
 * from the validated token. The client never sends a user id — there is no way
 * to ask for someone else's preferences, by construction.
 *
 * WHY THIS REPLACED `update-preferences`. The previous write POSTed
 * `/v1/update-preferences`, an IAM endpoint that is not served: every save
 * returned as if it worked and persisted nothing, so a preference survived only
 * as long as the localStorage cache in front of it. The read side had the same
 * gap — it recovered prefs from the IAM account's `properties` blob, which
 * nothing was writing. This is the endpoint that layer always needed.
 *
 * PATCH, not PUT. A surface sends only the keys it owns; the server merges them
 * into the stored document under one transaction. That is what lets the console
 * save `theme` while insights saves `density` without either erasing the other —
 * with a PUT, whichever tab saved last would silently drop the other's keys.
 *
 * A `null` value DELETES its key (the server's merge contract), so clearing a
 * preference is expressible without every client inventing an "unset" sentinel.
 */
import { originGet, originPatch } from './client'

/** One user's preference document. Values are opaque to the transport. */
export type Preferences = Record<string, unknown>

type PrefsResponse = {
  prefs?: unknown
  updatedAt?: number
}

/**
 * Coerce the wire shape to a plain object. Defensive because a preference
 * document is the LAST thing that should be able to break a page: a surface
 * missing its theme is a cosmetic problem, a thrown render is not. Anything that
 * is not a JSON object — an array, a scalar, null, a malformed payload — reads as
 * "no preferences yet", which is exactly how a first-time user reads.
 */
export function normalizePrefs(raw: unknown): Preferences {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const body = raw as PrefsResponse
  const prefs = 'prefs' in body ? body.prefs : raw
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return {}
  return prefs as Preferences
}

export const PrefsApi = {
  /**
   * The caller's own preferences. Always resolves: a user who has never saved
   * one reads an empty object rather than a 404, so the menu always renders.
   */
  get: (): Promise<Preferences> =>
    originGet<unknown>('prefs').then(normalizePrefs),

  /**
   * Merge a partial set of keys into the caller's document and return the
   * merged result — so the local view picks up any keys another surface (or
   * another device) wrote in the meantime, rather than drifting until reload.
   */
  merge: (partial: Preferences): Promise<Preferences> =>
    originPatch<unknown>('prefs', partial).then(normalizePrefs),
}
