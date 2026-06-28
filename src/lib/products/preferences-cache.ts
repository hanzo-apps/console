/**
 * Preferences fast-paint cache — the localStorage key scheme, in ONE place so
 * both the provider (which writes it) and sign-out (which must clear it) agree.
 *
 * The cache is only a flash-of-pins optimization; the IAM account is the source
 * of truth. On sign-out it MUST be wiped so a shared browser never paints the
 * previous user's pins/layout to the next person.
 */

/** localStorage key prefix for the per-user preferences cache. */
export const PREFS_CACHE_PREFIX = 'hanzo.console2.prefs.'

/** Per-user (or anonymous) cache key. */
export const prefsCacheKey = (name: string | undefined): string => `${PREFS_CACHE_PREFIX}${name ?? 'anon'}`

/** localStorage if present (absent in SSR / some privacy modes), else undefined. */
function storage(): Storage | undefined {
  return typeof window !== 'undefined' ? window.localStorage : undefined
}

/**
 * Remove EVERY cached preferences entry (all users + anon) from localStorage.
 * Called on sign-out. No-op when localStorage is unavailable.
 */
export function clearPreferencesCache(): void {
  const ls = storage()
  if (!ls) return
  const stale: string[] = []
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i)
    if (key && key.startsWith(PREFS_CACHE_PREFIX)) stale.push(key)
  }
  for (const key of stale) ls.removeItem(key)
}
