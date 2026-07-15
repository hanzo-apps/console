/**
 * Affiliates — the customer client over the REAL cloud `/v1/affiliates` surface
 * (cloud `clients/affiliates`: a native-Go, per-org PARTNER-COMMISSION loop on
 * Base/SQLite that pays an ongoing commission on referred customers' metered spend,
 * settled through the commerce ledger). This is the recurring, partner-revenue growth
 * loop beside referrals' one-time both-sides credit. Every read/write is org-scoped
 * SERVER-SIDE from the minted user bearer; no credential reaches the browser.
 *
 * TRANSPORT: `cloudProxyV1Url('affiliates/…')` → `<origin>/v1/affiliates/…`,
 * the console's hardened `/v1` user-bearer proxy (NOT bare `/v1/…`, which the live
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
  /** The platform gross-margin fraction (bps) the share is computed on — the profit-share basis. */
  marginBps: number
  /** The opt-in public leaderboard display name (empty = not listed by name). */
  handle: string
  referredCount: number
  accruedCents: number
  pendingCents: number
  paidCents: number
  payouts: Payout[]
}

/** One row of the per-period share ledger (GET /v1/affiliates/me/earnings). */
export type PeriodEarning = { period: string; marginCents: number; commissionCents: number }

/** The aggregate share a DIRECT referral earned you (never the org's raw usage). */
export type OrgEarning = { referredOrg: string; commissionCents: number }

/** GET /v1/affiliates/me/earnings — the caller's per-period + per-referral share ledger. */
export type Earnings = {
  isAffiliate: boolean
  marginBps: number
  accruedCents: number
  pendingCents: number
  paidCents: number
  byPeriod: PeriodEarning[]
  byReferredOrg: OrgEarning[]
}

/** One shareable link with its derived stats. */
export type AffiliateLink = {
  code: string
  label: string
  url: string
  clicks: number
  signups: number
  conversions: number
  createdAt: number
}

/** GET /v1/affiliates/me/links — the caller's shareable links + the per-affiliate cap. */
export type LinksView = { isAffiliate: boolean; status: AffiliateStatus; maxLinks: number; links: AffiliateLink[] }

/** One privacy-preserving leaderboard row: rank + opt-in handle + aggregate, never an org. */
export type LeaderboardRow = { rank: number; handle: string; accruedCents: number; referredCount: number; isYou: boolean }

/** GET /v1/affiliates/leaderboard — top opt-in handles + your own rank (`you`, always visible). */
export type Leaderboard = { leaders: LeaderboardRow[]; total: number; you: LeaderboardRow | null }

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
    marginBps: int(r.marginBps),
    handle: str(r.handle),
    referredCount: int(r.referredCount),
    accruedCents: int(r.accruedCents),
    pendingCents: int(r.pendingCents),
    paidCents: int(r.paidCents),
    payouts: arrayUnder(r.payouts, ['payouts', 'data', 'items']).map(normalizePayout).filter((p) => p.id),
  }
}

export function normalizeEarnings(v: unknown): Earnings {
  const r = asRecord(v)
  return {
    isAffiliate: r.isAffiliate === true,
    marginBps: int(r.marginBps),
    accruedCents: int(r.accruedCents),
    pendingCents: int(r.pendingCents),
    paidCents: int(r.paidCents),
    byPeriod: arrayUnder(r.byPeriod, ['byPeriod']).map((x) => {
      const p = asRecord(x)
      return { period: str(p.period), marginCents: int(p.marginCents), commissionCents: int(p.commissionCents) }
    }).filter((p) => p.period),
    byReferredOrg: arrayUnder(r.byReferredOrg, ['byReferredOrg']).map((x) => {
      const p = asRecord(x)
      return { referredOrg: str(p.referredOrg), commissionCents: int(p.commissionCents) }
    }).filter((o) => o.referredOrg),
  }
}

export function normalizeLink(v: unknown): AffiliateLink {
  const r = asRecord(v)
  return {
    code: str(r.code),
    label: str(r.label),
    url: str(r.url),
    clicks: int(r.clicks),
    signups: int(r.signups),
    conversions: int(r.conversions),
    createdAt: int(r.createdAt),
  }
}

export function normalizeLinks(v: unknown): LinksView {
  const r = asRecord(v)
  return {
    isAffiliate: r.isAffiliate === true,
    status: (str(r.status) || 'applied') as AffiliateStatus,
    maxLinks: int(r.maxLinks) || 50,
    links: arrayUnder(r.links, ['links']).map(normalizeLink).filter((l) => l.code),
  }
}

export function normalizeLeaderboardRow(v: unknown): LeaderboardRow {
  const r = asRecord(v)
  return {
    rank: int(r.rank),
    handle: str(r.handle),
    accruedCents: int(r.accruedCents),
    referredCount: int(r.referredCount),
    isYou: r.isYou === true,
  }
}

export function normalizeLeaderboard(v: unknown): Leaderboard {
  const r = asRecord(v)
  const you = r.you && typeof r.you === 'object' ? normalizeLeaderboardRow(r.you) : null
  return {
    leaders: arrayUnder(r.leaders, ['leaders']).map(normalizeLeaderboardRow).filter((l) => l.rank > 0),
    total: int(r.total),
    you,
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

  /** GET /v1/affiliates/me/earnings — my per-period + per-referral share ledger. */
  earnings: (): Promise<Earnings> =>
    restGet<unknown>(cloudProxyV1Url(`${BASE}/me/earnings`)).then(normalizeEarnings),

  /** GET /v1/affiliates/me/links — my shareable links + their click/signup/conversion stats. */
  links: (): Promise<LinksView> =>
    restGet<unknown>(cloudProxyV1Url(`${BASE}/me/links`)).then(normalizeLinks),

  /** POST /v1/affiliates/me/links — mint a new shareable link (optional label + vanity code). */
  createLink: (label?: string, code?: string): Promise<AffiliateLink> =>
    restPost<unknown>(cloudProxyV1Url(`${BASE}/me/links`), { label: label ?? '', code: code ?? '' }).then((v) =>
      normalizeLink(asRecord(v).link),
    ),

  /** POST /v1/affiliates/me/handle — set (or clear) my opt-in leaderboard handle. */
  setHandle: (handle: string): Promise<string> =>
    restPost<unknown>(cloudProxyV1Url(`${BASE}/me/handle`), { handle }).then((v) => str(asRecord(v).handle)),

  /** GET /v1/affiliates/leaderboard — top opt-in handles + my own rank (privacy-preserving). */
  leaderboard: (): Promise<Leaderboard> =>
    restGet<unknown>(cloudProxyV1Url(`${BASE}/leaderboard`)).then(normalizeLeaderboard),

  /** POST /v1/affiliates/click — a public click ping for a link code (vanity counter). */
  click: (code: string): Promise<void> =>
    restPost<unknown>(cloudProxyV1Url(`${BASE}/click`), { code }).then(() => undefined),
}
