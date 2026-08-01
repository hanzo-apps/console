/**
 * Admin SPEND-CAPS client — SuperAdmin oversight + override of ANY org's usage caps
 * (the same spend-alert / budget primitive a tenant manages under Billing → Budgets,
 * but cross-tenant). GLOBAL-ADMIN only.
 *
 * Reads/writes the cloud `/v1/admin/caps` surface (casibase `{status,msg,data}`
 * envelope) through `originGet`/`originPost`/`originPatch`/`originDelete` — same-origin,
 * so they terminate at the GLOBAL-ADMIN-GATED `app/admin/aggregate` proxy (`getAdminGate`,
 * fail-closed 403, then a minted user bearer + same-origin CSRF). The target org travels
 * as `?org=<slug>` on every call (the SuperAdmin picks WHICH org to oversee); the backend
 * re-authorizes it. The browser holds no admin credential.
 *
 * The row IS the tenant `SpendAlert` (money is USD cents end-to-end — `threshold` /
 * `periodSpentCents`) PLUS the admin-oversight fields the operator needs: `userId` (who
 * owns the cap), `period` (`YYYY-MM`), `resetsAt` (when the meter resets), `updatedAt`.
 * So `budgets-logic.ts` (capVerdict / spendPct / scopeLabel / formForAlert /
 * validateBudgetForm) applies UNCHANGED — one caps model, no fork. OPTIONAL-SAFE
 * normalizer: a missing/renamed field degrades to a real default, never throws.
 */
import { originGet, originPost, originPatch, originDelete } from './client'
import type { SpendAlert } from './billing'

/** A tenant spend cap as seen by the operator — the `SpendAlert` + oversight fields. */
export type AdminCap = SpendAlert & {
  /** The IAM user (`<owner>/<name>`) the cap belongs to, if the backend reports it. */
  userId: string
  /** The billing period the meter covers, `YYYY-MM`. */
  period: string
  /** RFC3339 time the period meter resets (empty when not reported). */
  resetsAt: string
  /** RFC3339 last-updated time (empty when not reported). */
  updatedAt: string
}

/** The create/edit payload (dollars are already cents; the wire field is `threshold`). */
export type CapInput = {
  title: string
  thresholdCents: number
  currency?: string
  project: string
  service: string
  enforce: boolean
  softPct: number
  rateLimitRpm: number
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1

/** Roll one backend spend-cap row into the display `AdminCap`; snake_case tolerant. */
export function normalizeAdminCap(raw: unknown): AdminCap {
  const r = asRecord(raw)
  return {
    id: str(r.id) || str(r.alertId),
    userId: str(r.userId) || str(r.user_id),
    title: str(r.title) || '—',
    thresholdCents: Math.round(num(r.threshold) ?? num(r.thresholdCents) ?? 0),
    currency: (str(r.currency) || 'usd').toLowerCase(),
    project: str(r.project),
    service: str(r.service),
    enforce: bool(r.enforce),
    softPct: Math.round(num(r.softPct) ?? num(r.soft_pct) ?? 80),
    rateLimitRpm: Math.round(num(r.rateLimitRpm) ?? num(r.rate_limit_rpm) ?? num(r.rpm) ?? 0),
    periodSpentCents: Math.round(num(r.periodSpentCents) ?? num(r.period_spent_cents) ?? 0),
    over: bool(r.over),
    warn: bool(r.warn),
    period: str(r.period),
    resetsAt: str(r.resetsAt) || str(r.resets_at),
    triggeredAt: (str(r.triggeredAt) || str(r.triggered_at)) || undefined,
    createdAt: (str(r.createdAt) || str(r.created_at)) || undefined,
    updatedAt: str(r.updatedAt) || str(r.updated_at),
  }
}

/** Build the wire body from the (partial) input — omits absent keys so PATCH is partial. */
function capBody(input: Partial<CapInput>): Record<string, unknown> {
  const b: Record<string, unknown> = {}
  if (input.title !== undefined) b.title = input.title
  if (input.thresholdCents !== undefined) b.threshold = Math.round(input.thresholdCents)
  if (input.currency !== undefined) b.currency = input.currency.toLowerCase()
  if (input.project !== undefined) b.project = input.project
  if (input.service !== undefined) b.service = input.service
  if (input.enforce !== undefined) b.enforce = input.enforce
  if (input.softPct !== undefined) b.softPct = input.softPct
  if (input.rateLimitRpm !== undefined) b.rateLimitRpm = input.rateLimitRpm
  return b
}

export const AdminCapsApi = {
  /** Every spend cap for `org` (`GET /v1/admin/caps?org=<slug>`); honest empty on none. */
  list: async (org: string): Promise<AdminCap[]> =>
    arr(await originGet<unknown>('admin/caps', { org })).map(normalizeAdminCap),

  /** Create a cap for `org` (`POST /v1/admin/caps?org=<slug>`). */
  create: async (org: string, input: CapInput): Promise<AdminCap> =>
    normalizeAdminCap(await originPost<unknown>('admin/caps', capBody(input), { org })),

  /** Edit a cap (`PATCH /v1/admin/caps/:id?org=<slug>`); a partial of the fields. */
  update: async (org: string, id: string, patch: Partial<CapInput>): Promise<AdminCap> =>
    normalizeAdminCap(await originPatch<unknown>(`admin/caps/${encodeURIComponent(id)}`, capBody(patch), { org })),

  /** Remove a cap (`DELETE /v1/admin/caps/:id?org=<slug>`). */
  remove: (org: string, id: string): Promise<void> =>
    originDelete(`admin/caps/${encodeURIComponent(id)}`, { org }),
}
