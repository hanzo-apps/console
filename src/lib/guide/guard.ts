/**
 * Per-product guide DISMISSAL guard — versioned, owner-keyed, SSR-safe localStorage,
 * mirroring `lib/tour/steps.ts` (hasSeenTour) and `lib/onboarding/guard.ts`.
 *
 * A guide's getting-started panel hides on its own once the user has finished every
 * step (the DYNAMIC completion state). This guard is the MANUAL override: a user can
 * dismiss a product's panel and it stays hidden for that product on this browser,
 * even with steps outstanding. Resettable, so a "Show guide" affordance can bring it
 * back. Owner-keyed so it never leaks across accounts on a shared browser.
 */

/** Bump to re-surface every product guide after a material content change. */
export const GUIDE_VERSION = 1

const dismissKey = (owner: string, id: string): string =>
  `hz_guide_dismissed:v${GUIDE_VERSION}:${owner}:${id}`

/** True once this account has dismissed this product's guide panel on this browser. */
export function isGuideDismissed(owner: string, id: string): boolean {
  if (!owner || !id || typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(dismissKey(owner, id)) === '1'
  } catch {
    return false
  }
}

/** Dismiss a product's guide panel for this account (survives reloads). */
export function dismissGuide(owner: string, id: string): void {
  if (!owner || !id || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(dismissKey(owner, id), '1')
  } catch {
    /* private mode — worst case the panel shows again next session */
  }
}

/** Clear the dismissal so the guide can resurface (a "Show guide" affordance). */
export function resetGuide(owner: string, id: string): void {
  if (!owner || !id || typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(dismissKey(owner, id))
  } catch {
    /* no-op */
  }
}
