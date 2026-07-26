import { describe, expect, it } from 'vitest'

import {
  capVerdict,
  centsToDollarInput,
  deriveBudgetsSummary,
  formForAlert,
  isOrgDefault,
  meterColor,
  parseDollarsToCents,
  parseNonNegInt,
  parsePercent,
  scopeLabel,
  scopeTypeOf,
  spendPct,
  validateBudgetForm,
  type BudgetForm,
} from './budgets-logic'
import type { SpendAlert } from '~/lib/api/billing'

const alert = (a: Partial<SpendAlert>): SpendAlert => ({
  id: 'a',
  title: 'Budget',
  thresholdCents: 0,
  currency: 'usd',
  project: '',
  service: '',
  enforce: false,
  softPct: 80,
  rateLimitRpm: 0,
  periodSpentCents: 0,
  over: false,
  warn: false,
  ...a,
})

const form = (f: Partial<BudgetForm>): BudgetForm => ({
  title: '',
  scopeType: 'org',
  scopeId: '',
  cap: '',
  softPct: '80',
  rateLimitRpm: '',
  enforce: false,
  ...f,
})

describe('scope helpers', () => {
  it('scopeTypeOf: service wins, then project, else org', () => {
    expect(scopeTypeOf({ project: '', service: '' })).toBe('org')
    expect(scopeTypeOf({ project: 'acme', service: '' })).toBe('project')
    expect(scopeTypeOf({ project: 'acme', service: 'inference' })).toBe('service')
  })
  it('scopeLabel names each scope', () => {
    expect(scopeLabel('', '')).toBe('Organization default')
    expect(scopeLabel('acme', '')).toBe('Project · acme')
    expect(scopeLabel('', 'inference')).toBe('Service · inference')
    expect(scopeLabel('acme', 'inference')).toBe('acme · inference')
  })
  it('isOrgDefault only when both empty', () => {
    expect(isOrgDefault('', '')).toBe(true)
    expect(isOrgDefault('acme', '')).toBe(false)
  })
})

describe('capVerdict', () => {
  it('unlimited when the cap is 0', () => {
    expect(capVerdict(alert({ thresholdCents: 0, periodSpentCents: 999 }))).toBe('unlimited')
  })
  it('trusts the backend over/warn flags', () => {
    expect(capVerdict(alert({ thresholdCents: 10000, over: true }))).toBe('over')
    expect(capVerdict(alert({ thresholdCents: 10000, warn: true }))).toBe('warn')
  })
  it('falls back to cap + soft threshold when flags are absent', () => {
    expect(capVerdict(alert({ thresholdCents: 10000, periodSpentCents: 10000, softPct: 80 }))).toBe('over')
    expect(capVerdict(alert({ thresholdCents: 10000, softPct: 80, periodSpentCents: 8500 }))).toBe('warn')
    expect(capVerdict(alert({ thresholdCents: 10000, softPct: 80, periodSpentCents: 4000 }))).toBe('ok')
  })
})

describe('spendPct', () => {
  it('null when unlimited, else spent/cap*100 (uncapped)', () => {
    expect(spendPct(alert({ thresholdCents: 0 }))).toBeNull()
    expect(spendPct(alert({ thresholdCents: 10000, periodSpentCents: 2500 }))).toBe(25)
    expect(spendPct(alert({ thresholdCents: 10000, periodSpentCents: 13000 }))).toBe(130)
  })
})

describe('meterColor', () => {
  // The chrome is monochrome, so a verdict is carried by WEIGHT + the label beside it,
  // never by hue — two verdicts may legitimately share a token. What must hold is that
  // every verdict draws from the greyscale ramp, and that over-cap is the loudest.
  it('draws every verdict from the greyscale ramp', () => {
    for (const v of ['ok', 'warn', 'over', 'unlimited'] as const)
      expect(meterColor(v)).toMatch(/^var\(--color(9|10|11|12)\)$/)
  })
  it('emphasises over-cap above every other verdict', () => {
    expect(meterColor('over')).toBe('var(--color12)')
    for (const v of ['ok', 'warn', 'unlimited'] as const) expect(meterColor(v)).not.toBe(meterColor('over'))
  })
})

describe('deriveBudgetsSummary', () => {
  it('counts budgets, warnings, over-cap, enforced, and sums spend', () => {
    expect(deriveBudgetsSummary([])).toEqual({ budgets: 0, warning: 0, over: 0, enforced: 0, totalSpentCents: 0 })
    const s = deriveBudgetsSummary([
      alert({ thresholdCents: 10000, over: true, periodSpentCents: 12000, enforce: true }),
      alert({ thresholdCents: 10000, warn: true, periodSpentCents: 8500 }),
      alert({ thresholdCents: 10000, periodSpentCents: 1000, enforce: true }),
      alert({ thresholdCents: 0, periodSpentCents: 5000 }),
    ])
    expect(s).toEqual({ budgets: 4, warning: 1, over: 1, enforced: 2, totalSpentCents: 26500 })
  })
})

describe('parsing', () => {
  it('parseDollarsToCents strips $/commas, empty=0, rejects negatives/garbage', () => {
    expect(parseDollarsToCents('')).toBe(0)
    expect(parseDollarsToCents('$1,000')).toBe(100000)
    expect(parseDollarsToCents('12.50')).toBe(1250)
    expect(parseDollarsToCents('-5')).toBeNull()
    expect(parseDollarsToCents('abc')).toBeNull()
  })
  it('parseNonNegInt rejects fractional/negative', () => {
    expect(parseNonNegInt('600')).toBe(600)
    expect(parseNonNegInt('1.5')).toBeNull()
    expect(parseNonNegInt('-1')).toBeNull()
  })
  it('parsePercent enforces 0–100', () => {
    expect(parsePercent('80%')).toBe(80)
    expect(parsePercent('101')).toBeNull()
    expect(parsePercent('-1')).toBeNull()
  })
})

describe('validateBudgetForm', () => {
  it('coerces a valid org-wide hard-cap form', () => {
    expect(validateBudgetForm(form({ title: 'Monthly', cap: '500', softPct: '80', rateLimitRpm: '600', enforce: true }))).toEqual({
      ok: true,
      title: 'Monthly',
      project: '',
      service: '',
      thresholdCents: 50000,
      softPct: 80,
      rateLimitRpm: 600,
      enforce: true,
    })
  })
  it('maps scopeType+scopeId to project/service', () => {
    const p = validateBudgetForm(form({ scopeType: 'project', scopeId: 'acme', cap: '10' }))
    expect(p).toMatchObject({ ok: true, project: 'acme', service: '' })
    const s = validateBudgetForm(form({ scopeType: 'service', scopeId: 'inference', cap: '10' }))
    expect(s).toMatchObject({ ok: true, project: '', service: 'inference' })
  })
  it('defaults an empty title to "Budget" and treats empty fields as unlimited/no-limit', () => {
    expect(validateBudgetForm(form({}))).toEqual({
      ok: true,
      title: 'Budget',
      project: '',
      service: '',
      thresholdCents: 0,
      softPct: 80,
      rateLimitRpm: 0,
      enforce: false,
    })
  })
  it('requires a scope id for project/service scope', () => {
    expect(validateBudgetForm(form({ scopeType: 'project', scopeId: '' })).ok).toBe(false)
  })
  it('rejects a hard cap with no cap amount', () => {
    expect(validateBudgetForm(form({ enforce: true, cap: '' })).ok).toBe(false)
  })
  it('reports a human error per bad field', () => {
    expect(validateBudgetForm(form({ cap: '-1' })).ok).toBe(false)
    expect(validateBudgetForm(form({ cap: '5', softPct: '150' })).ok).toBe(false)
    expect(validateBudgetForm(form({ cap: '5', rateLimitRpm: '1.5' })).ok).toBe(false)
  })
})

describe('form round-trip', () => {
  it('pre-fills from an alert (0/default → empty; scopeType derived)', () => {
    expect(centsToDollarInput(0)).toBe('')
    expect(centsToDollarInput(50000)).toBe('500.00')
    expect(
      formForAlert(alert({ title: 'Cap', project: 'acme', thresholdCents: 50000, softPct: 90, rateLimitRpm: 600, enforce: true })),
    ).toEqual({ title: 'Cap', scopeType: 'project', scopeId: 'acme', cap: '500.00', softPct: '90', rateLimitRpm: '600', enforce: true })
    // A pristine alert (no cap, softPct 0, no rate limit) → all optional fields blank.
    expect(formForAlert(alert({ title: '—', softPct: 0 }))).toEqual({
      title: '',
      scopeType: 'org',
      scopeId: '',
      cap: '',
      softPct: '',
      rateLimitRpm: '',
      enforce: false,
    })
  })
})
