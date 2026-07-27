/**
 * Guided-tour steps + a per-account "seen" guard — PURE + SSR-safe (no
 * `@hanzo/gui`/icon imports), so it is node-vitest-testable like
 * `src/components/ui/states-logic.ts` and mirrors the localStorage pattern of
 * `src/lib/onboarding/guard.ts`.
 *
 * The tour is a fully NATIVE, self-contained first-run walkthrough — zero external
 * scripts (no Appcues/driver.js), so it works inside the go:embed static console and
 * under any CSP. Steps target stable `data-tour="<id>"` anchors; a step with no
 * target (or whose target isn't on the current page) renders centered.
 */

import type { GuideSignals } from '~/lib/guide/signals'

/** Where a step's tooltip sits relative to its target (centered when no target). */
export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center'

/** One tour step. `target` is a CSS selector — by convention `[data-tour="<id>"]`. */
export type TourStep = {
  id: string
  target?: string
  title: string
  body: string
  placement?: TourPlacement
  /**
   * Personalization: include the step only when this holds (default: always). Lets a
   * tour adapt to the user's real state — e.g. skip the "get your API key" step for a
   * user who already has one. Filtered by `resolveTour` in `lib/guide/spec.ts`.
   */
  when?: (s: GuideSignals) => boolean
}

/**
 * The console first-run tour — honest to what the console actually is (a cloud
 * console for AI products), no fabricated features. Anchors: `nav` (sidebar,
 * DashboardShell), `api-key` + `metrics` (home, page.tsx). Missing anchors center.
 */
export const CONSOLE_TOUR: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to your console',
    body: 'A quick tour of the essentials — your products, your API key, and your live usage. Takes about 20 seconds. You can skip anytime.',
    placement: 'center',
  },
  {
    id: 'nav',
    target: '[data-tour="nav"]',
    title: 'Every product, one place',
    body: 'Browse and open every product from the sidebar — AI, Compute, Data, Security, Deploy, Observe, and more. Pin the ones you use most.',
    placement: 'right',
  },
  {
    id: 'api-key',
    // The get-your-key affordance now lives in the home getting-started panel.
    target: '[data-tour="guide-overview-api-key"]',
    title: 'Get your API key',
    body: 'Create a personal key to call the models from your apps, SDKs, and CLI. It is the fastest way to start building.',
    placement: 'bottom',
    // Personalized: a user who already holds a key skips straight past this step.
    when: (s) => s.hasApiKey !== true,
  },
  {
    id: 'metrics',
    target: '[data-tour="metrics"]',
    title: 'Live observability',
    body: 'Your inference metrics, logs, and traces stream here in real time — the same signals across every product. Open Observability for the full view.',
    placement: 'top',
  },
  {
    id: 'assistant',
    title: 'Ask the assistant anytime',
    body: 'The built-in assistant knows the whole suite — press ⌘K or open the chat bubble to ask how to do anything, or jump straight to a product.',
    placement: 'center',
  },
]

// ── pure index helpers ────────────────────────────────────────────────────────────

/** Clamp an index into [0, len-1] (empty → 0). */
export function clampIndex(i: number, len: number): number {
  if (!Number.isFinite(i) || len <= 0) return 0
  return Math.max(0, Math.min(Math.trunc(i), len - 1))
}

/** Next index, clamped at the last step (never wraps). */
export function nextIndex(i: number, len: number): number {
  return clampIndex(i + 1, len)
}

/** Previous index, clamped at 0 (never wraps). */
export function prevIndex(i: number): number {
  const t = Math.trunc(i)
  return Number.isFinite(t) ? Math.max(0, t - 1) : 0
}

/** True when `i` is the last step. */
export function isLast(i: number, len: number): boolean {
  return len > 0 && i >= len - 1
}

// ── per-account "seen" guard (versioned, owner-keyed, SSR-safe) ─────────────────────

/** Bump to re-show the tour to everyone after a material change. */
export const TOUR_VERSION = 1

const seenKey = (owner: string): string => `hz_tour_seen:v${TOUR_VERSION}:${owner}`

/** True once this account has finished/skipped the current tour version on this browser. */
export function hasSeenTour(owner: string): boolean {
  if (!owner || typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(seenKey(owner)) === '1'
  } catch {
    return false
  }
}

/** Mark the tour seen for this account (survives reloads). */
export function markTourSeen(owner: string): void {
  if (!owner || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(seenKey(owner), '1')
  } catch {
    /* private mode — worst case the tour shows again next session */
  }
}

/** Clear the seen flag so the tour can be replayed (a "Restart tour" affordance). */
export function resetTour(owner: string): void {
  if (!owner || typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(seenKey(owner))
  } catch {
    /* no-op */
  }
}
