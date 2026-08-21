/**
 * Admin referrals — the GLOBAL-ADMIN operator view of the referral program over
 * cloud-api's `GET /v1/admin/affiliates/referrals` + `POST /v1/admin/referrals/sweep`
 * (cloud `clients/referrals`). Reads go through `originGet` — the console's OWN
 * origin (`<origin>/v1/admin/affiliates/referrals`), which `next.config.mjs` rewrites to the
 * GLOBAL-ADMIN-GATED `app/admin/aggregate` proxy (`getAdminGate`, fail-closed 403,
 * THEN a minted user bearer). The browser holds no admin credential.
 *
 * OPTIONAL-SAFE: the endpoint returns the casibase envelope `{ referrals, summary }`;
 * every field degrades to a real empty/`0`, so an un-routed deployment (`ApiError
 * 404`) renders honest empties, NEVER a fabricated ledger. Money is USD cents.
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

/** One row in the global-admin directory (BOTH orgs exposed). */
export type AdminReferral = {
  id: string
  referrerOrg: string
  refereeOrg: string
  code: string
  status: string
  referrerGrantCents: number
  refereeGrantCents: number
  referrerTxn: string
  refereeTxn: string
  createdAt: number
  qualifiedAt: number
  creditedAt: number
}

export type AdminReferralSummary = {
  total: number
  signup: number
  qualified: number
  credited: number
  grantedCents: number
}

export type AdminReferralsView = {
  referrals: AdminReferral[]
  summary: AdminReferralSummary
}

export type SweepResult = { swept: number; credited: number }

function normalizeAdminReferral(v: unknown): AdminReferral {
  const r = asRecord(v)
  return {
    id: str(r.id),
    referrerOrg: str(r.referrerOrg),
    refereeOrg: str(r.refereeOrg),
    code: str(r.code),
    status: str(r.status) || 'signup',
    referrerGrantCents: int(r.referrerGrantCents),
    refereeGrantCents: int(r.refereeGrantCents),
    referrerTxn: str(r.referrerTxn),
    refereeTxn: str(r.refereeTxn),
    createdAt: int(r.createdAt),
    qualifiedAt: int(r.qualifiedAt),
    creditedAt: int(r.creditedAt),
  }
}

function normalizeSummary(v: unknown): AdminReferralSummary {
  const r = asRecord(v)
  return {
    total: int(r.total),
    signup: int(r.signup),
    qualified: int(r.qualified),
    credited: int(r.credited),
    grantedCents: int(r.grantedCents),
  }
}

export function normalizeAdminReferrals(payload: unknown): AdminReferralsView {
  const r = asRecord(payload)
  return {
    referrals: arrayUnder(r.referrals, ['referrals', 'data', 'items']).map(normalizeAdminReferral).filter((x) => x.id),
    summary: normalizeSummary(r.summary),
  }
}

export const AdminReferralsApi = {
  /** GET /v1/admin/affiliates/referrals — every referral + a fleet summary (global-admin).
   *  The board is the affiliates programme's; only the bonus ledger and the sweep still
   *  answer under `admin/referrals`. */
  list: async (limit?: number): Promise<AdminReferralsView> => {
    const data = await originGet<unknown>('admin/affiliates/referrals', limit ? { limit: String(limit) } : undefined)
    return normalizeAdminReferrals(data)
  },
  /** POST /v1/admin/referrals/sweep — qualify-check every pending referral. */
  sweep: async (): Promise<SweepResult> => {
    const data = await originPost<unknown>('admin/referrals/sweep', {})
    const r = asRecord(data)
    return { swept: int(r.swept), credited: int(r.credited) }
  },
}
