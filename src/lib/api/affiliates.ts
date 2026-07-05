/**
 * Affiliates — the customer client over the REAL cloud `/v1/affiliates` surface
 * (cloud `clients/affiliates`: a native-Go, per-org PARTNER-COMMISSION loop on
 * Base/SQLite that pays an ongoing commission on referred customers' metered spend,
 * settled through the commerce ledger). This is the recurring, partner-revenue growth
 * loop beside referrals' one-time both-sides credit. Every read/write is org-scoped
 * SERVER-SIDE from the minted user bearer; no credential reaches the browser.
 *
 * TRANSPORT: `cloudProxyV1Url('affiliates/…')` → `<origin>/cloud/v1/affiliates/…`,
 * the console's hardened `/cloud` user-bearer proxy (NOT bare `/v1/…`, which the live
 * ingress routes to the gateway with no principal → 403; the referrals/crm lesson).
 * The backend answers BARE JSON, so these use the plain REST verbs + defensive
 * normalizers.
 */
import { restGet, restPost, cloudProxyV1Url } from './client'

const BASE = 'affiliates'

// ── Coercion helpers (defensive; referrals.ts style) ─────────────────────────
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

// ── Domain types (mirror cloud clients/affiliates JSON tags) ─────────────────

/** An affiliate advances applied → approved (and can be suspended). */
export type AffiliateStatus = 'applied' | 'approved' | 'suspended' | (string & {})

/** One row of an affiliate's payout history. */
export type Payout = {
  id: string
  amountCents: number
  method: string
  reference: string
  txn: string
  createdAt: number
}

/**
 * The GET /v1/affiliates overview. `isAffiliate:false` (with `defaultRateBps`)
 * means the org has NOT applied yet → the console shows the apply form; otherwise
 * the full dashboard (status, code, link, rate, referred count, ledger, payouts).
 */
export type AffiliateOverview = {
  isAffiliate: boolean
  defaultRateBps: number
  id: string
  status: AffiliateStatus
  code: string
  requestedCode: string
  link: string
  rateBps: number
  referredCount: number
  accruedCents: number
  pendingCents: number
  paidCents: number
  payouts: Payout[]
}

/** The POST /v1/affiliates/apply result. */
export type ApplyResult = {
  id: string
  status: AffiliateStatus
  code: string
  requestedCode: string
  rateBps: number
  created: boolean
}

/** The POST /v1/affiliates/attribute result. */
export type AttributeResult = {
  id: string
  code: string
  created: boolean
  createdAt: number
}

// ── Normalizers (garbage-in → safe default) ──────────────────────────────────

export function normalizePayout(v: unknown): Payout {
  const r = asRecord(v)
  return {
    id: str(r.id),
    amountCents: int(r.amountCents),
    method: str(r.method),
    reference: str(r.reference),
    txn: str(r.txn),
    createdAt: int(r.createdAt),
  }
}

export function normalizeOverview(v: unknown): AffiliateOverview {
  const r = asRecord(v)
  // The default rate is what an apply would grant (backend sends it in BOTH shapes).
  const defaultRateBps = int(r.defaultRateBps) || 2000
  return {
    isAffiliate: r.isAffiliate === true,
    defaultRateBps,
    id: str(r.id),
    status: (str(r.status) || 'applied') as AffiliateStatus,
    code: str(r.code),
    requestedCode: str(r.requestedCode),
    link: str(r.link),
    rateBps: int(r.rateBps),
    referredCount: int(r.referredCount),
    accruedCents: int(r.accruedCents),
    pendingCents: int(r.pendingCents),
    paidCents: int(r.paidCents),
    payouts: arrayUnder(r.payouts, ['payouts', 'data', 'items']).map(normalizePayout).filter((p) => p.id),
  }
}

export function normalizeApply(v: unknown): ApplyResult {
  const r = asRecord(v)
  return {
    id: str(r.id),
    status: (str(r.status) || 'applied') as AffiliateStatus,
    code: str(r.code),
    requestedCode: str(r.requestedCode),
    rateBps: int(r.rateBps),
    created: r.created === true,
  }
}

export function normalizeAttribute(v: unknown): AttributeResult {
  const r = asRecord(v)
  return {
    id: str(r.id),
    code: str(r.code),
    created: r.created === true,
    createdAt: int(r.createdAt),
  }
}

// ── Network surface ───────────────────────────────────────────────────────────

export const AffiliatesApi = {
  /** GET /v1/affiliates — my status, code, link, referred count, ledger, payouts. */
  overview: (): Promise<AffiliateOverview> =>
    restGet<unknown>(cloudProxyV1Url(BASE)).then(normalizeOverview),

  /** POST /v1/affiliates/apply — apply to the program (optional vanity code). */
  apply: (requestedCode?: string): Promise<ApplyResult> =>
    restPost<unknown>(cloudProxyV1Url(`${BASE}/apply`), { requestedCode: requestedCode ?? '' }).then(normalizeApply),

  /** POST /v1/affiliates/attribute — record attribution from a stashed ?aff code. */
  attribute: (code: string): Promise<AttributeResult> =>
    restPost<unknown>(cloudProxyV1Url(`${BASE}/attribute`), { code }).then(normalizeAttribute),
}
