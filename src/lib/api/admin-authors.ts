/**
 * Admin authors — the GLOBAL-ADMIN operator view of the OSS-author royalty program
 * over cloud-api's `GET /v1/admin/authors` + the `:id/{approve,suspend,payout}`
 * mutations + `POST /v1/admin/authors/sweep` (cloud `clients/authors`). Reads/writes
 * go through `originGet`/`originPost` — the console's OWN origin
 * (`<origin>/v1/admin/authors…`), which `next.config.mjs` rewrites to the
 * GLOBAL-ADMIN-GATED `app/admin/aggregate` proxy (`getAdminGate`, fail-closed 403,
 * THEN a minted user bearer + same-origin CSRF check). The browser holds no admin
 * credential.
 *
 * OPTIONAL-SAFE: the read returns the casibase envelope `{ authors, summary }`;
 * every field degrades to a real empty/`0`, so an un-routed deployment renders honest
 * empties, NEVER a fabricated ledger. Money is USD cents; share is basis points.
 */
import { originGet, originPost } from './client'

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const int = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Math.trunc(Number(v))
  return 0
}
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

/** One row in the global-admin directory (org exposed). */
export type AdminAuthor = {
  id: string
  org: string
  githubLogin: string
  status: string
  verified: boolean
  shareBps: number
  repoCount: number
  deployCount: number
  accruedCents: number
  pendingCents: number
  paidCents: number
  createdAt: number
  approvedAt: number
  suspendedAt: number
}

export type AdminAuthorSummary = {
  total: number
  connected: number
  approved: number
  suspended: number
  accruedCents: number
  pendingCents: number
  paidCents: number
}

export type AdminAuthorsView = {
  authors: AdminAuthor[]
  summary: AdminAuthorSummary
}

export type SweepResult = { swept: number; accrued: number }

/** A payout request: a `credits` method issues a commerce grant, cash is record-only. */
export type PayoutInput = { amountCents: number; method: string; reference?: string }

export function normalizeAdminAuthor(v: unknown): AdminAuthor {
  const r = asRecord(v)
  return {
    id: str(r.id),
    org: str(r.org),
    githubLogin: str(r.githubLogin),
    status: str(r.status) || 'connected',
    verified: r.verified === true,
    shareBps: int(r.shareBps),
    repoCount: int(r.repoCount),
    deployCount: int(r.deployCount),
    accruedCents: int(r.accruedCents),
    pendingCents: int(r.pendingCents),
    paidCents: int(r.paidCents),
    createdAt: int(r.createdAt),
    approvedAt: int(r.approvedAt),
    suspendedAt: int(r.suspendedAt),
  }
}

function normalizeSummary(v: unknown): AdminAuthorSummary {
  const r = asRecord(v)
  return {
    total: int(r.total),
    connected: int(r.connected),
    approved: int(r.approved),
    suspended: int(r.suspended),
    accruedCents: int(r.accruedCents),
    pendingCents: int(r.pendingCents),
    paidCents: int(r.paidCents),
  }
}

export function normalizeAdminAuthors(payload: unknown): AdminAuthorsView {
  const r = asRecord(payload)
  return {
    authors: arrayUnder(r.authors, ['authors', 'data', 'items']).map(normalizeAdminAuthor).filter((a) => a.id),
    summary: normalizeSummary(r.summary),
  }
}

export const AdminAuthorsApi = {
  /** GET /v1/admin/authors — every author + a fleet summary (global-admin). */
  list: async (limit?: number): Promise<AdminAuthorsView> => {
    const data = await originGet<unknown>('admin/authors', limit ? { limit: String(limit) } : undefined)
    return normalizeAdminAuthors(data)
  },
  /** POST /v1/admin/authors/:id/approve — approve (optional share override; 0 = keep default). */
  approve: async (id: string, shareBps?: number): Promise<AdminAuthor> => {
    const data = await originPost<unknown>(`admin/authors/${encodeURIComponent(id)}/approve`, shareBps ? { shareBps } : {})
    return normalizeAdminAuthor(asRecord(data).author)
  },
  /** POST /v1/admin/authors/:id/suspend. */
  suspend: async (id: string): Promise<AdminAuthor> => {
    const data = await originPost<unknown>(`admin/authors/${encodeURIComponent(id)}/suspend`, {})
    return normalizeAdminAuthor(asRecord(data).author)
  },
  /** POST /v1/admin/authors/:id/payout — record a payout (credits → grant; cash → record-only). */
  payout: async (id: string, input: PayoutInput): Promise<AdminAuthor> => {
    const data = await originPost<unknown>(`admin/authors/${encodeURIComponent(id)}/payout`, {
      amountCents: input.amountCents,
      method: input.method,
      reference: input.reference ?? '',
    })
    return normalizeAdminAuthor(asRecord(data).author)
  },
  /** POST /v1/admin/authors/sweep — accrue royalties for every deployed author this period. */
  sweep: async (): Promise<SweepResult> => {
    const data = await originPost<unknown>('admin/authors/sweep', {})
    const r = asRecord(data)
    return { swept: int(r.swept), accrued: int(r.accrued) }
  },
}
