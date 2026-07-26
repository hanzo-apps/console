/**
 * Block-storage fleet — the GLOBAL-ADMIN view of our DO block storage, so we can
 * watch the analytics datastore (and every volume) fill and scale DO storage before
 * it runs out. admin.hanzo.ai only.
 *
 * ONE read on the aggregate surface: `GET /v1/admin/block-storage` — the `block-storage` head is
 * allow-listed in `admin-aggregate.ts` + `next.config.mjs`, so the request rides the
 * SAME global-admin-gated `app/admin/aggregate` BFF (getAdminGate → fail-closed 403,
 * then a minted user bearer) as every other admin read; in the go:embed console it
 * hits cloud's `/v1/admin/block-storage` directly under the first-party session cookie.
 *
 * Backend contract (cloud `clients/admin/block_storage.go`, DO API inventory + o11y/df fill):
 *   {
 *     fleet:     { count, totalGiB, usedGiB?, pct?, monthlyUsd },
 *     datastore: { name, mount, sizeGiB, usedGiB, pct } | null,   // the analytics backend, highlighted
 *     volumes:   [{ id, name, region, sizeGiB, usedGiB?, pct?, attached, service? }],
 *     alerts:    [{ volume, pct, level }],                        // near-full, backend-thresholded
 *   }
 * TRANSPORT is `restGet` (raw JSON) with a tolerant extractor — the backend may send a
 * bare object or the casibase `{status,msg,data}` envelope. Every fill field is
 * OPTIONAL: DO's API gives capacity + attachment but NOT fill %, so `usedGiB`/`pct`
 * are present only where a filesystem source (o11y host metrics / a df probe) reported
 * them. An absent fill renders an honest "—", never a fabricated number.
 */
import { restGet, originV1Url } from './client'

export type StorageVolume = {
  id: string
  name: string
  region: string
  sizeGiB: number
  usedGiB: number | null
  pct: number | null
  attached: boolean
  service: string | null
}

export type StorageFleet = {
  count: number
  totalGiB: number
  usedGiB: number | null
  pct: number | null
  monthlyUsd: number
}

export type DatastoreVolume = {
  name: string
  mount: string
  sizeGiB: number
  usedGiB: number
  pct: number
}

export type StorageAlert = { volume: string; pct: number; level: 'warn' | 'critical' }

export type StorageSnapshot = {
  fleet: StorageFleet
  datastore: DatastoreVolume | null
  volumes: StorageVolume[]
  alerts: StorageAlert[]
}

/** Unwrap a bare object or the casibase `{data}` / `{storage}` envelope. Never throws. */
function pluck(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  for (const key of ['data', 'storage', 'result']) {
    if (r[key] && typeof r[key] === 'object') return r[key] as Record<string, unknown>
  }
  return r
}

const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : Number(v)) || 0
/** A fill field is null unless the backend actually reported a finite number. */
const optNum = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return isFinite(n) ? n : null
}
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** DO block storage is $0.10/GiB/mo — the fleet cost, for the ops budget line. */
export const DO_BLOCK_USD_PER_GIB = 0.1

function normalizeVolume(v: Record<string, unknown>): StorageVolume {
  const sizeGiB = num(v.sizeGiB ?? v.size_gib ?? v.size ?? v.sizeGigaBytes)
  const usedGiB = optNum(v.usedGiB ?? v.used_gib ?? v.used)
  const pct = optNum(v.pct ?? v.percent ?? v.usedPct) ?? (usedGiB != null && sizeGiB > 0 ? (usedGiB / sizeGiB) * 100 : null)
  return {
    id: str(v.id ?? v.name),
    name: str(v.name ?? v.id),
    region: str(v.region),
    sizeGiB,
    usedGiB,
    pct,
    attached: Boolean(v.attached ?? (Array.isArray(v.dropletIds ?? v.droplet_ids) && (v.dropletIds as unknown[] ?? v.droplet_ids as unknown[]).length > 0) ?? v.service),
    service: (v.service as string) || null,
  }
}

export function normalizeSnapshot(raw: unknown): StorageSnapshot {
  const r = pluck(raw)
  const volumes = Array.isArray(r.volumes) ? (r.volumes as Record<string, unknown>[]).map(normalizeVolume) : []
  const fr = (r.fleet && typeof r.fleet === 'object' ? r.fleet : {}) as Record<string, unknown>
  const totalGiB = num(fr.totalGiB ?? fr.total_gib) || volumes.reduce((s, v) => s + v.sizeGiB, 0)
  const count = num(fr.count) || volumes.length
  const usedGiB = optNum(fr.usedGiB ?? fr.used_gib)
  const fleet: StorageFleet = {
    count,
    totalGiB,
    usedGiB,
    pct: optNum(fr.pct) ?? (usedGiB != null && totalGiB > 0 ? (usedGiB / totalGiB) * 100 : null),
    monthlyUsd: num(fr.monthlyUsd ?? fr.monthly_usd) || Math.round(totalGiB * DO_BLOCK_USD_PER_GIB),
  }
  let datastore: DatastoreVolume | null = null
  if (r.datastore && typeof r.datastore === 'object') {
    const d = r.datastore as Record<string, unknown>
    const sizeGiB = num(d.sizeGiB ?? d.size_gib ?? d.size)
    const used = num(d.usedGiB ?? d.used_gib ?? d.used)
    datastore = { name: str(d.name) || 'datastore', mount: str(d.mount), sizeGiB, usedGiB: used, pct: optNum(d.pct) ?? (sizeGiB > 0 ? (used / sizeGiB) * 100 : 0) }
  }
  const alerts: StorageAlert[] = Array.isArray(r.alerts)
    ? (r.alerts as Record<string, unknown>[]).map((a) => ({ volume: str(a.volume ?? a.name), pct: num(a.pct), level: a.level === 'critical' ? 'critical' : 'warn' }))
    : []
  return { fleet, datastore, volumes, alerts }
}

export const StorageFleetApi = {
  /** The block-storage fleet snapshot — global-admin only. */
  async snapshot(): Promise<StorageSnapshot> {
    const raw = await restGet<unknown>(originV1Url('admin/block-storage'))
    return normalizeSnapshot(raw)
  },
}
