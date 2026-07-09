/**
 * Platform hub — pure presentation/logic helpers (unit-tested, no React/network).
 * The hub's project is IAM-native (`ProjectApi`, keyed by `name`); its deploy state
 * comes from the cloud site store (`PlatformSitesApi`, slug === the IAM name). These
 * helpers format that data and classify a dropped deploy artifact.
 */
import { ARTIFACT_GZIP, ARTIFACT_ZIP, type SiteDeployment } from '~/lib/api/platform-sites'
import { slugifyProjectName } from '~/lib/products/cross-surface'

/** Artifact media types the deploy endpoint content-sniffs (re-exported from the ONE lib source). */
export { ARTIFACT_ZIP, ARTIFACT_GZIP }

/** Human-readable byte size (1024-based, one decimal past KB). */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`
}

/** A unix-seconds timestamp as a short local date-time, or '—' when absent/invalid. */
export function fmtWhen(unixSec?: number): string {
  if (!unixSec || !Number.isFinite(unixSec)) return '—'
  const d = new Date(unixSec * 1000)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

/** The site slug the hub deploys a project to: the IAM project name, slug-normalized. */
export function siteSlugForProject(projectName: string): string {
  return slugifyProjectName(projectName)
}

/** A bound host as a browsable https URL (the domains API returns bare hostnames). */
export function domainUrl(host: string): string {
  return `https://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/`
}

/** The newest deployment (highest version, else newest createdAt), or null. */
export function latestDeployment(list: SiteDeployment[]): SiteDeployment | null {
  if (!list.length) return null
  return [...list].sort((a, b) => b.version - a.version || b.createdAt - a.createdAt)[0]
}

/** A recognized deploy archive extension → its upload Content-Type, else null. */
export function artifactContentType(fileName: string): string | null {
  const n = fileName.toLowerCase()
  if (n.endsWith('.zip')) return ARTIFACT_ZIP
  if (n.endsWith('.tar.gz') || n.endsWith('.tgz') || n.endsWith('.gz')) return ARTIFACT_GZIP
  return null
}

/** True iff `fileName` is a deploy archive the hub accepts as a direct upload. */
export function isDeployArchive(fileName: string): boolean {
  return artifactContentType(fileName) != null
}

export type NameCheck = { ok: true; slug: string } | { ok: false; error: string }

/**
 * Validate a new project name → the slug it becomes (the IAM id + site slug + shared
 * deep-link key). Empty or all-symbol names are rejected with an honest reason.
 */
export function checkProjectName(name: string): NameCheck {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: 'Give the project a name.' }
  const slug = slugifyProjectName(trimmed)
  if (!slug) return { ok: false, error: 'Use letters or numbers — the name becomes a URL-safe id.' }
  return { ok: true, slug }
}
