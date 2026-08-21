/**
 * Hanzo Builds — the typed client for the CI build history (`GET /v1/platform/builds`).
 *
 * One canonical reader for the native build records (git push → native Actions →
 * image → registry). Same-origin `/v1/platform/builds` through the user-bearer BFF (the
 * `platform` head is allow-listed in proxy-allow.ts); org is resolved server-side
 * from the Bearer owner, so a cookie-only call 403s and the caller renders an
 * honest state. Optional-safe normalizers tolerate snake_case + camelCase and
 * degrade a missing field to '' — never a fabricated build.
 *
 * The CD fleet map joins these to an application by image-repository basename
 * (`repoBaseName`) to fill the drawer's Deploys timeline and a node's deploy time.
 */
import { restGet, cloudProxyV1Url } from './client'

/** One CI build record. */
export interface Build {
  id: string
  /** The source repo (`owner/name` or a bare name). */
  repo: string
  /** The built commit sha. */
  commit: string
  /** The produced image tag / release version, when the record carries one. */
  tag: string
  /** Raw status string (queued|running|success|failed|…), verbatim. */
  status: string
  /** ISO start time; '' when unknown. */
  startedAt: string
  /** Preformatted duration, when present. */
  duration: string
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const pick = (r: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null) return r[k]
  return undefined
}

function normalizeBuild(raw: unknown): Build {
  const r = rec(raw)
  return {
    id: str(pick(r, 'id', 'buildId', 'build_id')),
    repo: str(pick(r, 'repo', 'repository', 'repoName', 'repo_name')),
    commit: str(pick(r, 'commit', 'sha', 'revision')),
    tag: str(pick(r, 'tag', 'version', 'imageTag', 'image_tag')),
    status: str(pick(r, 'status', 'phase', 'state', 'conclusion')),
    startedAt: str(pick(r, 'startedAt', 'started_at', 'createdAt', 'created_at', 'time')),
    duration: str(pick(r, 'duration', 'took')),
  }
}

export const BuildsApi = {
  /** Recent CI builds across the org (`GET /v1/platform/builds`). Honest-empty/403 until bound. */
  list: async (): Promise<Build[]> => {
    const data = await restGet<unknown>(cloudProxyV1Url('platform/builds'))
    const rows = Array.isArray(data) ? data : arr(pick(rec(data), 'builds', 'items', 'results'))
    return rows.map(normalizeBuild).filter((b) => b.id || b.commit || b.repo)
  },
}
