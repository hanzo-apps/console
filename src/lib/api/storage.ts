/**
 * Storage API — the Hanzo S3 object-storage file manager.
 *
 * The unified cloud binary mounts an org-scoped `/v1/s3` file manager
 * (`hanzoai/cloud` clients/s3): buckets + objects over the shared SeaweedFS S3
 * gateway. Every request is org-scoped SERVER-SIDE from the caller's token owner
 * claim — the browser never supplies an org — so this client speaks only friendly
 * names ("photos") and the server maps them to the tenant's physical namespace.
 *
 * TRANSPORT — metadata operations (list buckets/objects, create/delete bucket,
 * delete object, mint a presigned URL) go through the same-origin `/v1`
 * user-bearer proxy (`cloudProxyV1Url` → the same-origin `/v1` bearer proxy,
 * which mints a short-lived user
 * token; `s3` is allow-listed in proxy-allow.ts). Plain REST (raw JSON / 201 /
 * 204), like the provisioning + functions facades.
 *
 * UPLOAD / DOWNLOAD — NOT streamed through the proxy. The `/v1` proxy buffers a
 * body as text and forces `Content-Type: application/json`, which would corrupt
 * binary. So the backend returns a PRESIGNED URL (time-boxed, scoped to the exact
 * bucket+key, signed against the public S3 host) and the browser transfers the
 * bytes DIRECTLY to S3 with a plain `fetch` — no large body through the Next
 * serverless runtime and the admin credential never leaves the server.
 *
 * Payloads are normalized DEFENSIVELY: a field rename upstream degrades a cell
 * rather than throwing. Nothing is fabricated — an unreachable/unconfigured
 * backend surfaces through `classifyBackend` as an honest state.
 */
import { restGet, restPost, restDelete, cloudProxyV1Url } from './client'

/** File-manager base path — canonical `/v1/s3` (rewritten to the same-origin `/v1`
 *  proxy → cloud-api). */
const BASE = 's3'
const enc = encodeURIComponent

// ── Coercion helpers (defensive) ─────────────────────────────────────────────
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const boolOf = (v: unknown): boolean => v === true

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Pull the first array found under any of the common envelope keys (or the root). */
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

// ── Domain types ─────────────────────────────────────────────────────────────

/** One bucket in the caller's namespace (friendly name). */
export type Bucket = {
  name: string
  /** Unix seconds; undefined when the backend omits it. */
  createdAt?: number
}

/**
 * One entry in an object listing. A folder (common prefix) has `isDir: true`,
 * `size: 0`, and a `key` ending in "/". `key` is RELATIVE to the requested prefix
 * so the UI renders a breadcrumb from the accumulated path.
 */
export type S3Object = {
  key: string
  isDir: boolean
  size?: number
  lastModified?: number
  etag?: string
}

/** A minted presigned URL the browser follows directly to S3. */
export type Presigned = {
  url: string
  method: 'PUT' | 'GET'
  key: string
  /** Seconds until the URL expires. */
  expiresIn?: number
}

// ── Normalizers (pure — unit-tested) ─────────────────────────────────────────

export function normalizeBucket(raw: unknown): Bucket | null {
  const r = asRecord(raw)
  const name = str(r.name)
  if (!name) return null
  return { name, createdAt: num(r.createdAt) ?? num(r.creationDate) }
}

export function normalizeBuckets(payload: unknown): Bucket[] {
  return arrayUnder(payload, ['buckets', 'items', 'data', 'rows'])
    .map(normalizeBucket)
    .filter((b): b is Bucket => b !== null)
}

export function normalizeObject(raw: unknown): S3Object | null {
  const r = asRecord(raw)
  const key = str(r.key) ?? str(r.name)
  if (!key) return null
  const isDir = boolOf(r.isDir) || key.endsWith('/')
  return {
    key,
    isDir,
    size: isDir ? 0 : num(r.size),
    lastModified: num(r.lastModified),
    etag: str(r.etag),
  }
}

export function normalizeObjects(payload: unknown): S3Object[] {
  return arrayUnder(payload, ['objects', 'items', 'contents', 'data', 'rows'])
    .map(normalizeObject)
    .filter((o): o is S3Object => o !== null)
}

export function normalizePresigned(payload: unknown): Presigned | null {
  const r = asRecord(payload)
  const url = str(r.url)
  if (!url) return null
  const method = str(r.method) === 'GET' ? 'GET' : 'PUT'
  return { url, method, key: str(r.key) ?? '', expiresIn: num(r.expiresIn) }
}

// ── API surface ──────────────────────────────────────────────────────────────

export const StorageApi = {
  /** List the caller's buckets (`GET /v1/s3/buckets`). Honest-empty on 200 with no rows. */
  buckets: (): Promise<Bucket[]> => restGet<unknown>(cloudProxyV1Url(`${BASE}/buckets`)).then(normalizeBuckets),

  /** Create a bucket (`POST /v1/s3/buckets`). */
  createBucket: (name: string): Promise<Bucket | null> =>
    restPost<unknown>(cloudProxyV1Url(`${BASE}/buckets`), { name }).then(normalizeBucket),

  /** Delete an EMPTY bucket (`DELETE /v1/s3/buckets/:bucket`). */
  deleteBucket: (bucket: string): Promise<void> =>
    restDelete(cloudProxyV1Url(`${BASE}/buckets/${enc(bucket)}`)),

  /**
   * List one folder level (`GET /v1/s3/buckets/:bucket/objects?prefix=`). Folder-
   * style by default (sub-prefixes come back as dir entries). `prefix` is the
   * current folder path (accumulated by the UI breadcrumb), "" for the root.
   */
  objects: (bucket: string, prefix = ''): Promise<S3Object[]> =>
    restGet<unknown>(
      cloudProxyV1Url(`${BASE}/buckets/${enc(bucket)}/objects${prefix ? `?prefix=${enc(prefix)}` : ''}`),
    ).then(normalizeObjects),

  /**
   * Mint a presigned PUT URL for an upload (`POST /v1/s3/buckets/:bucket/objects`).
   * The caller then PUTs the file bytes DIRECTLY to `url` (see `uploadTo`).
   */
  presignUpload: (bucket: string, key: string): Promise<Presigned | null> =>
    restPost<unknown>(cloudProxyV1Url(`${BASE}/buckets/${enc(bucket)}/objects`), { key }).then(normalizePresigned),

  /**
   * Mint a presigned GET URL for a download
   * (`GET /v1/s3/buckets/:bucket/objects/<key>`). The caller opens `url` directly.
   */
  presignDownload: (bucket: string, key: string): Promise<Presigned | null> =>
    restGet<unknown>(cloudProxyV1Url(`${BASE}/buckets/${enc(bucket)}/objects/${encodeKey(key)}`)).then(
      normalizePresigned,
    ),

  /** Delete one object (`DELETE /v1/s3/buckets/:bucket/objects/<key>`). */
  deleteObject: (bucket: string, key: string): Promise<void> =>
    restDelete(cloudProxyV1Url(`${BASE}/buckets/${enc(bucket)}/objects/${encodeKey(key)}`)),
}

/**
 * PUT a file's bytes DIRECTLY to a presigned URL (bypassing the console proxy and
 * the cloud binary). A plain fetch with the raw body — the presigned signature
 * authorizes exactly this bucket+key for the TTL window, so no credential is
 * needed here. Throws on a non-2xx so the caller can surface a real failure.
 */
export async function uploadTo(url: string, file: File | Blob): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    body: file,
    // No Authorization — the presigned URL carries the signature. No
    // Content-Type override: S3 accepts the browser's default; a mismatch would
    // break the signature if the presign fixed a content-type (it does not).
  })
  if (!res.ok) {
    throw new Error(`Upload failed (HTTP ${res.status})`)
  }
}

/**
 * Encode an object key for a URL PATH while PRESERVING "/" separators (a key may
 * be a nested path like "a/b/c.png"). Each segment is percent-encoded; the
 * slashes stay literal so the backend's /objects/* wildcard receives the real
 * nested path.
 */
export function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

/** Join a folder prefix and a name into a full key (no leading slash). */
export function joinKey(prefix: string, name: string): string {
  const p = prefix.replace(/^\/+/, '')
  return p ? `${p.replace(/\/+$/, '')}/${name}` : name
}
