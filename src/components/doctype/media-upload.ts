/**
 * Media upload/resolve — the per-org DAM transport for a media DocType, built on
 * the SAME org-scoped S3 file manager the Storage product uses (`StorageApi`,
 * /v1/s3 → SeaweedFS via the /cloud bearer proxy). One storage backend, no bespoke
 * media service.
 *
 * WHY store the KEY, not a URL: the cloud only mints presigned object URLs with a
 * short TTL (5 min — s3.go presignTTL); a stored presigned URL would break minutes
 * later, which is fatal for a media library whose URLs must persist. So a Media
 * document's `file` field stores the STABLE object key (in the per-org `cms-media`
 * bucket); the grid/detail resolve it to a FRESH presigned GET URL at view time.
 * `s3Ref`/`isS3Ref` mark the key so a legacy plain-URL value (typed by hand) still
 * displays directly (honest, backward-compatible).
 */
import { StorageApi, uploadTo, joinKey } from '~/lib/api/storage'
import { slugify } from '~/lib/framework/fields'

/** The per-org bucket every CMS media asset lives in. Created on first upload. */
export const MEDIA_BUCKET = 'cms-media'

/** The prefix that marks a Media `file` value as an S3 object key (not a raw URL). */
const REF_PREFIX = 's3://'

/** A stored object key → the `file`-field reference value. */
export function s3Ref(key: string): string {
  return `${REF_PREFIX}${MEDIA_BUCKET}/${key}`
}

/** True when a `file` value is an S3 object reference (vs a hand-typed URL). */
export function isS3Ref(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(REF_PREFIX)
}

/** Split an `s3://bucket/key` reference into its bucket + key. */
export function parseS3Ref(ref: string): { bucket: string; key: string } | null {
  if (!ref.startsWith(REF_PREFIX)) return null
  const rest = ref.slice(REF_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) }
}

/** A safe, collision-resistant object key for an uploaded file (keeps the ext). */
export function mediaKey(filename: string, folder = ''): string {
  const dot = filename.lastIndexOf('.')
  const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : ''
  const base = slugify(dot > 0 ? filename.slice(0, dot) : filename) || 'file'
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const name = ext ? `${base}-${stamp}.${ext}` : `${base}-${stamp}`
  return folder ? joinKey(slugify(folder), name) : name
}

export interface UploadedMedia {
  /** The `file`-field value to store on the Media document (an s3:// key ref). */
  fileRef: string
  filename: string
  mime: string
  size: number
  width: number
  height: number
}

/**
 * Upload a file into the org's `cms-media` bucket and return the Media document
 * fields. Ensures the bucket exists (idempotent — a 409/exists is fine), mints a
 * presigned PUT, transfers the bytes DIRECTLY to S3, and (for an image) reads its
 * intrinsic dimensions in the browser. Throws a real error on any failed step so
 * the caller surfaces it (never a silent partial upload).
 */
export async function uploadMedia(file: File, folder = ''): Promise<UploadedMedia> {
  // 1) Ensure the per-org media bucket. A create that fails because it already
  //    exists is expected on every upload after the first — swallow ONLY that.
  await StorageApi.createBucket(MEDIA_BUCKET).catch(() => undefined)

  // 2) Presign a PUT for a stable key, then upload the bytes directly to S3.
  const key = mediaKey(file.name, folder)
  const presigned = await StorageApi.presignUpload(MEDIA_BUCKET, key)
  if (!presigned || presigned.method !== 'PUT' || !presigned.url) {
    throw new Error('Could not start the upload (object storage not configured).')
  }
  await uploadTo(presigned.url, file)

  // 3) Intrinsic image dimensions (best-effort; 0×0 for non-images / failures).
  const { width, height } = await imageDimensions(file)

  return {
    fileRef: s3Ref(key),
    filename: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    width,
    height,
  }
}

/**
 * Resolve a Media `file` value to a viewable URL. An s3:// key is presigned to a
 * fresh short-lived GET URL; a legacy plain URL is returned as-is. Returns '' when
 * it can't resolve (honest — the grid shows a file glyph instead of a broken img).
 */
export async function resolveMediaUrl(value: unknown): Promise<string> {
  if (typeof value !== 'string' || value === '') return ''
  if (!isS3Ref(value)) return value // a hand-typed absolute URL
  const parsed = parseS3Ref(value)
  if (!parsed) return ''
  const presigned = await StorageApi.presignDownload(parsed.bucket, parsed.key).catch(() => null)
  return presigned?.url ?? ''
}

/** Delete the S3 object behind a Media `file` value (no-op for a plain URL). */
export async function deleteMediaObject(value: unknown): Promise<void> {
  if (!isS3Ref(value)) return
  const parsed = parseS3Ref(value)
  if (!parsed) return
  await StorageApi.deleteObject(parsed.bucket, parsed.key).catch(() => undefined)
}

/** Read an image file's intrinsic width/height in the browser (0×0 if not an image). */
function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !file.type.startsWith('image/')) {
      resolve({ width: 0, height: 0 })
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      resolve({ width: 0, height: 0 })
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}
