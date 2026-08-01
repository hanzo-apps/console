/**
 * Cap-table API — the per-org capitalization ledger over the REAL cloud
 * `/v1/captable` surface (cloud `clients/captable`, HIP-0106: the Captable,Inc
 * business logic ported to a goja bundle, given per-tenant Base/SQLite persistence).
 * Stakeholders · share classes · equity plans · issued shares (+ transfer) · options
 * · SAFEs · convertible notes · rounds + investments, and the computed cap-table
 * `summary`.
 *
 * Every call is same-origin, keyless and prefix-free (`cloudProxyV1Url('captable/…')`
 * → `<origin>/v1/captable/…`, the /v1-first form). The console's `app/v1` user-bearer
 * BFF mints a short-lived IAM token from the session and forwards it; the backend
 * resolves the org from the token's `owner` claim (which selects the tenant DB file
 * AND scopes every row), so the whole cap table is org-scoped SERVER-SIDE and no
 * credential reaches the browser. A cookie-only call 403s. `captable` is allow-listed
 * in `proxy-allow.ts` CLOUD_HEADS.
 *
 * Transport is PLAIN REST (raw JSON, real HTTP status) — the goja bundle's contract.
 * The list shapes are INCONSISTENT by design (stakeholders + classes return a
 * BARE array; shares/options/safes/convertibles/rounds/investments wrap in `{ data }`),
 * so the ONE `rows()` unwrapper tolerates both. The cap-table MATH lives in the backend
 * bundle (`captable.ts`); this client mirrors the wire shapes + derives ONLY the
 * presentation (donut slices, tiles) — it never recomputes ownership.
 */
import { restGet, restPost, restPut, restDelete, cloudProxyV1Url } from './client'

// ── Pure helpers (local; honest defaults, never throw) ───────────────────────
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Unwrap a list response: a BARE array, or a `{ data | items | rows }` envelope. */
export const rows = (payload: unknown): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  const p = asRecord(payload)
  for (const k of ['data', 'items', 'rows']) {
    const v = p[k]
    if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  }
  return []
}

// ── Vocabularies (verbatim from the bundle's validate.ts) ────────────────────

export const STAKEHOLDER_TYPES = ['INDIVIDUAL', 'INSTITUTION'] as const
export const STAKEHOLDER_RELATIONSHIPS = [
  'FOUNDER', 'INVESTOR', 'EMPLOYEE', 'EXECUTIVE', 'OFFICER', 'BOARD_MEMBER',
  'ADVISOR', 'CONSULTANT', 'EX_EMPLOYEE', 'EX_ADVISOR', 'EX_CONSULTANT', 'NON_US_EMPLOYEE', 'OTHER',
] as const
export const SHARE_CLASS_TYPES = ['COMMON', 'PREFERRED'] as const
export const CONVERSION_RIGHTS = ['CONVERTS_TO_FUTURE_ROUND', 'CONVERTS_TO_SHARE_CLASS_ID'] as const
export const SECURITIES_STATUS = ['ACTIVE', 'DRAFT', 'SIGNED', 'PENDING'] as const
export const OPTION_TYPES = ['ISO', 'NSO', 'RSU'] as const
export const OPTION_STATUS = ['DRAFT', 'ACTIVE', 'EXERCISED', 'EXPIRED', 'CANCELLED'] as const
export const SAFE_TYPES = ['POST_MONEY', 'PRE_MONEY'] as const
export const SAFE_STATUS = ['DRAFT', 'ACTIVE', 'PENDING', 'EXPIRED', 'CANCELLED'] as const
export const CONVERTIBLE_TYPES = ['NOTE', 'CCD', 'OCD'] as const
export const CONVERTIBLE_STATUS = ['DRAFT', 'ACTIVE', 'PENDING', 'EXPIRED', 'CANCELLED'] as const
export const ROUND_TYPES = ['PRICED', 'SAFE', 'CONVERTIBLE'] as const
export const CANCELLATION_BEHAVIOR = ['RETIRE', 'RETURN_TO_POOL', 'HOLD_AS_CAPITAL_STOCK', 'DEFINED_PER_PLAN_SECURITY'] as const

/** ENUM_TOKEN → a readable label (POST_MONEY → "Post money"). */
export const enumLabel = (v: string): string =>
  v ? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ') : '—'

// ── Format helpers (pure) ────────────────────────────────────────────────────

/** Whole-number count with thousands separators (share quantities). */
export const int = (n: number): string => Math.round(n).toLocaleString('en-US')
/** A USD money amount (cap-table amounts are dollar floats, NOT cents). */
export const usd = (n: number): string =>
  `$${(Number.isFinite(n) ? n : 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
/** An ownership percentage (already a percent number from the backend). */
export const pct = (n: number): string => `${(Number.isFinite(n) ? n : 0).toFixed(2)}%`
/** Today as an ISO date (YYYY-MM-DD) — the default for a form's required date. */
export const today = (): string => new Date().toISOString().slice(0, 10)

// ── Contract (mirrors the bundle route SELECT aliases) ───────────────────────

export interface Company {
  id: string
  name: string
  publicId: string
  incorporationType: string
  incorporationCountry: string
  incorporationState: string
}

export interface Stakeholder {
  id: string
  name: string
  email: string
  institutionName: string
  stakeholderType: string
  currentRelationship: string
  country: string
  createdAt: number
}

export interface ShareClass {
  id: string
  idx: number
  name: string
  classType: string
  prefix: string
  initialSharesAuthorized: number
  votesPerShare: number
  parValue: number
  pricePerShare: number
  seniority: number
  conversionRights: string
  liquidationPreferenceMultiple: number
  participationCapMultiple: number
}

export interface EquityPlan {
  id: string
  name: string
  initialSharesReserved: number
  shareClassId: string
  boardApprovalDate: string
  createdAt: number
}

export interface Share {
  id: string
  certificateId: string
  quantity: number
  pricePerShare: number
  capitalContribution: number
  status: string
  issueDate: string
  stakeholderName: string
  stakeholderId: string
  shareClassName: string
  shareClassType: string
  shareClassId: string
}

export interface OptionGrant {
  id: string
  grantId: string
  quantity: number
  exercisePrice: number
  type: string
  status: string
  issueDate: string
  stakeholderName: string
  stakeholderId: string
  equityPlanName: string
  equityPlanId: string
}

export interface Safe {
  id: string
  publicId: string
  type: string
  status: string
  capital: number
  valuationCap: number
  discountRate: number
  mfn: boolean
  proRata: boolean
  issueDate: string
  stakeholderName: string
  stakeholderId: string
}

export interface Convertible {
  id: string
  publicId: string
  type: string
  status: string
  capital: number
  conversionCap: number
  discountRate: number
  interestRate: number
  issueDate: string
  stakeholderName: string
  stakeholderId: string
}

export interface Round {
  id: string
  name: string
  roundType: string
  status: string
  targetAmount: number
  raisedAmount: number
  preMoneyValuation: number
  pricePerShare: number
  shareClassId: string
  closeDate: string
  createdAt: number
}

export interface Investment {
  id: string
  roundId: string
  amount: number
  shares: number
  date: string
  stakeholderName: string
  stakeholderId: string
}

/** The computed cap table (GET /captable/summary). */
export interface CapTableSummary {
  company: { id: string; name: string }
  totals: {
    outstandingShares: number
    grantedOptions: number
    fullyDilutedShares: number
    stakeholders: number
    shareClasses: number
  }
  byStakeholder: {
    stakeholderId: string
    name: string
    shares: number
    options: number
    fullyDiluted: number
    ownershipPct: number
  }[]
  byShareClass: { shareClassId: string; name: string; classType: string; authorized: number; issued: number }[]
  convertibles: { safes: { count: number; capital: number }; notes: { count: number; capital: number } }
  rounds: { count: number; totalRaised: number }
}

// ── Normalizers (pure; defensive) ────────────────────────────────────────────

const normStakeholder = (r: Record<string, unknown>): Stakeholder => ({
  id: str(r.id),
  name: str(r.name),
  email: str(r.email),
  institutionName: str(r.institutionName ?? r.institution_name),
  stakeholderType: str(r.stakeholderType ?? r.stakeholder_type) || 'INDIVIDUAL',
  currentRelationship: str(r.currentRelationship ?? r.current_relationship),
  country: str(r.country) || 'US',
  createdAt: num(r.createdAt ?? r.created_at),
})

const normShareClass = (r: Record<string, unknown>): ShareClass => ({
  id: str(r.id),
  idx: num(r.idx),
  name: str(r.name),
  classType: str(r.classType ?? r.class_type) || 'COMMON',
  prefix: str(r.prefix),
  initialSharesAuthorized: num(r.initialSharesAuthorized ?? r.initial_shares_authorized),
  votesPerShare: num(r.votesPerShare ?? r.votes_per_share),
  parValue: num(r.parValue ?? r.par_value),
  pricePerShare: num(r.pricePerShare ?? r.price_per_share),
  seniority: num(r.seniority),
  conversionRights: str(r.conversionRights ?? r.conversion_rights),
  liquidationPreferenceMultiple: num(r.liquidationPreferenceMultiple ?? r.liquidation_preference_multiple),
  participationCapMultiple: num(r.participationCapMultiple ?? r.participation_cap_multiple),
})

const normEquityPlan = (r: Record<string, unknown>): EquityPlan => ({
  id: str(r.id),
  name: str(r.name),
  initialSharesReserved: num(r.initialSharesReserved ?? r.initial_shares_reserved),
  shareClassId: str(r.shareClassId ?? r.share_class_id),
  boardApprovalDate: str(r.boardApprovalDate ?? r.board_approval_date),
  createdAt: num(r.createdAt ?? r.created_at),
})

const normShare = (r: Record<string, unknown>): Share => ({
  id: str(r.id),
  certificateId: str(r.certificateId ?? r.certificate_id),
  quantity: num(r.quantity),
  pricePerShare: num(r.pricePerShare ?? r.price_per_share),
  capitalContribution: num(r.capitalContribution ?? r.capital_contribution),
  status: str(r.status) || 'DRAFT',
  issueDate: str(r.issueDate ?? r.issue_date),
  stakeholderName: str(r.stakeholderName ?? r.stakeholder_name),
  stakeholderId: str(r.stakeholderId ?? r.stakeholder_id),
  shareClassName: str(r.shareClassName ?? r.share_class_name),
  shareClassType: str(r.shareClassType ?? r.share_class_type),
  shareClassId: str(r.shareClassId ?? r.share_class_id),
})

const normOption = (r: Record<string, unknown>): OptionGrant => ({
  id: str(r.id),
  grantId: str(r.grantId ?? r.grant_id),
  quantity: num(r.quantity),
  exercisePrice: num(r.exercisePrice ?? r.exercise_price),
  type: str(r.type) || 'ISO',
  status: str(r.status) || 'DRAFT',
  issueDate: str(r.issueDate ?? r.issue_date),
  stakeholderName: str(r.stakeholderName ?? r.stakeholder_name),
  stakeholderId: str(r.stakeholderId ?? r.stakeholder_id),
  equityPlanName: str(r.equityPlanName ?? r.equity_plan_name),
  equityPlanId: str(r.equityPlanId ?? r.equity_plan_id),
})

const normSafe = (r: Record<string, unknown>): Safe => ({
  id: str(r.id),
  publicId: str(r.publicId ?? r.public_id),
  type: str(r.type) || 'POST_MONEY',
  status: str(r.status) || 'DRAFT',
  capital: num(r.capital),
  valuationCap: num(r.valuationCap ?? r.valuation_cap),
  discountRate: num(r.discountRate ?? r.discount_rate),
  mfn: bool(r.mfn),
  proRata: bool(r.proRata ?? r.pro_rata),
  issueDate: str(r.issueDate ?? r.issue_date),
  stakeholderName: str(r.stakeholderName ?? r.stakeholder_name),
  stakeholderId: str(r.stakeholderId ?? r.stakeholder_id),
})

const normConvertible = (r: Record<string, unknown>): Convertible => ({
  id: str(r.id),
  publicId: str(r.publicId ?? r.public_id),
  type: str(r.type) || 'NOTE',
  status: str(r.status) || 'DRAFT',
  capital: num(r.capital),
  conversionCap: num(r.conversionCap ?? r.conversion_cap),
  discountRate: num(r.discountRate ?? r.discount_rate),
  interestRate: num(r.interestRate ?? r.interest_rate),
  issueDate: str(r.issueDate ?? r.issue_date),
  stakeholderName: str(r.stakeholderName ?? r.stakeholder_name),
  stakeholderId: str(r.stakeholderId ?? r.stakeholder_id),
})

const normRound = (r: Record<string, unknown>): Round => ({
  id: str(r.id),
  name: str(r.name),
  roundType: str(r.roundType ?? r.round_type) || 'PRICED',
  status: str(r.status) || 'OPEN',
  targetAmount: num(r.targetAmount ?? r.target_amount),
  raisedAmount: num(r.raisedAmount ?? r.raised_amount),
  preMoneyValuation: num(r.preMoneyValuation ?? r.pre_money_valuation),
  pricePerShare: num(r.pricePerShare ?? r.price_per_share),
  shareClassId: str(r.shareClassId ?? r.share_class_id),
  closeDate: str(r.closeDate ?? r.close_date),
  createdAt: num(r.createdAt ?? r.created_at),
})

const normInvestment = (r: Record<string, unknown>): Investment => ({
  id: str(r.id),
  roundId: str(r.roundId ?? r.round_id),
  amount: num(r.amount),
  shares: num(r.shares),
  date: str(r.date),
  stakeholderName: str(r.stakeholderName ?? r.stakeholder_name),
  stakeholderId: str(r.stakeholderId ?? r.stakeholder_id),
})

export function normalizeSummary(payload: unknown): CapTableSummary {
  const p = asRecord(payload)
  const totals = asRecord(p.totals)
  const conv = asRecord(p.convertibles)
  const safes = asRecord(conv.safes)
  const notes = asRecord(conv.notes)
  const rnd = asRecord(p.rounds)
  const company = asRecord(p.company)
  return {
    company: { id: str(company.id), name: str(company.name) },
    totals: {
      outstandingShares: num(totals.outstandingShares),
      grantedOptions: num(totals.grantedOptions),
      fullyDilutedShares: num(totals.fullyDilutedShares),
      stakeholders: num(totals.stakeholders),
      shareClasses: num(totals.shareClasses),
    },
    byStakeholder: (Array.isArray(p.byStakeholder) ? p.byStakeholder : []).map((raw) => {
      const r = asRecord(raw)
      return {
        stakeholderId: str(r.stakeholderId),
        name: str(r.name),
        shares: num(r.shares),
        options: num(r.options),
        fullyDiluted: num(r.fullyDiluted),
        ownershipPct: num(r.ownershipPct),
      }
    }),
    byShareClass: (Array.isArray(p.byShareClass) ? p.byShareClass : []).map((raw) => {
      const r = asRecord(raw)
      return {
        shareClassId: str(r.shareClassId),
        name: str(r.name),
        classType: str(r.classType),
        authorized: num(r.authorized),
        issued: num(r.issued),
      }
    }),
    convertibles: {
      safes: { count: num(safes.count), capital: num(safes.capital) },
      notes: { count: num(notes.count), capital: num(notes.capital) },
    },
    rounds: { count: num(rnd.count), totalRaised: num(rnd.totalRaised) },
  }
}

// ── Presentation derivation (pure; unit-tested) ──────────────────────────────

/** Ownership pie slices from the summary, largest first (fully-diluted basis). */
export function ownershipSlices(summary: CapTableSummary): { label: string; value: number }[] {
  return summary.byStakeholder
    .filter((s) => s.fullyDiluted > 0)
    .map((s) => ({ label: s.name || 'Unnamed', value: s.fullyDiluted }))
    .sort((a, b) => b.value - a.value)
}

/** Total convertible capital raised (SAFEs + notes) — sits outside issued equity. */
export const convertibleCapital = (summary: CapTableSummary): number =>
  summary.convertibles.safes.capital + summary.convertibles.notes.capital

// ── Form validators (pure; mirror the bundle write boundary) ─────────────────

export interface StakeholderInput {
  name: string
  email: string
  stakeholderType: string
  currentRelationship: string
  institutionName?: string
}
export function validateStakeholder(v: StakeholderInput): string | null {
  if (v.name.trim() === '') return 'Name is required.'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim())) return 'A valid email is required.'
  if (!STAKEHOLDER_TYPES.includes(v.stakeholderType as (typeof STAKEHOLDER_TYPES)[number])) return 'Choose a stakeholder type.'
  if (!STAKEHOLDER_RELATIONSHIPS.includes(v.currentRelationship as (typeof STAKEHOLDER_RELATIONSHIPS)[number]))
    return 'Choose a relationship.'
  return null
}

export interface ShareInput {
  stakeholderId: string
  shareClassId: string
  certificateId: string
  quantity: number
  status: string
}
export function validateShareForm(v: ShareInput): string | null {
  if (!v.stakeholderId) return 'Choose a stakeholder.'
  if (!v.shareClassId) return 'Choose a share class.'
  if (v.certificateId.trim() === '') return 'A unique certificate id is required.'
  if (!Number.isInteger(v.quantity) || v.quantity <= 0) return 'Quantity must be a whole number greater than 0.'
  return null
}

export interface ShareClassInput {
  name: string
  classType: string
  initialSharesAuthorized: number
  pricePerShare: number
  parValue: number
  votesPerShare: number
}
export function validateShareClassForm(v: ShareClassInput): string | null {
  if (v.name.trim() === '') return 'A class name is required.'
  if (!SHARE_CLASS_TYPES.includes(v.classType as (typeof SHARE_CLASS_TYPES)[number])) return 'Choose a class type.'
  if (!Number.isInteger(v.initialSharesAuthorized) || v.initialSharesAuthorized < 1)
    return 'Authorized shares must be a whole number of at least 1.'
  return null
}

export interface SafeInput {
  publicId: string
  stakeholderId: string
  capital: number
  type: string
  status: string
}
export function validateSafeForm(v: SafeInput): string | null {
  if (v.publicId.trim() === '') return 'A unique SAFE id is required.'
  if (!v.stakeholderId) return 'Choose a stakeholder.'
  if (!(v.capital > 0)) return 'Capital must be greater than 0.'
  return null
}

export interface RoundInput {
  name: string
  roundType: string
  targetAmount: number
  shareClassId?: string
  pricePerShare?: number
  preMoneyValuation?: number
}
export function validateRoundForm(v: RoundInput): string | null {
  if (v.name.trim() === '') return 'A round name is required.'
  if (!ROUND_TYPES.includes(v.roundType as (typeof ROUND_TYPES)[number])) return 'Choose a round type.'
  if (v.roundType === 'PRICED') {
    if (!v.shareClassId) return 'A priced round needs a share class.'
    if (!(Number(v.pricePerShare) > 0)) return 'A priced round needs a price per share greater than 0.'
  }
  return null
}

// ── Network methods (thin — one per captable route) ──────────────────────────

const enc = (s: string): string => encodeURIComponent(s)
const url = (seg: string): string => cloudProxyV1Url(`captable/${seg}`)

export const CapTableApi = {
  company: {
    get: (): Promise<Company> =>
      restGet<unknown>(url('company')).then((p) => {
        const r = asRecord(p)
        return {
          id: str(r.id),
          name: str(r.name),
          publicId: str(r.publicId ?? r.public_id),
          incorporationType: str(r.incorporationType ?? r.incorporation_type),
          incorporationCountry: str(r.incorporationCountry ?? r.incorporation_country),
          incorporationState: str(r.incorporationState ?? r.incorporation_state),
        }
      }),
    update: (body: { name: string; incorporationType?: string; incorporationCountry?: string; incorporationState?: string }): Promise<void> =>
      restPut<unknown>(url('company'), body).then(() => undefined),
  },
  stakeholders: {
    list: (): Promise<Stakeholder[]> => restGet<unknown>(url('stakeholders')).then((p) => rows(p).map(normStakeholder)),
    add: (body: StakeholderInput): Promise<void> => restPost<unknown>(url('stakeholders'), body).then(() => undefined),
    remove: (id: string): Promise<void> => restDelete(url(`stakeholders/${enc(id)}`)),
  },
  shareClasses: {
    list: (): Promise<ShareClass[]> => restGet<unknown>(url('classes')).then((p) => rows(p).map(normShareClass)),
    create: (body: Record<string, unknown>): Promise<void> => restPost<unknown>(url('classes'), body).then(() => undefined),
  },
  equityPlans: {
    list: (): Promise<EquityPlan[]> => restGet<unknown>(url('plans')).then((p) => rows(p).map(normEquityPlan)),
    create: (body: Record<string, unknown>): Promise<void> => restPost<unknown>(url('plans'), body).then(() => undefined),
  },
  shares: {
    list: (): Promise<Share[]> => restGet<unknown>(url('shares')).then((p) => rows(p).map(normShare)),
    add: (body: Record<string, unknown>): Promise<void> => restPost<unknown>(url('shares'), body).then(() => undefined),
    transfer: (body: { shareId: string; toStakeholderId: string; quantity?: number; certificateId?: string }): Promise<void> =>
      restPost<unknown>(url('shares/transfer'), body).then(() => undefined),
    remove: (id: string): Promise<void> => restDelete(url(`shares/${enc(id)}`)),
  },
  options: {
    list: (): Promise<OptionGrant[]> => restGet<unknown>(url('options')).then((p) => rows(p).map(normOption)),
    add: (body: Record<string, unknown>): Promise<void> => restPost<unknown>(url('options'), body).then(() => undefined),
    remove: (id: string): Promise<void> => restDelete(url(`options/${enc(id)}`)),
  },
  safes: {
    list: (): Promise<Safe[]> => restGet<unknown>(url('safes')).then((p) => rows(p).map(normSafe)),
    create: (body: Record<string, unknown>): Promise<void> => restPost<unknown>(url('safes'), body).then(() => undefined),
    remove: (id: string): Promise<void> => restDelete(url(`safes/${enc(id)}`)),
  },
  convertibles: {
    list: (): Promise<Convertible[]> => restGet<unknown>(url('convertibles')).then((p) => rows(p).map(normConvertible)),
    create: (body: Record<string, unknown>): Promise<void> => restPost<unknown>(url('convertibles'), body).then(() => undefined),
    remove: (id: string): Promise<void> => restDelete(url(`convertibles/${enc(id)}`)),
  },
  rounds: {
    list: (): Promise<Round[]> => restGet<unknown>(url('rounds')).then((p) => rows(p).map(normRound)),
    create: (body: RoundInput): Promise<void> => restPost<unknown>(url('rounds'), body).then(() => undefined),
    close: (id: string): Promise<void> => restPost<unknown>(url(`rounds/${enc(id)}/close`), {}).then(() => undefined),
    addInvestment: (id: string, body: { stakeholderId: string; amount: number; date?: string; comments?: string }): Promise<void> =>
      restPost<unknown>(url(`rounds/${enc(id)}/investments`), body).then(() => undefined),
  },
  investments: {
    list: (): Promise<Investment[]> => restGet<unknown>(url('investments')).then((p) => rows(p).map(normInvestment)),
  },
  summary: (): Promise<CapTableSummary> => restGet<unknown>(url('summary')).then(normalizeSummary),
}
