/**
 * Content (Payload CMS) API — the NATIVE console read of the brand's Content Studio
 * collections, over the console's OWN same-origin user-bearer `/cms` proxy
 * (`<origin>/cms/api/<collection>`). The proxy mints a short-lived user IAM Bearer and
 * forwards it to `cms.<brand>`; Payload's multi-tenant plugin scopes every row to the
 * token's `owner` claim, so each org reads ONLY its own pages/media — org isolation is
 * BACKEND-enforced (never a browser-supplied org). No credential reaches the browser.
 *
 * This is the NATIVE half of the Content product (Collections list + Media/DAM grid);
 * the full block editor stays the embedded Studio (`CmsModule` Studio tab). We do NOT
 * reimplement Payload — we read its real REST API. Payload returns its standard
 * paginated envelope `{ docs, totalDocs, ... }`; rows are normalized DEFENSIVELY (a
 * field rename degrades a cell to "—", never throws) and an empty tenant renders an
 * honest empty state, never a placeholder.
 */
import { restGet } from './client'

/** The console's OWN same-origin CMS proxy base (`<origin>/cms`). */
const cmsBase = (): string => (typeof window !== 'undefined' ? `${window.location.origin}/cms` : '/cms')

/** A Payload REST URL on the `/cms` proxy (`<origin>/cms/api/<path>`). */
const cmsApiUrl = (path: string): string => `${cmsBase()}/api/${path.replace(/^\/+/, '')}`

/**
 * The console-proxied URL for a media file's bytes. Payload serves media at
 * `/api/media/file/<filename>` with the SAME per-tenant access control as the JSON, so
 * an `<img>` must point at this proxy route (which forwards the bearer) — never at the
 * cross-origin, auth-required `media.url` directly. Filenames are slugified by Payload
 * (no spaces/encoding needed); a `<img>` load failure is an honest broken image, never
 * a fabricated one.
 */
export const cmsMediaFileUrl = (filename: string): string =>
  filename ? `${cmsBase()}/api/media/file/${filename}` : ''

/**
 * The console-proxied `<img>` src for a media asset. PREFERS the doc's real `url` — it
 * carries the `?prefix=<tenant>` query the multi-tenant storage needs to resolve the bytes
 * (dropping it 404s / mis-resolves) — routed through the OWN-origin `/cms` proxy (take the
 * `/api/...` path+query from a relative OR absolute url; never load the cross-origin,
 * auth-required cms host directly). Falls back to reconstructing from the filename.
 */
export const cmsMediaSrc = (media: { url?: string; filename?: string }): string => {
  const u = media.url
  if (u) {
    const apiIdx = u.indexOf('/api/')
    if (apiIdx >= 0) return `${cmsBase()}${u.slice(apiIdx)}`
  }
  return media.filename ? cmsMediaFileUrl(media.filename) : ''
}

// ── Defensive coercion ───────────────────────────────────────────────────────
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const pick = (r: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const k of keys) { const s = str(r[k]); if (s) return s }
  return undefined
}

/** Payload's paginated envelope — the `docs` array is the rows, `totalDocs` the count. */
export type CmsList<T> = { rows: T[]; total: number }

const listFrom = <T,>(payload: unknown, normalize: (r: Record<string, unknown>) => T): CmsList<T> => {
  const r = asRecord(payload)
  const docs = Array.isArray(r.docs) ? r.docs : Array.isArray(payload) ? (payload as unknown[]) : []
  const rows = docs.filter((x) => x && typeof x === 'object').map((x) => normalize(x as Record<string, unknown>))
  return { rows, total: num(r.totalDocs) ?? rows.length }
}

// ── Domain types ─────────────────────────────────────────────────────────────

/** A Content page (the `pages` collection). */
export type CmsPage = {
  id: string
  title: string
  slug?: string
  /** draft | published (Payload `_status`). */
  status?: string
  updatedAt?: string
  createdAt?: string
}

/** A media asset (the `media` collection — the DAM grid). */
export type CmsMedia = {
  id: string
  filename?: string
  mimeType?: string
  filesize?: number
  width?: number
  height?: number
  alt?: string
  /** Payload's bytes URL (`/api/media/file/<f>?prefix=<tenant>`) — proxy via `cmsMediaSrc`. */
  url?: string
  createdAt?: string
}

// ── Normalizers (pure — exported for unit tests) ─────────────────────────────

/** Stable string id — Payload on SQLite uses INTEGER ids (`{"id":3}`), so coerce a number
 *  (or string) to a string; falls back to '' only when truly absent. */
const idStr = (r: Record<string, unknown>): string => {
  const v = r.id ?? r._id
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : (str(v) ?? '')
}

export const normalizePage = (raw: Record<string, unknown>): CmsPage => ({
  id: idStr(raw),
  title: pick(raw, ['title', 'name', 'slug']) ?? '(untitled)',
  slug: pick(raw, ['slug']),
  status: pick(raw, ['_status', 'status']),
  updatedAt: pick(raw, ['updatedAt', 'updated_at']),
  createdAt: pick(raw, ['createdAt', 'created_at']),
})

export const normalizeMedia = (raw: Record<string, unknown>): CmsMedia => ({
  id: idStr(raw),
  filename: pick(raw, ['filename', 'name']),
  mimeType: pick(raw, ['mimeType', 'mime_type']),
  filesize: num(raw.filesize),
  width: num(raw.width),
  height: num(raw.height),
  alt: pick(raw, ['alt']),
  url: pick(raw, ['url']),
  createdAt: pick(raw, ['createdAt', 'created_at']),
})

/** CmsApi — read the brand's tenant-scoped Content collections. `depth=0` keeps the
 *  payload flat (relations as ids, not expanded), so the transport stays small. */
export const CmsApi = {
  pages: (limit = 100): Promise<CmsList<CmsPage>> =>
    restGet<unknown>(cmsApiUrl(`pages?limit=${limit}&depth=0&sort=-updatedAt`)).then((p) => listFrom(p, normalizePage)),
  media: (limit = 100): Promise<CmsList<CmsMedia>> =>
    restGet<unknown>(cmsApiUrl(`media?limit=${limit}&depth=0&sort=-createdAt`)).then((p) => listFrom(p, normalizeMedia)),
}
