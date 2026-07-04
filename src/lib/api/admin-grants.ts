/**
 * Admin GRANTS client — the fleet credit-grant ledger + issuance. GLOBAL-ADMIN only.
 *
 * Reads/writes the cloud `/v1/admin/grants` surface (casibase `{status,msg,data}`
 * envelope) through `originGet`/`originPost` — same-origin, so they terminate at the
 * GLOBAL-ADMIN-GATED `app/admin/aggregate` proxy (`getAdminGate`, fail-closed 403,
 * then a minted user bearer). Pinning the ORIGIN (not `config.cloudUrl`) means a
 * split-origin `NEXT_PUBLIC_CLOUD_URL` can never route around the console gate.
 *
 * OPTIONAL-SAFE: every field degrades to an honest 0 / empty / em-dash; NOTHING is
 * fabricated. Money is USD cents. The grant `source` is `trial` (non-cash comp) or
 * `prepaid` (real money) — reused from admin-cockpit so there is ONE GrantSource.
 */
import { originGet, originPost } from './client'
import type { GrantSource } from './admin-cockpit'

export type { GrantSource } from './admin-cockpit'

/** One issued grant in the fleet ledger. */
export type AdminGrant = {
  org: string
  orgDisplay: string
  amountCents: number
  currency: string
  source: GrantSource
  reason: string
  /** The staff operator who issued it (audit). */
  actor: string
  createdAt: string
  transactionId: string
  /** Commerce outcome, when reported (e.g. `granted` / `already_granted`). */
  result: string
}

/** The body to issue a new grant. `source` defaults to `trial` server-side. */
export type NewGrant = { org: string; amountCents: number; currency?: string; reason?: string; source?: GrantSource }

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const asSource = (v: unknown): GrantSource => (v === 'prepaid' ? 'prepaid' : 'trial')

function normalizeGrant(raw: unknown): AdminGrant {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    org: str(r.org),
    orgDisplay: str(r.orgDisplay) || str(r.org),
    amountCents: num(r.amountCents),
    currency: str(r.currency) || 'usd',
    source: asSource(r.source),
    reason: str(r.reason),
    actor: str(r.actor),
    createdAt: str(r.createdAt),
    transactionId: str(r.transactionId),
    result: str(r.result),
  }
}

export const AdminGrantsApi = {
  /** Every grant issued across the fleet (most recent first, as cloud returns them). */
  list: async (): Promise<AdminGrant[]> => arr(await originGet<unknown>('admin/grants')).map(normalizeGrant),

  /** Issue a grant (`POST /v1/admin/grants`). Returns the created grant row. */
  create: async (body: NewGrant): Promise<AdminGrant> => normalizeGrant(await originPost<unknown>('admin/grants', body)),
}
