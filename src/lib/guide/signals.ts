/**
 * Guide personalization SIGNALS — the pure value that drives which pitch, which
 * getting-started steps, and which tour steps a signed-in user sees. DYNAMIC by
 * construction: every field is a REAL fact about the user (their org role, whether
 * they hold an API key, what they've actually opened in the console), never a
 * fabricated one. An unknown fact stays `undefined` and any step that depends on it
 * is treated as NOT done — we never claim a user did something we can't verify.
 *
 * PURE + SSR-safe (no React, no @hanzo/gui), so it is node-vitest-testable and
 * shared by the hook (`use-signals.ts`), the step logic (`spec.ts`), and the tour.
 * Mirrors the localStorage/preference conventions of `lib/onboarding/steps.ts` and
 * `lib/tour/steps.ts`.
 */
import type { OnboardingState } from '~/lib/onboarding/steps'

/** The org role the guide personalizes on (best-effort; `unknown` when the account is silent). */
export type GuideRole = 'super-admin' | 'admin' | 'member' | 'unknown'

/** The real, per-user facts a guide adapts to. */
export interface GuideSignals {
  /** Account owner key (org) — the identity/brand scope of every guide decision. */
  owner: string
  /** First-run ⟺ onboarding is not yet complete for this account. */
  firstRun: boolean
  /** The user's role in their org (drives team/admin-only steps). */
  role: GuideRole
  /** Whether the account holds a Cloud API key. `undefined` until known (honest). */
  hasApiKey?: boolean
  /** Product ids the user has actually opened/acted on in-console (our own honest telemetry). */
  used: Record<string, boolean>
}

/** The preference key holding the honest in-console usage map (`{ [id]: true }`). */
export const USED_PREF_KEY = 'guide.used'

/** Read the usage map out of a raw preference value — defensively, always an object of `true`s. */
export function usedMap(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (v === true) out[k] = true
  return out
}

/** Add a product id to the usage map (immutable, idempotent). */
export function withUsed(map: Record<string, boolean>, id: string): Record<string, boolean> {
  if (!id || map[id]) return map
  return { ...map, [id]: true }
}

/** True when the user has opened/acted on a product in-console. */
export function isUsed(signals: GuideSignals, id: string): boolean {
  return Boolean(signals.used[id])
}

/** First-run ⟺ onboarding has not been completed. */
export function firstRunFromOnboarding(state: OnboardingState | undefined | null): boolean {
  return !state?.completed
}

/** Map an account's admin flags to a role (super-admin wins; then org-admin; then member). */
export function roleFrom(input: {
  isSuperAdmin?: boolean
  isAdmin?: boolean
  known?: boolean
}): GuideRole {
  if (input.isSuperAdmin) return 'super-admin'
  if (input.isAdmin) return 'admin'
  return input.known ? 'member' : 'unknown'
}

/** True for a role that can administer the org (invite users, manage IAM). */
export function canAdminister(role: GuideRole): boolean {
  return role === 'admin' || role === 'super-admin'
}

/** Stable `data-tour` anchor id for a guide step row (the tour's spotlight target). */
export function stepAnchorId(guideId: string, stepId: string): string {
  return `guide-${guideId}-${stepId}`
}

/** The CSS selector the tour spotlights for a guide step row. */
export function stepAnchorSelector(guideId: string, stepId: string): string {
  return `[data-tour="${stepAnchorId(guideId, stepId)}"]`
}
