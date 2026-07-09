import type { OnboardingState } from '~/lib/onboarding/steps'

/**
 * The contract every onboarding step gets from the wizard. The wizard owns the
 * persisted state + navigation; a step renders its content, commits its own
 * side-effect, then calls `next`/`skip`. `patch` shallow-merges into the persisted
 * onboarding object (which is written wholesale to the account preference).
 */
export interface StepProps {
  state: OnboardingState
  /** Shallow-merge a partial into the persisted onboarding state (+ persist). */
  patch: (partial: Partial<OnboardingState>) => void
  /** Advance to the next step, marking the current one done. */
  next: () => void
  /** Advance to the next step, marking the current one skipped. */
  skip: () => void
  /** Go back to the previous step (no-op on the first). */
  back: () => void
  /** True on the first step (Back is hidden). */
  isFirst: boolean
  /** Finish onboarding and (optionally) navigate to a product route. */
  finish: (destination?: string) => void
}
