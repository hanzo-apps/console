/**
 * The guide MODEL — pure types + logic for a product's pitch, its dynamic
 * getting-started steps, and the spotlight tour generated from them. No React, no
 * @hanzo/gui, so it is node-vitest-testable and the components stay presentational.
 *
 * A `ProductGuide` is the SELL for a product: a pitch (what + why) above a
 * getting-started checklist (how). The checklist is DYNAMIC — each step carries a
 * `done(signals)` predicate evaluated against the user's REAL state, so completed
 * steps render checked and drop out of the tour, and the whole panel auto-hides once
 * a user has finished (or dismissed) it. `when(signals)` personalizes which steps a
 * user even sees (e.g. an "invite your team" step only for an org admin).
 */
import type { GuideSignals } from './signals'
import { stepAnchorSelector } from './signals'
import type { TourStep } from '~/lib/tour/steps'

/** A pitch icon name — resolved to a real Lucide glyph in the component (data stays pure). */
export type PitchIcon =
  | 'zap'
  | 'gauge'
  | 'shield'
  | 'sparkles'
  | 'plug'
  | 'code'
  | 'coins'
  | 'globe'
  | 'lock'
  | 'rocket'
  | 'search'
  | 'database'

/** One value proposition — the WHY of the pitch (short, real, no fabrication). */
export interface PitchPoint {
  title: string
  body: string
  icon?: PitchIcon
}

/** The pitch — what the product is + why it's worth using, above the getting-started steps. */
export interface Pitch {
  /** A punchy one-liner that SELLS the product. */
  headline: string
  /** One or two sentences of "what this is", richer than the catalog one-liner. */
  subhead: string
  /** 2–4 value props (the why). */
  points: PitchPoint[]
}

/** One getting-started step — the HOW, personalized + checkable against real signals. */
export interface GuideStep {
  id: string
  title: string
  body: string
  /** In-console CTA (a native route only — never an external link-out). */
  action?: { label: string; to: string }
  /**
   * DYNAMIC completion predicate against real signals. `true` ⟹ the user has already
   * done this (rendered checked). Absent/`undefined`/`false` ⟹ treated as NOT done —
   * we never render a fabricated check.
   */
  done?: (s: GuideSignals) => boolean | undefined
  /** Personalization: include the step only when this holds (default: always). */
  when?: (s: GuideSignals) => boolean
}

/** A product's guide: the pitch + its getting-started steps (+ optional extra tour anchors). */
export interface ProductGuide {
  /** Catalog id this guide is for. */
  id: string
  /** Product label (for tour copy / headings). */
  label: string
  pitch: Pitch
  steps: GuideStep[]
  /**
   * The authored spotlight tour of the product's own surfaces. When present it IS
   * the tour (see {@link buildTourFromSteps}); absent, the tour is generated from
   * the incomplete `steps`.
   */
  tour?: TourStep[]
}

/** A step with its resolved dynamic state, ready to render. */
export interface StepProgress {
  step: GuideStep
  /** Verified done against the signals. */
  done: boolean
  /** The single "do this next" step — the first not-done among the visible steps. */
  active: boolean
}

/** True when a step is verified done (a `true` predicate; unknown/absent ⟹ false — honest). */
export function stepDone(step: GuideStep, s: GuideSignals): boolean {
  return step.done?.(s) === true
}

/** Visible steps for a user: filter by `when`, compute `done`, mark the first not-done active. */
export function resolveSteps(guide: ProductGuide, s: GuideSignals): StepProgress[] {
  const visible = guide.steps.filter((st) => (st.when ? st.when(s) : true))
  let activeTaken = false
  return visible.map((step) => {
    const done = stepDone(step, s)
    const active = !done && !activeTaken
    if (active) activeTaken = true
    return { step, done, active }
  })
}

/** Completion tally over resolved steps. */
export function completion(steps: StepProgress[]): {
  done: number
  total: number
  pct: number
  complete: boolean
} {
  const total = steps.length
  const done = steps.filter((s) => s.done).length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  return { done, total, pct, complete: total > 0 && done === total }
}

/** Count of not-yet-done visible steps — drives whether the panel shows at all. */
export function incompleteCount(steps: StepProgress[]): number {
  return steps.filter((s) => !s.done).length
}

/**
 * The tour for a guide.
 *
 * An AUTHORED tour wins outright: where we have written a real walk over the
 * product's own surfaces (the Playground's modes, model, composer, response…), that
 * is the tour — walking the checklist ROWS instead would spotlight a card the user is
 * already reading and teach them nothing about the product.
 *
 * Otherwise the tour is generated from the user's INCOMPLETE steps, each highlighting
 * that step's on-screen row. Personalized either way: done steps are dropped, so the
 * generated walk covers only what is left.
 */
export function buildTourFromSteps(guide: ProductGuide, resolved: StepProgress[]): TourStep[] {
  if (guide.tour?.length) return guide.tour
  const stepTour: TourStep[] = resolved
    .filter((r) => !r.done)
    .map((r) => ({
      id: `${guide.id}-${r.step.id}`,
      target: stepAnchorSelector(guide.id, r.step.id),
      title: r.step.title,
      body: r.step.body,
      // BELOW the row, never beside it: a checklist row spans the whole card,
      // so "right of the row" is the far viewport edge — the card rendered
      // clipped off-screen there, step one of every tour.
      placement: 'bottom' as const,
    }))
  return [...stepTour, ...(guide.tour ?? [])]
}

/** Filter tour steps by their optional `when` predicate (dynamic / personalized). */
export function resolveTour(steps: TourStep[], s: GuideSignals): TourStep[] {
  return steps.filter((st) => (st.when ? st.when(s) : true))
}
