/**
 * Ads API — Hanzo Ads (per-org ad campaigns), over the REAL cloud `/v1/ads`
 * surface (cloud `clients/ads`, a native-Go per-org campaign store on Base/SQLite,
 * twin of clients/crm). NOT a proxy to a standalone ads pod (there is none — ads is
 * net-new).
 *
 * Every call is same-origin, keyless and prefix-free (`originV1Url('ads/...')`
 * → `<origin>/v1/ads/...`). The console's OWN `app/v1` user-bearer BFF serves
 * the `ads` head — it mints a short-lived user-bound IAM token server-side and
 * forwards it; the cloud backend resolves the org from the token's `owner` claim, so
 * every read/write is org-scoped SERVER-SIDE and no credential reaches the browser.
 * This is the EXACT per-tenant path CRM/Agents/Prompts use (the `ads` head is
 * allow-listed in `proxy-allow.ts` CLOUD_HEADS). A cookie-only call would 403
 * ("X-Org-Id required"), so the bearer BFF is mandatory — never a direct call.
 *
 * Routes (from cloud `clients/ads/ads.go`):
 *   GET                 /v1/ads/summary            per-org roll-up
 *   GET/POST            /v1/ads/campaigns          list (?status=) / create
 *   GET/PUT/DELETE      /v1/ads/campaigns/:id      detail / update / delete
 *
 * Plain REST (raw JSON, real HTTP status). Payloads are normalized DEFENSIVELY — a
 * field rename upstream degrades a cell rather than throwing, and the list is read
 * from whichever envelope key the backend uses (`data`/`items`/`rows`, or a bare
 * array). Mirrors the crm.ts shape exactly.
 */
import { restGet, restPost, restPut, restDelete, originV1Url } from './client'

const BASE = 'ads'
const enc = encodeURIComponent

// ── Coercion helpers (defensive; crm.ts style) ──────────────────────────────
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
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
const rows = (payload: unknown) => arrayUnder(payload, ['data', 'items', 'rows'])

// ── Domain types (mirror cloud clients/ads/store.go JSON tags) ───────────────

/** Ad platforms (cloud rejects an unknown platform; '' → meta). */
export const PLATFORMS = ['meta', 'google', 'tiktok', 'x'] as const
export type Platform = (typeof PLATFORMS)[number]

/** Campaign lifecycle (cloud rejects an unknown status; '' → draft). */
export const STATUSES = ['draft', 'active', 'paused', 'completed'] as const
export type Status = (typeof STATUSES)[number]

export type Campaign = {
  id: string
  name: string
  platform: string
  status: string
  objective: string
  /** Budget in minor units (cents). */
  budget: number
  /** Spend in minor units (cents). */
  spend: number
  createdAt: number
  updatedAt: number
}

export type Summary = { campaigns: number; active: number; budget: number; spend: number }

/** Create/update body — only the writable fields (server owns id/org/timestamps). */
export type NewCampaign = Partial<Omit<Campaign, 'id' | 'createdAt' | 'updatedAt'>> & { name: string }

// ── Normalizers (pure) ──────────────────────────────────────────────────────

export function normalizeCampaign(raw: unknown): Campaign {
  const r = asRecord(raw)
  return {
    id: str(r.id),
    name: str(r.name),
    platform: str(r.platform) || 'meta',
    status: str(r.status) || 'draft',
    objective: str(r.objective),
    budget: num(r.budget),
    spend: num(r.spend),
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
  }
}

export function normalizeSummary(raw: unknown): Summary {
  const r = asRecord(raw)
  return { campaigns: num(r.campaigns), active: num(r.active), budget: num(r.budget), spend: num(r.spend) }
}

export const normalizeCampaigns = (p: unknown): Campaign[] => rows(p).map(normalizeCampaign).filter((c) => c.id)

// ── Network methods (thin — one per documented route) ───────────────────────

export const AdsApi = {
  summary: (): Promise<Summary> => restGet<unknown>(originV1Url(`${BASE}/summary`)).then(normalizeSummary),

  campaigns: {
    list: (status?: string): Promise<Campaign[]> =>
      restGet<unknown>(
        originV1Url(`${BASE}/campaigns${status ? `?status=${enc(status)}` : ''}`),
      ).then(normalizeCampaigns),
    get: (id: string): Promise<Campaign> =>
      restGet<unknown>(originV1Url(`${BASE}/campaigns/${enc(id)}`)).then(normalizeCampaign),
    create: (body: NewCampaign): Promise<Campaign> =>
      restPost<unknown>(originV1Url(`${BASE}/campaigns`), body).then(normalizeCampaign),
    update: (id: string, body: NewCampaign): Promise<Campaign> =>
      restPut<unknown>(originV1Url(`${BASE}/campaigns/${enc(id)}`), body).then(normalizeCampaign),
    remove: (id: string): Promise<void> => restDelete(originV1Url(`${BASE}/campaigns/${enc(id)}`)),
  },
}
