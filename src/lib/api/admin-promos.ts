/**
 * Admin PROMOS client — the SINGLE platform plan promo (a percent-off applied to
 * paid subscription plans). GLOBAL-ADMIN only.
 *
 * Reads/writes the cloud `/v1/admin/promos` surface (casibase `{status,msg,data}`
 * envelope) through `originGet`/`originPut` — same-origin, so they terminate at the
 * GLOBAL-ADMIN-GATED `app/admin/aggregate` proxy (`getAdminGate`, fail-closed 403,
 * then a minted user bearer + same-origin CSRF). Pinning the ORIGIN (not
 * `config.cloudUrl`) means a split-origin `NEXT_PUBLIC_CLOUD_URL` can never route
 * around the console gate. The browser holds no admin credential.
 *
 * There is exactly ONE platform promo (a singleton the PUT upserts) — so this is a
 * get/put pair, not a collection. OPTIONAL-SAFE: an unset promo reads back zeroed
 * (percentOff 0, no plans, inactive), never fabricated. `plans: []` means the promo
 * applies to ALL paid plans; a non-empty list scopes it to those plan ids.
 */
import { originGet, originPut } from './client'

/**
 * The single platform plan promo. `percentOff` is 0..100; `start`/`end` are RFC3339
 * (or '' when open-ended); `plans` = the paid plan ids it applies to ([] = all paid
 * plans); `active` gates it on/off independent of the date window.
 */
export type PlatformPromo = {
  percentOff: number
  start: string
  end: string
  plans: string[]
  active: boolean
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1
const int = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Math.trunc(Number(v))
  return 0
}
/** Clamp a percent to the backend-enforced 0..100 range. */
export const clampPercent = (n: number): number => Math.max(0, Math.min(100, int(n)))
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []

/** Roll the backend promo shape into the display `PlatformPromo`; missing → zeroed. */
export function normalizePromo(raw: unknown): PlatformPromo {
  const r = asRecord(raw)
  return {
    percentOff: clampPercent(int(r.percentOff)),
    start: str(r.start),
    end: str(r.end),
    plans: strArr(r.plans),
    active: bool(r.active),
  }
}

export const AdminPromosApi = {
  /** The current live platform promo (`GET /v1/admin/promos`); zeroed when unset. */
  get: async (): Promise<PlatformPromo> => normalizePromo(await originGet<unknown>('admin/promos')),

  /** Upsert the single platform promo (`PUT /v1/admin/promos`). Returns the saved row. */
  put: async (body: PlatformPromo): Promise<PlatformPromo> =>
    normalizePromo(
      await originPut<unknown>('admin/promos', {
        percentOff: clampPercent(body.percentOff),
        start: body.start || '',
        end: body.end || '',
        plans: strArr(body.plans),
        active: body.active,
      }),
    ),
}
