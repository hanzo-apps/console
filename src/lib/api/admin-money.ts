/**
 * Admin MONEY client — the ONE consolidated financial view. GLOBAL-ADMIN only.
 *
 * Reads `/v1/admin/money` through `originGet` — same-origin, so it terminates at the
 * GLOBAL-ADMIN-GATED `app/admin/aggregate` proxy rather than a split-origin
 * `NEXT_PUBLIC_CLOUD_URL` that could route around the console gate.
 *
 * This replaces reading /revenue, /finance and /grants side by side and adding them up
 * by hand. Cloud folds them server-side from the SAME functions those endpoints use, so
 * a number here cannot disagree with the board it came from.
 *
 * Money is integer USD cents everywhere — never a float, never a formatted string.
 * OPTIONAL-SAFE: every field degrades to an honest 0; nothing is fabricated.
 */
import { originGet } from './client'
import type { SourceStatus } from './admin-subsystems'

export type { SourceStatus } from './admin-subsystems'

/** What customers actually pay us. */
export type MoneyRevenue = {
  realizedCents: number
  mrrCents: number
  arrCents: number
  arpuCents: number
  customers: number
  paying: number
}

/** Granted vs consumed, plus the liability customers still hold. */
export type MoneyCredits = {
  grantedCents: number
  /** Non-cash comps/promos. */
  grantedTrialCents: number
  /** Real money added. */
  grantedPrepaidCents: number
  consumedCents: number
  outstandingCents: number
  grants: number
}

export type MoneyVendor = { name: string; costCents: number }

/** What the platform costs to run. */
export type MoneyInfra = {
  period: string
  vendorCogsCents: number
  doMonthToDateCents: number
  doCreditRemainingCents: number
  doAvgDailyBurnCents: number
  treasuryReserveCents: number
  vendors: MoneyVendor[]
}

export type MoneyMargin = {
  grossCents: number
  grossPct: number
  profitable: boolean
  /** null when burn is zero or the DO source is off — not a zero. */
  runwayDays: number | null
}

/** One customer's whole money position: given, spent, still held. */
export type MoneyOrg = {
  org: string
  display: string
  plan: string
  spendCents: number
  balanceCents: number
  mrrCents: number
  grantedCents: number
  grants: number
}

export type MoneyBoard = {
  revenue: MoneyRevenue
  credits: MoneyCredits
  infrastructure: MoneyInfra
  margin: MoneyMargin
  byOrg: MoneyOrg[]
  generatedAt: string
  sources: SourceStatus[]
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const obj = (v: unknown): Record<string, unknown> => (v ?? {}) as Record<string, unknown>

function normalizeOrg(raw: unknown): MoneyOrg {
  const r = obj(raw)
  return {
    org: str(r.org),
    display: str(r.display) || str(r.org),
    plan: str(r.plan),
    spendCents: num(r.spendCents),
    balanceCents: num(r.balanceCents),
    mrrCents: num(r.mrrCents),
    grantedCents: num(r.grantedCents),
    grants: num(r.grants),
  }
}

function normalizeVendor(raw: unknown): MoneyVendor {
  const r = obj(raw)
  return { name: str(r.name), costCents: num(r.costCents ?? r.cost_cents) }
}

function normalizeSource(raw: unknown): SourceStatus {
  const r = obj(raw)
  return { name: str(r.name), ok: bool(r.ok), rows: num(r.rows), error: str(r.error), at: str(r.at) }
}

function normalizeBoard(raw: unknown): MoneyBoard {
  const r = obj(raw)
  const rev = obj(r.revenue)
  const cr = obj(r.credits)
  const inf = obj(r.infrastructure)
  const mg = obj(r.margin)
  return {
    revenue: {
      realizedCents: num(rev.realizedCents),
      mrrCents: num(rev.mrrCents),
      arrCents: num(rev.arrCents),
      arpuCents: num(rev.arpuCents),
      customers: num(rev.customers),
      paying: num(rev.paying),
    },
    credits: {
      grantedCents: num(cr.grantedCents),
      grantedTrialCents: num(cr.grantedTrialCents),
      grantedPrepaidCents: num(cr.grantedPrepaidCents),
      consumedCents: num(cr.consumedCents),
      outstandingCents: num(cr.outstandingCents),
      grants: num(cr.grants),
    },
    infrastructure: {
      period: str(inf.period),
      vendorCogsCents: num(inf.vendorCogsCents),
      doMonthToDateCents: num(inf.doMonthToDateCents),
      doCreditRemainingCents: num(inf.doCreditRemainingCents),
      doAvgDailyBurnCents: num(inf.doAvgDailyBurnCents),
      treasuryReserveCents: num(inf.treasuryReserveCents),
      vendors: arr(inf.vendors).map(normalizeVendor),
    },
    margin: {
      grossCents: num(mg.grossCents),
      grossPct: num(mg.grossPct),
      profitable: bool(mg.profitable),
      // Distinguish "no runway computable" from "zero days" — null must survive.
      runwayDays: typeof mg.runwayDays === 'number' && Number.isFinite(mg.runwayDays) ? mg.runwayDays : null,
    },
    byOrg: arr(r.byOrg).map(normalizeOrg),
    generatedAt: str(r.generatedAt),
    sources: arr(r.sources).map(normalizeSource),
  }
}

export const AdminMoneyApi = {
  board: async (): Promise<MoneyBoard> => normalizeBoard(await originGet<unknown>('admin/money')),
}
