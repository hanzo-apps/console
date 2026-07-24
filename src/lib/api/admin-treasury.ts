/**
 * Admin treasury — the GLOBAL-ADMIN operator view of the Hanzo platform RESERVE
 * FUND over cloud-api's `GET /v1/admin/treasury` + the `policy`/`sweep`/`seed`/
 * `anchor` mutations (cloud `clients/treasury`). The fund holds a revenue-share of
 * platform spend and BACKS the growth-loop payouts (referral / affiliate / author);
 * every movement is a double-entry journal line whose Merkle root is anchored on the
 * Hanzo L1. Reads/writes go through `originGet`/`originPost` — the console's OWN
 * origin (`<origin>/v1/admin/treasury…`), which `next.config.mjs` rewrites to the
 * GLOBAL-ADMIN-GATED `app/admin/aggregate` proxy (`getAdminGate`, fail-closed 403,
 * THEN a minted user bearer + same-origin CSRF check). The browser holds no admin
 * credential.
 *
 * OPTIONAL-SAFE: every field degrades to a real `0`/`''`/`[]`/`false`, so an
 * un-routed deployment renders honest empties, NEVER a fabricated ledger or a faked
 * "anchored" state. Money is USD cents; `revenueShareBps` is basis points (2000 = 20%).
 */
import { originGet, originPost } from './client'

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const int = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Math.trunc(Number(v))
  return 0
}
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const arrayUnder = (payload: unknown, keys: string[]): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  if (payload && typeof payload === 'object') {
    for (const k of keys) {
      const v = (payload as Record<string, unknown>)[k]
      if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
    }
  }
  return []
}

/** One leg of a double-entry journal line — a signed cents delta on an account (∑==0). */
export type Posting = {
  account: string
  amount: number
}

/** A journal entry: an accrual (revenue-share in), a payout (backed cash out), or a seed. */
export type JournalEntry = {
  id: string
  kind: string // 'accrual' | 'payout' | 'seed'
  program: string // 'referral' | 'affiliate' | 'author' | ''
  ref: string
  memo: string
  amountCents: number
  createdAt: number
  postings: Posting[]
}

/** Backed-payout totals per growth-loop program (real 0 when a program has paid nothing). */
export type ByProgramCents = {
  referral: number
  affiliate: number
  author: number
}

/** The revenue-share policy — the fraction of platform spend swept into the fund. */
export type TreasuryPolicy = {
  revenueShareBps: number
  updatedAt: number
}

/** The reserve-fund report: balances, lifetime flows, policy, and solvency. */
export type TreasuryReport = {
  reserveCents: number
  accruedCents: number
  paidCents: number
  byProgramCents: ByProgramCents
  policy: TreasuryPolicy
  solventForPayout: boolean
}

/** The Hanzo L1 anchor status for the journal's current Merkle root. */
export type AnchorStatus = {
  chainId: number
  rpcConfigured: boolean
  signerConfigured: boolean
  contract: string
  currentRoot: string
  entryCount: number
  status: string // 'pending' | 'anchored' | 'error'
  note: string
  lastRoot: string
  lastTxHash: string
  lastBlock: number
  lastAt: number
  synced: boolean
}

/** The whole treasury view — report + recent journal + anchor status. */
export type TreasuryView = {
  report: TreasuryReport
  journal: JournalEntry[]
  anchor: AnchorStatus
}

/** Result of a revenue-share sweep for a period. */
export type SweepResult = {
  period: string
  revenueCents: number
  accruedCents: number
  created: boolean
  reserveCents: number
}

/** Result of seeding the reserve fund. */
export type SeedResult = {
  entry: JournalEntry
  created: boolean
  reserveCents: number
}

function normalizePosting(v: unknown): Posting {
  const r = asRecord(v)
  return { account: str(r.account), amount: int(r.amount) }
}

export function normalizeJournalEntry(v: unknown): JournalEntry {
  const r = asRecord(v)
  return {
    id: str(r.id),
    kind: str(r.kind),
    program: str(r.program),
    ref: str(r.ref),
    memo: str(r.memo),
    amountCents: int(r.amountCents),
    createdAt: int(r.createdAt),
    postings: arrayUnder(r.postings, ['postings']).map(normalizePosting),
  }
}

function normalizeByProgram(v: unknown): ByProgramCents {
  const r = asRecord(v)
  return { referral: int(r.referral), affiliate: int(r.affiliate), author: int(r.author) }
}

export function normalizePolicy(v: unknown): TreasuryPolicy {
  const r = asRecord(v)
  return { revenueShareBps: int(r.revenueShareBps), updatedAt: int(r.updatedAt) }
}

function normalizeReport(v: unknown): TreasuryReport {
  const r = asRecord(v)
  return {
    reserveCents: int(r.reserveCents),
    accruedCents: int(r.accruedCents),
    paidCents: int(r.paidCents),
    byProgramCents: normalizeByProgram(r.byProgramCents),
    policy: normalizePolicy(r.policy),
    solventForPayout: bool(r.solventForPayout),
  }
}

export function normalizeAnchor(v: unknown): AnchorStatus {
  const r = asRecord(v)
  return {
    chainId: int(r.chainId),
    rpcConfigured: bool(r.rpcConfigured),
    signerConfigured: bool(r.signerConfigured),
    contract: str(r.contract),
    currentRoot: str(r.currentRoot),
    entryCount: int(r.entryCount),
    status: str(r.status) || 'pending',
    note: str(r.note),
    lastRoot: str(r.lastRoot),
    lastTxHash: str(r.lastTxHash),
    lastBlock: int(r.lastBlock),
    lastAt: int(r.lastAt),
    synced: bool(r.synced),
  }
}

/** OPTIONAL-SAFE view normalizer — every field degrades to an honest empty. */
export function normalizeTreasury(payload: unknown): TreasuryView {
  const r = asRecord(payload)
  return {
    report: normalizeReport(r.report),
    journal: arrayUnder(r.journal, ['journal', 'entries', 'data']).map(normalizeJournalEntry).filter((e) => e.id),
    anchor: normalizeAnchor(r.anchor),
  }
}

export const AdminTreasuryApi = {
  /** GET /v1/admin/treasury — the reserve-fund report + recent journal + L1 anchor. */
  get: async (): Promise<TreasuryView> => {
    const data = await originGet<unknown>('admin/treasury')
    return normalizeTreasury(data)
  },
  /** POST /v1/admin/treasury/policy — set the revenue-share (basis points). */
  setPolicy: async (revenueShareBps: number): Promise<TreasuryPolicy> => {
    const data = await originPost<unknown>('admin/treasury/policy', { revenueShareBps })
    return normalizePolicy(asRecord(data).policy)
  },
  /** POST /v1/admin/treasury/sweep — accrue the revenue-share for a period (defaults current month). */
  sweep: async (revenueCents: number, period?: string): Promise<SweepResult> => {
    const body: Record<string, unknown> = { revenueCents }
    if (period && period.trim()) body.period = period.trim()
    const data = await originPost<unknown>('admin/treasury/sweep', body)
    const r = asRecord(data)
    return {
      period: str(r.period),
      revenueCents: int(r.revenueCents),
      accruedCents: int(r.accruedCents),
      created: bool(r.created),
      reserveCents: int(r.reserveCents),
    }
  },
  /** POST /v1/admin/treasury/seed — add funds to the reserve (a seed journal entry). */
  seed: async (amountCents: number, memo?: string): Promise<SeedResult> => {
    const data = await originPost<unknown>('admin/treasury/seed', { amountCents, memo: memo ?? '' })
    const r = asRecord(data)
    return {
      entry: normalizeJournalEntry(r.entry),
      created: bool(r.created),
      reserveCents: int(r.reserveCents),
    }
  },
  /** POST /v1/admin/treasury/anchor — anchor the current journal root on the Hanzo L1. */
  anchor: async (): Promise<AnchorStatus> => {
    const data = await originPost<unknown>('admin/treasury/anchor', {})
    return normalizeAnchor(asRecord(data).anchor)
  },
}
