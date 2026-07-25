/**
 * Pure, unit-tested helpers for the Budgets & limits page. No React, no I/O — every
 * value is DERIVED from the real spend-alert rows the `/billing` proxy returns, so a
 * budget with no cap reads "Unlimited" (never a fabricated number) and the meter tone
 * follows the backend's own `warn`/`over` verdict.
 */
import type { SpendAlert } from '~/lib/api/billing'
import { toneVar } from '~/components/ui/tone-var'

/** A budget's spend state, in priority order. */
export type CapVerdict = 'unlimited' | 'over' | 'warn' | 'ok'

/** Meter/dot weight — the ONE console tone map, as a CSS value (bar fill + verdict pill). */
export const METER_COLORS: Record<CapVerdict, string> = {
  ok: toneVar('positive'),
  warn: toneVar('warning'),
  over: toneVar('critical'),
  unlimited: toneVar('neutral'),
} as const

export const VERDICT_LABEL: Record<CapVerdict, string> = {
  ok: 'On track',
  warn: 'Warning',
  over: 'Over cap',
  unlimited: 'Unlimited',
} as const

export const meterColor = (v: CapVerdict): string => METER_COLORS[v]

/** The three scope kinds a budget can target. */
export type ScopeType = 'org' | 'project' | 'service'

/** The scope kind of a (project, service) pair (service wins if both are set). */
export const scopeTypeOf = (s: { project: string; service: string }): ScopeType =>
  s.service ? 'service' : s.project ? 'project' : 'org'

/** True iff the budget is the org-wide default (no project AND no service). */
export const isOrgDefault = (project: string, service: string): boolean => project === '' && service === ''

/** Human label for a budget's scope: org default, a project, a service, or both. */
export function scopeLabel(project: string, service: string): string {
  if (isOrgDefault(project, service)) return 'Organization default'
  if (project && service) return `${project} · ${service}`
  if (project) return `Project · ${project}`
  return `Service · ${service}`
}

/**
 * The budget's cap verdict. Trusts the backend `over`/`warn` flags first (they are
 * authoritative), then falls back to computing from the cap + soft threshold so the UI
 * is still honest if a flag is absent. `thresholdCents <= 0` = unlimited (no meter).
 */
export function capVerdict(a: SpendAlert): CapVerdict {
  if (a.thresholdCents <= 0) return 'unlimited'
  if (a.over || a.periodSpentCents >= a.thresholdCents) return 'over'
  if (a.warn || (a.softPct > 0 && a.periodSpentCents >= (a.thresholdCents * a.softPct) / 100)) return 'warn'
  return 'ok'
}

/**
 * Spend as a percent of the cap (0..100+, uncapped so an over-cap budget reads honestly
 * above 100 — the meter bar itself clamps the fill width). `null` when unlimited.
 */
export function spendPct(a: SpendAlert): number | null {
  if (a.thresholdCents <= 0) return null
  return (a.periodSpentCents / a.thresholdCents) * 100
}

/** The at-a-glance summary band numbers, derived from the real rows. */
export type BudgetsSummary = {
  budgets: number
  warning: number
  over: number
  /** How many budgets are HARD caps (enforce=true), vs soft alerts. */
  enforced: number
  /** Total cents spent across all budgets this period. */
  totalSpentCents: number
}

export function deriveBudgetsSummary(alerts: SpendAlert[]): BudgetsSummary {
  let warning = 0
  let over = 0
  let enforced = 0
  let totalSpentCents = 0
  for (const a of alerts) {
    const v = capVerdict(a)
    if (v === 'over') over += 1
    else if (v === 'warn') warning += 1
    if (a.enforce) enforced += 1
    totalSpentCents += a.periodSpentCents
  }
  return { budgets: alerts.length, warning, over, enforced, totalSpentCents }
}

// ── Input parsing / validation (boundary — user input is untrusted) ──────────

/** Parse a dollar string ("12.50", "$1,000") to integer cents; `null` if invalid/negative. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '')
  if (cleaned === '') return 0
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

/** Parse a non-negative integer string; `null` if invalid/negative/fractional. */
export function parseNonNegInt(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '')
  if (cleaned === '') return 0
  const n = Number(cleaned)
  if (!Number.isInteger(n) || n < 0) return null
  return n
}

/** Parse a percent 0–100; `null` if out of range/invalid. */
export function parsePercent(input: string): number | null {
  const cleaned = input.replace(/[%\s]/g, '')
  if (cleaned === '') return 0
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return Math.round(n)
}

/** The raw budget form fields (all strings/bools as edited). */
export type BudgetForm = {
  title: string
  scopeType: ScopeType
  /** The project or service id (used when scopeType !== 'org'). */
  scopeId: string
  cap: string
  softPct: string
  rateLimitRpm: string
  enforce: boolean
}

/** A validated upsert payload or a human error message. */
export type BudgetFormResult =
  | {
      ok: true
      title: string
      project: string
      service: string
      thresholdCents: number
      softPct: number
      rateLimitRpm: number
      enforce: boolean
    }
  | { ok: false; error: string }

/** Validate + coerce the budget form at the boundary. */
export function validateBudgetForm(form: BudgetForm): BudgetFormResult {
  const thresholdCents = parseDollarsToCents(form.cap)
  if (thresholdCents === null) return { ok: false, error: 'Spend cap must be a non-negative dollar amount (0 = unlimited).' }
  const softPct = parsePercent(form.softPct)
  if (softPct === null) return { ok: false, error: 'Soft-warn threshold must be a percentage between 0 and 100.' }
  const rateLimitRpm = parseNonNegInt(form.rateLimitRpm)
  if (rateLimitRpm === null) return { ok: false, error: 'Rate limit must be a non-negative whole number (0 = no limit).' }
  const id = form.scopeId.trim()
  if (form.scopeType !== 'org' && id === '') {
    return { ok: false, error: `Enter the ${form.scopeType} id, or choose Organization-wide.` }
  }
  // A hard cap with no cap amount is meaningless — nothing to enforce.
  if (form.enforce && thresholdCents <= 0) {
    return { ok: false, error: 'A hard cap needs a spend cap greater than $0 to enforce.' }
  }
  return {
    ok: true,
    title: form.title.trim() || 'Budget',
    project: form.scopeType === 'project' ? id : '',
    service: form.scopeType === 'service' ? id : '',
    thresholdCents,
    softPct,
    rateLimitRpm,
    enforce: form.enforce,
  }
}

/** Dollars string ("12.50") from integer cents — for pre-filling the form. */
export const centsToDollarInput = (cents: number): string => (cents > 0 ? (cents / 100).toFixed(2) : '')

/** The form pre-filled from an existing budget (0/unlimited/default → empty field). */
export function formForAlert(a: SpendAlert): BudgetForm {
  return {
    title: a.title === '—' ? '' : a.title,
    scopeType: scopeTypeOf(a),
    scopeId: a.service || a.project || '',
    cap: centsToDollarInput(a.thresholdCents),
    softPct: a.softPct > 0 ? String(a.softPct) : '',
    rateLimitRpm: a.rateLimitRpm > 0 ? String(a.rateLimitRpm) : '',
    enforce: a.enforce,
  }
}
