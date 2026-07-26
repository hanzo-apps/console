import { describe, it, expect } from 'vitest'
import type { GuideOverview, GuideStep, GuideSuggestion } from '~/lib/api/guide'
import {
  stateLabel,
  isTerminal,
  currentStep,
  clampPercent,
  progressCaption,
  isComplete,
  blockedLabel,
  eventLabel,
  usd,
  automatableSuggestions,
  topSuggestion,
} from './logic'

const suggestion = (p: Partial<GuideSuggestion> & { stepId: string }): GuideSuggestion => ({
  stepId: p.stepId,
  title: p.title ?? p.stepId,
  why: p.why ?? '',
  rationale: p.rationale ?? '',
  automatable: p.automatable ?? false,
  unlocks: p.unlocks ?? 0,
})

const step = (p: Partial<GuideStep> & { id: string }): GuideStep => ({
  id: p.id,
  title: p.title ?? p.id,
  why: '',
  how: '',
  done: '',
  dependencies: p.dependencies ?? [],
  signal: p.signal ?? '',
  tool: p.tool ?? '',
  automatable: p.automatable ?? false,
  state: p.state ?? 'todo',
  source: p.source ?? '',
  available: p.available ?? true,
  blockedBy: p.blockedBy ?? [],
})

const overview = (steps: GuideStep[], next: string): GuideOverview => ({
  version: 't',
  title: 'T',
  custom: false,
  progress: {
    done: steps.filter((s) => isTerminal(s.state)).length,
    total: steps.length,
    percent: steps.length ? Math.round((steps.filter((s) => isTerminal(s.state)).length * 100) / steps.length) : 0,
    next,
  },
  steps,
})

describe('guide logic', () => {
  it('labels states', () => {
    expect(stateLabel('done')).toBe('Done')
    expect(stateLabel('in_progress')).toBe('In progress')
    expect(stateLabel('skipped')).toBe('Skipped')
    expect(stateLabel('todo')).toBe('To do')
  })

  it('isTerminal for done+skipped only', () => {
    expect(isTerminal('done')).toBe(true)
    expect(isTerminal('skipped')).toBe(true)
    expect(isTerminal('todo')).toBe(false)
    expect(isTerminal('in_progress')).toBe(false)
  })

  it('currentStep honors the backend next pointer', () => {
    const o = overview([step({ id: 'a', state: 'done' }), step({ id: 'b' }), step({ id: 'c' })], 'b')
    expect(currentStep(o)?.id).toBe('b')
  })

  it('currentStep falls back to first non-terminal available when next is empty', () => {
    const o = overview(
      [step({ id: 'a', state: 'done' }), step({ id: 'b', available: false }), step({ id: 'c', available: true })],
      '',
    )
    expect(currentStep(o)?.id).toBe('c')
  })

  it('currentStep returns null when everything is resolved', () => {
    const o = overview([step({ id: 'a', state: 'done' }), step({ id: 'b', state: 'skipped' })], '')
    expect(currentStep(o)).toBeNull()
    expect(isComplete(o)).toBe(true)
  })

  it('clampPercent bounds 0..100 and rounds', () => {
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(150)).toBe(100)
    expect(clampPercent(66.6)).toBe(67)
    expect(clampPercent(NaN)).toBe(0)
  })

  it('progressCaption', () => {
    const o = overview([step({ id: 'a', state: 'done' }), step({ id: 'b' })], 'b')
    expect(progressCaption(o)).toBe('1 of 2 complete')
    expect(progressCaption(overview([], ''))).toBe('No steps')
  })

  it('blockedLabel names the blocking step titles', () => {
    const o = overview(
      [step({ id: 'positioning', title: 'Positioning', state: 'todo' }), step({ id: 'landing', title: 'Landing', blockedBy: ['positioning'], available: false })],
      'positioning',
    )
    expect(blockedLabel(o.steps[1], o)).toBe('Blocked by: Positioning')
    expect(blockedLabel(o.steps[0], o)).toBe('')
  })

  it('eventLabel maps event types', () => {
    expect(eventLabel({ type: 'plan' })).toBe('Planning')
    expect(eventLabel({ type: 'action', tool: 'content_generate' })).toBe('Running content_generate')
    expect(eventLabel({ type: 'state', state: 'done' })).toBe('Marked done')
    expect(eventLabel({ type: 'end' })).toBe('Finished')
  })

  it('usd formats cents, em-dash on unknown', () => {
    expect(usd(12685)).toBe('$126.85')
    expect(usd(0)).toBe('$0.00')
    expect(usd(null)).toBe('—')
    expect(usd(undefined)).toBe('—')
    expect(usd(NaN)).toBe('—')
  })

  it('automatableSuggestions keeps only AI-ready quests with a step id', () => {
    const got = automatableSuggestions([
      suggestion({ stepId: 'positioning', automatable: true }),
      suggestion({ stepId: 'company', automatable: false }),
      suggestion({ stepId: '', automatable: true }), // no id → dropped
    ])
    expect(got.map((s) => s.stepId)).toEqual(['positioning'])
  })

  it('topSuggestion returns the first (best) or null', () => {
    expect(topSuggestion([suggestion({ stepId: 'a' }), suggestion({ stepId: 'b' })])?.stepId).toBe('a')
    expect(topSuggestion([])).toBeNull()
  })
})
