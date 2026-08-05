/**
 * First-run onboarding — the PURE step model (no React, no transport), so it is
 * unit-testable in the plain-node vitest env and shared by the gate, the wizard,
 * and the progress rail.
 *
 * The six post-signup steps (order is the flow): secure the account (2FA) →
 * data & consent → confirm the organization → unlock free-trial credits → choose AI
 * access → first action. The whole state is one JSON object persisted under the
 * account preference key `onboarding` (see `useOnboarding`), so a half-finished
 * flow RESUMES on the next load and a completed one never shows again.
 */

/** The six steps, in flow order. */
export type StepId = 'secure' | 'consent' | 'team' | 'credits' | 'ai' | 'launch'

/** How a step was left: finished, or deliberately skipped (both advance the flow). */
export type StepStatus = 'done' | 'skipped'

/** The AI-access choices the user can make (one or more), recorded for the rail. */
export type AiChoice = 'router' | 'byo' | 'connect'

/** ToS acknowledgement + the optional data-sharing opt-in (default OFF). */
export interface OnboardingConsent {
  /** ISO time the user acknowledged the Terms + Privacy Policy. */
  termsAcceptedAt?: string
  /** Opt-in to "improve models with my data" — DEFAULT OFF. */
  dataSharing?: boolean
}

/** The persisted onboarding state (one preference key: `onboarding`). */
export interface OnboardingState {
  /** Schema version, so a future shape change can migrate cleanly. */
  version?: number
  /** The single `onboarding_completed` flag — the ONLY thing that stops the wizard. */
  completed?: boolean
  /** ISO completion time. */
  completedAt?: string
  /** Resume point — the step the user was last on. */
  step?: StepId
  /** Per-step outcome, for the progress rail + resume. */
  status?: Partial<Record<StepId, StepStatus>>
  /** Consent choices (persisted to the account). */
  consent?: OnboardingConsent
  /** AI-access choices made in step 5. */
  aiChoices?: AiChoice[]
}

/** Static metadata for one step (title + one-line blurb for the rail). */
export interface OnboardingStepMeta {
  id: StepId
  title: string
  blurb: string
}

/** The ordered step catalog — the ONE source of the flow order + rail labels. */
export const ONBOARDING_STEPS: readonly OnboardingStepMeta[] = [
  { id: 'secure', title: 'Secure your account', blurb: 'Two-factor authentication' },
  { id: 'consent', title: 'Data & consent', blurb: 'Terms and data preferences' },
  { id: 'team', title: 'Your organization', blurb: 'Confirm or name your organization' },
  { id: 'credits', title: 'Free trial credits', blurb: 'Add a card to unlock credits' },
  { id: 'ai', title: 'AI access', blurb: 'Connect, bring keys, or use Hanzo' },
  { id: 'launch', title: "You're ready", blurb: 'Take your first action' },
]

/** Current schema version of {@link OnboardingState}. */
export const ONBOARDING_VERSION = 1

/** The last step's index (the "launch" / first-action step). */
export const LAST_INDEX = ONBOARDING_STEPS.length - 1

/** Index of a step id (0 if unknown — never negative). */
export function stepIndex(id: StepId): number {
  const i = ONBOARDING_STEPS.findIndex((s) => s.id === id)
  return i < 0 ? 0 : i
}

/** The step id at an index, clamped into range. */
export function stepAt(index: number): StepId {
  const clamped = Math.max(0, Math.min(index, LAST_INDEX))
  return ONBOARDING_STEPS[clamped].id
}

/** Whether onboarding is finished (the only flag that hides the wizard). */
export function isComplete(state: OnboardingState | undefined | null): boolean {
  return Boolean(state?.completed)
}

/**
 * The first step not yet done or skipped — where a returning user resumes.
 * When every step is handled, returns the last (launch) step's index so the user
 * lands on the finish screen rather than being bounced out.
 */
export function firstIncompleteIndex(state: OnboardingState | undefined | null): number {
  const status = state?.status ?? {}
  for (let i = 0; i < ONBOARDING_STEPS.length; i++) {
    const st = status[ONBOARDING_STEPS[i].id]
    if (st !== 'done' && st !== 'skipped') return i
  }
  return LAST_INDEX
}

/**
 * The index the wizard opens on: an explicit saved resume point wins (clamped),
 * otherwise the first step still needing attention.
 */
export function resumeIndex(state: OnboardingState | undefined | null): number {
  if (state?.step) return stepIndex(state.step)
  return firstIncompleteIndex(state)
}

/** Record a step's outcome (immutable). */
export function withStatus(state: OnboardingState, id: StepId, status: StepStatus): OnboardingState {
  return { ...state, status: { ...state.status, [id]: status } }
}

/** Set the resume point (immutable). */
export function withStep(state: OnboardingState, id: StepId): OnboardingState {
  return { ...state, step: id }
}

/** Merge a consent patch (immutable; never drops existing consent fields). */
export function withConsent(state: OnboardingState, patch: OnboardingConsent): OnboardingState {
  return { ...state, consent: { ...state.consent, ...patch } }
}

/** Add an AI-access choice without duplicating (immutable). */
export function withAiChoice(state: OnboardingState, choice: AiChoice): OnboardingState {
  const set = new Set(state.aiChoices ?? [])
  set.add(choice)
  return { ...state, aiChoices: [...set] }
}

/** Mark onboarding complete (immutable) — stamps `completed` + `completedAt`. */
export function markComplete(state: OnboardingState, at: string): OnboardingState {
  return { ...state, version: ONBOARDING_VERSION, completed: true, completedAt: at }
}
