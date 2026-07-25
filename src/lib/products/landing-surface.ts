/**
 * landingSurface — the console landing's header actions.
 *
 * The shared `@hanzogui/shell` header carries TWO orthogonal things:
 *   IDENTITY   — brand · local nav · the Products taxonomy (per-surface DATA), and
 *   NAVIGATION — its two CTAs (where to send the visitor next).
 *
 * For the `cloud.hanzo.ai` surface the primary CTA points AT the console
 * ("Open Console" → https://console.hanzo.ai). That is right from anywhere ELSE,
 * but on the console's OWN landing it is a SELF-LINK: clicking it re-renders the
 * same anonymous page, so it reads as a dead button.
 *
 * Identity is exactly right, so this keeps the canonical surface and re-points ONLY
 * the two actions at the ONE sign-in path — signing in IS how you open the console,
 * and a key is minted once you are in. Pure (base injected, nothing resolved here),
 * so it is node-testable and the shared header is never forked.
 */
import type { HanzoSurface } from '@hanzogui/shell'

/** The ONE sign-in surface the console landing owns. */
export const SIGN_IN = '/signin'

/** Re-point a surface's two header CTAs at the local sign-in path. */
export function landingSurface(base: HanzoSurface): HanzoSurface {
  return {
    ...base,
    secondaryCTA: { ...base.secondaryCTA, href: SIGN_IN, external: false },
    primaryCTA: { ...base.primaryCTA, id: 'signin', label: 'Sign in', href: SIGN_IN, external: false },
  }
}
