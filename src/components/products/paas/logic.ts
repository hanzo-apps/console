/**
 * Pure helpers for the PaaS (platform) surface — the app's live URL, build
 * derivation from deployments, and honest error classification. No I/O, no React,
 * unit-testable. The board (`PaasApplications.tsx`) is a thin shell over these.
 */
import { ApiError } from '~/lib/api/client'
import type { PaasApp, PaasDeployment, PaasDomain } from '~/lib/api/paas'

/** The app's primary live URL — the first domain, made absolute (https). Null when none. */
export function appUrl(app: Pick<PaasApp, 'domains'>): string | null {
  const d = (app.domains ?? []).map((x) => x?.trim()).find((x) => Boolean(x))
  if (!d) return null
  return /^https?:\/\//i.test(d) ? d : `https://${d}`
}

/** A one-line source descriptor: the git repo (+branch) or the image ref. */
export function appSource(app: Pick<PaasApp, 'source' | 'repo' | 'image'>): string {
  if (app.source === 'git' && app.repo?.url) {
    const repo = app.repo.url.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/, '')
    return app.repo.branch ? `${repo} @ ${app.repo.branch}` : repo
  }
  if (app.source === 'image' && app.image?.repository) {
    return app.image.tag ? `${app.image.repository}:${app.image.tag}` : app.image.repository
  }
  return app.source ?? '—'
}

/** A deployment is a BUILD when it came from git source or carries a build id. */
export function isBuildDeployment(d: Pick<PaasDeployment, 'source' | 'buildId'>): boolean {
  return d.source === 'git' || Boolean(d.buildId)
}

/** Deployments newest-first by version (the API already orders DESC; be defensive). */
export function orderDeployments(deployments: PaasDeployment[]): PaasDeployment[] {
  return [...deployments].sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
}

/** The build status for a deployment row (only meaningful for git builds). */
export function buildStatusOf(d: PaasDeployment): string | null {
  if (!isBuildDeployment(d)) return null
  // A live/deploying git deployment implies its build succeeded; else mirror status.
  if (d.status === 'live' || d.status === 'deploying') return 'succeeded'
  if (d.status === 'error') return 'failed'
  if (d.status === 'building' || d.status === 'queued') return d.status
  return d.status ?? null
}

/** A short id/version label for a deployment ("v3" when versioned, else a short id). */
export function deploymentLabel(d: PaasDeployment): string {
  if (typeof d.version === 'number') return `v${d.version}`
  return d.id ? d.id.slice(0, 8) : '—'
}

// ── domains ────────────────────────────────────────────────────────────────

/** A pending custom domain is one awaiting DNS ownership verification. */
export function isPendingCustom(d: Pick<PaasDomain, 'kind' | 'verified'>): boolean {
  return d.kind === 'custom' && !d.verified
}

/** The default host is canonical and permanent — it can never be removed. */
export function canRemoveDomain(d: Pick<PaasDomain, 'kind' | 'primary'>): boolean {
  return d.kind !== 'default' && !d.primary
}

/** A human, honest per-domain status label (drives the pill text + tone). */
export function domainStatusLabel(d: Pick<PaasDomain, 'status' | 'kind'>): string {
  switch (d.status) {
    case 'live':
      return 'live'
    case 'provisioning':
      return 'provisioning'
    case 'pending_deploy':
      return 'awaiting deploy'
    case 'pending':
      return d.kind === 'custom' ? 'unverified' : 'pending'
    default:
      return d.status || 'unknown'
  }
}

/**
 * Order domains for display: the primary/default host first, then subtree hosts,
 * then custom hosts, each group alphabetical. Pure + stable.
 */
export function orderDomains(domains: PaasDomain[]): PaasDomain[] {
  const rank = (d: PaasDomain): number =>
    d.primary || d.kind === 'default' ? 0 : d.kind === 'subtree' ? 1 : 2
  return [...domains].sort((a, b) => rank(a) - rank(b) || a.host.localeCompare(b.host))
}

export type PaasErrorKind = 'signin' | 'forbidden' | 'unavailable' | 'error'

/** Classify a `/cloud`-proxy error honestly (a signed-in user is never told to sign in). */
export function classifyPaasError(e: unknown): { kind: PaasErrorKind; message: string } {
  const status = e instanceof ApiError ? e.status : 0
  const message = e instanceof Error ? e.message : String(e)
  if (status === 401) return { kind: 'signin', message }
  if (status === 403) return { kind: 'forbidden', message }
  if (status === 404) return { kind: 'unavailable', message }
  return { kind: 'error', message }
}
