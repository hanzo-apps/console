/**
 * Guide — PURE view logic (no React, no @hanzo/gui, no registry import), so it is
 * unit-testable in the plain-node vitest env and shared by the module + any future
 * surface. Mirrors the onboarding `steps.ts` convention.
 */
import type { GuideOverview, GuideStep, StepState, GuideEvent, GuideSuggestion } from '~/lib/api/guide'
import { toneVar } from '~/components/ui/tone'

/** Human label for a step state. */
export function stateLabel(s: StepState): string {
  switch (s) {
    case 'done':
      return 'Done'
    case 'in_progress':
      return 'In progress'
    case 'skipped':
      return 'Skipped'
    default:
      return 'To do'
  }
}

/** The greyscale weight for a step state — the ONE console tone map, as a CSS value. */
export function stateTone(s: StepState): string {
  switch (s) {
    case 'done':
      return toneVar('positive')
    case 'in_progress':
      return toneVar('warning')
    default:
      return toneVar('muted') // skipped + to-do are both resolved-or-not-started
  }
}

/** Whether a step is terminal (done/skipped) — resolved, excluded from "next". */
export function isTerminal(s: StepState): boolean {
  return s === 'done' || s === 'skipped'
}

/**
 * The step the org should tackle next: the one the backend named (`progress.next`),
 * else the first non-terminal available step, else the first non-terminal step, else
 * null (everything resolved).
 */
export function currentStep(o: GuideOverview): GuideStep | null {
  const byId = (id: string) => o.steps.find((s) => s.id === id) ?? null
  if (o.progress.next) {
    const s = byId(o.progress.next)
    if (s) return s
  }
  return (
    o.steps.find((s) => !isTerminal(s.state) && s.available) ??
    o.steps.find((s) => !isTerminal(s.state)) ??
    null
  )
}

/** Percent clamped to 0..100 (defensive against a bad backend value). */
export function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** A short "N of M complete" caption. */
export function progressCaption(o: GuideOverview): string {
  const { done, total } = o.progress
  if (total <= 0) return 'No steps'
  return `${done} of ${total} complete`
}

/** Whether the whole guide is complete (every step terminal). */
export function isComplete(o: GuideOverview): boolean {
  return o.steps.length > 0 && o.steps.every((s) => isTerminal(s.state))
}

/** Human label for a "how blocked" list. */
export function blockedLabel(step: GuideStep, o: GuideOverview): string {
  if (step.blockedBy.length === 0) return ''
  const titles = step.blockedBy.map((id) => o.steps.find((s) => s.id === id)?.title ?? id)
  return `Blocked by: ${titles.join(', ')}`
}

// ── Chat + suggest + budget (Business AI "what to do next") ──────────────────

/** One chat turn: who spoke and what they said. */
export type ChatTurn = { role: 'you' | 'ai'; text: string }

/**
 * Format USD cents as `$X.XX`, or an em-dash when the balance is unknown — the ONE
 * money format for the Guide's budget display (mirrors the sidebar wallet).
 */
export function usd(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

/**
 * The AI-ready quests among a suggestion set — the ones the Business AI can run for
 * the founder (so the chat/suggest UI offers a "Do it for me" on exactly these). The
 * suggest endpoint only returns AVAILABLE candidates, so an automatable one is always
 * runnable.
 */
export function automatableSuggestions(suggestions: GuideSuggestion[]): GuideSuggestion[] {
  return suggestions.filter((s) => s.automatable && s.stepId.length > 0)
}

/** The single best next quest (the first, highest-leverage suggestion), or null. */
export function topSuggestion(suggestions: GuideSuggestion[]): GuideSuggestion | null {
  return suggestions.length > 0 ? suggestions[0] : null
}

/** Label for one streamed Business AI event type. */
export function eventLabel(e: GuideEvent): string {
  switch (e.type) {
    case 'plan':
      return 'Planning'
    case 'draft':
      return 'Drafted content'
    case 'action':
      return `Running ${e.tool ?? 'tool'}`
    case 'result':
      return 'Result'
    case 'state':
      return `Marked ${e.state ? stateLabel(e.state).toLowerCase() : 'updated'}`
    case 'error':
      return 'Error'
    case 'end':
      return 'Finished'
    default:
      return String(e.type)
  }
}
