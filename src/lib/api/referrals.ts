/**
 * Referrals — the customer client over the REAL cloud `/v1/referrals` surface
 * (cloud `clients/referrals`: a native-Go, per-org viral loop on Base/SQLite that
 * grants promo cloud credit through the commerce ledger). Every read/write is
 * org-scoped SERVER-SIDE from the minted user bearer; no credential reaches the
 * browser.
 *
 * TRANSPORT: `cloudProxyV1Url('referrals/…')` → `<origin>/v1/referrals/…`,
 * the console's hardened `/v1` user-bearer proxy (NOT bare `/v1/…`, which the
 * live ingress routes to the gateway with no principal → 403; the v8.4.70/8.4.93
 * lesson for a bearer-scoped head). The backend answers BARE JSON (like
 * `clients/crm`), so these use the plain REST verbs + defensive normalizers.
 */
import { restGet, restPost, cloudProxyV1Url } from './client'

const BASE = 'referrals'

// ── Coercion helpers (defensive; crm.ts style) ──────────────────────────────
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

// ── Domain types (mirror cloud clients/referrals JSON tags) ─────────────────

/** A referral advances signup → qualified → credited (credited is terminal). */
export type ReferralStatus = 'signup' | 'qualified' | 'credited' | (string & {})

/** One row in the referrer's own list (the people THEY referred). */
export type MyReferral = {
  id: string
  referee: string // the org that signed up via my code
  status: ReferralStatus
  creditsCents: number // what I (the referrer) earned from this one
  createdAt: number
  qualifiedAt: number
  creditedAt: number
}

export type ReferralCounts = {
  total: number
  signup: number
  qualified: number
  credited: number
}

/** The GET /v1/referrals overview: my code, link, bonuses, list, earnings. */
export type ReferralOverview = {
  code: string
  link: string
  referrerBonusCents: number
  refereeBonusCents: number
  creditsEarnedCents: number
  counts: ReferralCounts
  referrals: MyReferral[]
}

/** The POST /v1/referrals/claim result. */
export type ClaimResult = {
  id: string
  code: string
  status: ReferralStatus
  created: boolean
  createdAt: number
}

// ── Normalizers (garbage-in → safe default) ─────────────────────────────────

export function normalizeMyReferral(v: unknown): MyReferral {
  const r = asRecord(v)
  return {
    id: str(r.id),
    referee: str(r.referee),
    status: (str(r.status) || 'signup') as ReferralStatus,
    creditsCents: int(r.creditsCents),
    createdAt: int(r.createdAt),
    qualifiedAt: int(r.qualifiedAt),
    creditedAt: int(r.creditedAt),
  }
}

function normalizeCounts(v: unknown): ReferralCounts {
  const r = asRecord(v)
  return {
    total: int(r.total),
    signup: int(r.signup),
    qualified: int(r.qualified),
    credited: int(r.credited),
  }
}

export function normalizeOverview(v: unknown): ReferralOverview {
  const r = asRecord(v)
  return {
    code: str(r.code),
    link: str(r.link),
    referrerBonusCents: int(r.referrerBonusCents),
    refereeBonusCents: int(r.refereeBonusCents),
    creditsEarnedCents: int(r.creditsEarnedCents),
    counts: normalizeCounts(r.counts),
    referrals: arrayUnder(r.referrals, ['referrals', 'data', 'items'])
      .map(normalizeMyReferral)
      .filter((x) => x.id),
  }
}

export function normalizeClaim(v: unknown): ClaimResult {
  const r = asRecord(v)
  return {
    id: str(r.id),
    code: str(r.code),
    status: (str(r.status) || 'signup') as ReferralStatus,
    created: r.created === true,
    createdAt: int(r.createdAt),
  }
}

// ── Network surface ─────────────────────────────────────────────────────────

export const ReferralsApi = {
  /** GET /v1/referrals — my code, link, referrals, credits earned. */
  overview: (): Promise<ReferralOverview> =>
    restGet<unknown>(cloudProxyV1Url(BASE)).then(normalizeOverview),

  /** POST /v1/referrals/claim — record a referral from a stashed ?ref code. */
  claim: (code: string): Promise<ClaimResult> =>
    restPost<unknown>(cloudProxyV1Url(`${BASE}/claim`), { code }).then(normalizeClaim),
}
