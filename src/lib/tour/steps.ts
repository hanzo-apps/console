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
   * The in-console route this step's anchor lives on. A step on ANOTHER route is
   * navigated to before it is spotlighted (that is what makes a tour able to walk a
   * user around the console rather than one screen). Absent ⟹ the anchor is expected
   * on whatever route the tour was launched from.
   */
  route?: string
  /**
   * Personalization: include the step only when this holds (default: always). Lets a
   * tour adapt to the user's real state — e.g. skip the "get your API key" step for a
   * user who already has one. Filtered by `resolveTour` in `lib/guide/spec.ts`.
   */
  when?: (s: GuideSignals) => boolean
}

/**
 * The console first-run tour — honest to what the console actually is (a cloud
 * console for AI products), no fabricated features. Anchors: `nav` + `search`
 * (the shell, dashboard.tsx), `guide-overview-api-key` + `metrics` (home,
 * page.tsx), `workbench` (the Developers dock, lg+ only — it auto-skips on a
 * phone rather than spotlighting nothing).
 */
export const CONSOLE_TOUR: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to your console',
    body: 'A walk through the console: where the products are, how to get an API key, and where your usage and spend show up. Skip anytime.',
    placement: 'center',
  },
  {
    id: 'nav',
    target: '[data-tour="nav"]',
    title: 'Every product, one place',
    body: 'Products are grouped by what they do — AI, Compute, Data, Network, Security and the rest. Star the ones you use and they move to the top.',
    placement: 'right',
  },
  {
    id: 'search',
    target: '[data-tour="search"]',
    title: 'Jump anywhere with ⌘K',
    body: 'One box searches every product and page. Type > to ask the built-in assistant, or ? to search the docs.',
    placement: 'bottom',
  },
  {
    id: 'api-key',
    // The get-your-key affordance now lives in the home getting-started panel.
    target: '[data-tour="guide-overview-api-key"]',
    title: 'One key, every model',
    body: 'Mint a personal sk- key. The same key calls models, embeddings, search and your own services on /v1.',
    placement: 'bottom',
    route: '/',
    // Personalized: a user who already holds a key skips straight past this step.
    when: (s) => s.hasApiKey !== true,
  },
  {
    id: 'metrics',
    target: '[data-tour="metrics"]',
    title: 'Usage and spend',
    body: 'Requests, tokens and what they cost, counted as the calls come in.',
    placement: 'top',
    route: '/',
  },
  {
    id: 'playground',
    target: '[data-tour="pg-compose"]',
    title: 'Try it before you write code',
    body: 'The Playground runs a live model in the browser, then hands you the exact request as cURL or JSON.',
    placement: 'right',
    route: '/playground',
  },
  {
    id: 'workbench',
    target: '[data-tour="workbench"]',
    title: 'The Developers dock',
    body: 'Your recent calls, errors and spend. The Inspector reads any /v1 resource as you, and the Shell is a terminal in your org sandbox.',
    placement: 'top',
  },
]

/**
 * The Playground tour — a walk over the surfaces that make the Playground worth
 * opening, in the order a person actually uses them: pick a modality, pick a
 * model, write the prompt, run it, read the real answer and its real cost, tune
 * it, then take the code. Every anchor is a REAL element on `/playground`.
 */
export const PLAYGROUND_TOUR: TourStep[] = [
  {
    id: 'modes',
    target: '[data-tour="pg-modes"]',
    title: 'Pick a modality',
    body: 'Chat, Completions, Embeddings, Image, Video, Audio and Vision. Every mode runs on the same API, on the same key.',
    placement: 'bottom',
  },
  {
    id: 'model',
    target: '[data-tour="pg-model"]',
    title: 'Any model, one string',
    body: 'Zen, Claude, GPT and Llama models all answer on the same endpoint. Switching model is changing this string.',
    placement: 'bottom',
  },
  {
    id: 'compose',
    target: '[data-tour="pg-compose"]',
    title: 'Write the prompt',
    body: 'A system prompt and the message turns under it. Use {{variables}} to parameterize it, or add images for a vision run.',
    placement: 'right',
  },
  {
    id: 'run',
    target: '[data-tour="pg-run"]',
    title: 'Run it — ⌘↵',
    body: 'The answer streams back token by token from a live model. Stop it whenever you have seen enough.',
    placement: 'top',
  },
  {
    id: 'response',
    target: '[data-tour="pg-response"]',
    title: 'The answer, and what it cost',
    body: 'The completion, its token counts and the price of that call. The Logs tab shows the request that produced it.',
    placement: 'bottom',
  },
  {
    id: 'tune',
    target: '[data-tour="pg-tune"]',
    title: 'Tune it',
    body: 'Temperature, top-p, max tokens, stop sequences, seed. Every control here is a field on the request.',
    placement: 'left',
  },
  {
    id: 'code',
    target: '[data-tour="pg-code"]',
    title: 'Copy as code',
    body: 'Take the request you just ran as cURL or JSON, and paste it into your app as it is.',
    placement: 'bottom',
  },
  {
    id: 'share',
    target: '[data-tour="pg-share"]',
    title: 'Save it, share it',
    body: 'Save a prompt to your library, or copy a link that reopens this prompt, model and settings for a teammate.',
    placement: 'bottom',
  },
  {
    id: 'nav',
    target: '[data-tour="nav"]',
    title: 'The rest of the console',
    body: 'Functions, deployments, vector search, identity and spend each have their own section in the sidebar.',
    placement: 'right',
  },
]

// ── planning: never spotlight nothing ───────────────────────────────────────────

/** Compare two in-console paths ignoring a trailing slash and any query/hash. */
export function sameRoute(a: string, b: string): boolean {
  const norm = (p: string): string => {
    const bare = (p || '/').split(/[?#]/)[0]
    const trimmed = bare.replace(/\/+$/, '')
    return trimmed === '' ? '/' : trimmed
  }
  return norm(a) === norm(b)
}

/**
 * The steps this tour can actually SHOW, given where the user is standing.
 *
 * A step survives when it is centered (no target), when it names another route (the
 * tour navigates there), or when its anchor is on the page right now. A step whose
 * anchor is absent on the route it belongs to is DROPPED — so the progress count is
 * honest from the first step and no step can spotlight an element that isn't there.
 */
export function planTour(
  steps: TourStep[],
  ctx: { pathname: string; has: (selector: string) => boolean },
): TourStep[] {
  return steps.filter((s) => {
    if (!s.target) return true
    if (s.route && !sameRoute(s.route, ctx.pathname)) return true
    return ctx.has(s.target)
  })
}

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
