/**
 * Admin feature-gate — the GLOBAL-ADMIN launch-control board over cloud-api's
 * `GET /v1/admin/services` + `POST /v1/admin/services` (onboard) + `POST
 * /v1/admin/services/:service/mode` (the waitlist toggle) (cloud
 * `clients/featuregate`). Reads/writes go through `originGet`/`originPost` — the
 * console's OWN origin (`<origin>/v1/admin/services…`), which `next.config.mjs`
 * rewrites to the GLOBAL-ADMIN-GATED `app/admin/aggregate` proxy (`getAdminGate`,
 * fail-closed 403, THEN a minted user bearer + same-origin CSRF). The browser holds
 * no admin credential.
 *
 * This is the launch dashboard's SERVICES half — flip a hosted service's
 * `waitlistMode` on|off to remove the waitlist one service at a time. The
 * PENDING-USERS half reuses the IAM approval API (`IamAdminApi.pendingUsers/
 * approveUser/rejectUser`, iam#104) through the /admin/iam proxy — one approval
 * store, no duplication.
 *
 * OPTIONAL-SAFE normalizers: the read returns `{ services: [...] }`; each field
 * degrades to a real empty/false, so an un-routed deployment renders an honest empty
 * board, never fabricated rows.
 */
import { originGet, originPost } from './client'

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1
const int = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Math.trunc(Number(v))
  return 0
}
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** One hosted service in the launch registry. */
export type FeatureService = {
  service: string
  displayName: string
  hosts: string[]
  waitlistMode: boolean
  description: string
  updatedAt: number
  updatedBy: string
}

export function normalizeService(raw: unknown): FeatureService {
  const r = asRecord(raw)
  const hosts = Array.isArray(r.hosts)
    ? r.hosts.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    : []
  return {
    service: str(r.service),
    displayName: str(r.displayName) || str(r.service),
    hosts,
    waitlistMode: bool(r.waitlistMode),
    description: str(r.description),
    updatedAt: int(r.updatedAt),
    updatedBy: str(r.updatedBy),
  }
}

export function servicesFrom(payload: unknown): FeatureService[] {
  const data = asRecord(payload)
  const list = Array.isArray(data.services) ? data.services : Array.isArray(payload) ? payload : []
  return list.map(normalizeService).filter((s) => s.service !== '')
}

export const FeatureGateApi = {
  /** The Services board — every hosted service + its waitlist mode. */
  list: async (): Promise<FeatureService[]> => {
    const data = await originGet<unknown>('/v1/admin/services')
    return servicesFrom(data)
  },

  /**
   * Flip one service's waitlist mode. `waitlistMode:false` OPENS it (any signed-up
   * user); `true` gates it (approved users only). Takes effect immediately.
   */
  setMode: async (service: string, waitlistMode: boolean): Promise<FeatureService> => {
    const data = await originPost<unknown>(`/v1/admin/services/${encodeURIComponent(service)}/mode`, { waitlistMode })
    return normalizeService(asRecord(data).service)
  },

  /** Onboard or edit a hosted service (no redeploy). Preserves a live mode on edit. */
  upsert: async (input: {
    service: string
    displayName?: string
    description?: string
    hosts: string[]
    waitlistMode?: boolean
  }): Promise<FeatureService> => {
    const data = await originPost<unknown>('/v1/admin/services', {
      service: input.service,
      displayName: input.displayName ?? '',
      description: input.description ?? '',
      hosts: input.hosts,
      waitlistMode: input.waitlistMode ?? true,
    })
    return normalizeService(asRecord(data).service)
  },
}
