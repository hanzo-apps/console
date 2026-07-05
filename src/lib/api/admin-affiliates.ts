/**
 * Admin affiliates — the GLOBAL-ADMIN operator view of the partner-commission
 * program over cloud-api's `GET /v1/admin/affiliates` + the `:id/{approve,suspend,
 * payout}` mutations + `POST /v1/admin/affiliates/sweep` (cloud `clients/affiliates`).
 * Reads/writes go through `originGet`/`originPost` — the console's OWN origin
 * (`<origin>/v1/admin/affiliates…`), which `next.config.mjs` rewrites to the
 * GLOBAL-ADMIN-GATED `app/admin/aggregate` proxy (`getAdminGate`, fail-closed 403,
 * THEN a minted user bearer + same-origin CSRF check). The browser holds no admin
 * credential.
 *
 * OPTIONAL-SAFE: the read returns the casibase envelope `{ affiliates, summary }`;
 * every field degrades to a real empty/`0`, so an un-routed deployment renders honest
 * empties, NEVER a fabricated ledger. Money is USD cents; rate is basis points.
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
export type AdminAffiliate = {
  id: string
  org: string
  code: string
  requestedCode: string
  status: string
  rateBps: number
  referredCount: number
  accruedCents: number
  pendingCents: number
  paidCents: number
  createdAt: number
  approvedAt: number
  suspendedAt: number
}

export type AdminAffiliateSummary = {
  total: number
  applied: number
  approved: number
  suspended: number
  accruedCents: number
  pendingCents: number
  paidCents: number
}

export type AdminAffiliatesView = {
  affiliates: AdminAffiliate[]
  summary: AdminAffiliateSummary
}

export type SweepResult = { swept: number; accrued: number }

/** A payout request: a `credits` method issues a commerce grant, cash is record-only. */
export type PayoutInput = { amountCents: number; method: string; reference?: string }

export function normalizeAdminAffiliate(v: unknown): AdminAffiliate {
  const r = asRecord(v)
  return {
    id: str(r.id),
    org: str(r.org),
    code: str(r.code),
    requestedCode: str(r.requestedCode),
    status: str(r.status) || 'applied',
    rateBps: int(r.rateBps),
    referredCount: int(r.referredCount),
    accruedCents: int(r.accruedCents),
    pendingCents: int(r.pendingCents),
    paidCents: int(r.paidCents),
    createdAt: int(r.createdAt),
    approvedAt: int(r.approvedAt),
    suspendedAt: int(r.suspendedAt),
  }
}

function normalizeSummary(v: unknown): AdminAffiliateSummary {
  const r = asRecord(v)
  return {
    total: int(r.total),
    applied: int(r.applied),
    approved: int(r.approved),
    suspended: int(r.suspended),
    accruedCents: int(r.accruedCents),
    pendingCents: int(r.pendingCents),
    paidCents: int(r.paidCents),
  }
}

export function normalizeAdminAffiliates(payload: unknown): AdminAffiliatesView {
  const r = asRecord(payload)
  return {
    affiliates: arrayUnder(r.affiliates, ['affiliates', 'data', 'items']).map(normalizeAdminAffiliate).filter((a) => a.id),
    summary: normalizeSummary(r.summary),
  }
}

export const AdminAffiliatesApi = {
  /** GET /v1/admin/affiliates — every affiliate + a fleet summary (global-admin). */
  list: async (limit?: number): Promise<AdminAffiliatesView> => {
    const data = await originGet<unknown>('admin/affiliates', limit ? { limit: String(limit) } : undefined)
    return normalizeAdminAffiliates(data)
  },
  /** POST /v1/admin/affiliates/:id/approve — approve + mint the code (optional override). */
  approve: async (id: string, code?: string): Promise<AdminAffiliate> => {
    const data = await originPost<unknown>(`admin/affiliates/${encodeURIComponent(id)}/approve`, code ? { code } : {})
    return normalizeAdminAffiliate(asRecord(data).affiliate)
  },
  /** POST /v1/admin/affiliates/:id/suspend. */
  suspend: async (id: string): Promise<AdminAffiliate> => {
    const data = await originPost<unknown>(`admin/affiliates/${encodeURIComponent(id)}/suspend`, {})
    return normalizeAdminAffiliate(asRecord(data).affiliate)
  },
  /** POST /v1/admin/affiliates/:id/payout — record a payout (credits → grant; cash → record-only). */
  payout: async (id: string, input: PayoutInput): Promise<AdminAffiliate> => {
    const data = await originPost<unknown>(`admin/affiliates/${encodeURIComponent(id)}/payout`, {
      amountCents: input.amountCents,
      method: input.method,
      reference: input.reference ?? '',
    })
    return normalizeAdminAffiliate(asRecord(data).affiliate)
  },
  /** POST /v1/admin/affiliates/sweep — accrue commission for every referred org this period. */
  sweep: async (): Promise<SweepResult> => {
    const data = await originPost<unknown>('admin/affiliates/sweep', {})
    const r = asRecord(data)
    return { swept: int(r.swept), accrued: int(r.accrued) }
  },
}
