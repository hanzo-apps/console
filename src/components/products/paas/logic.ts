/**
 * Pure helpers for the PaaS (platform) surface — the app's live URL, build
 * derivation from deployments, and honest error classification. No I/O, no React,
 * unit-testable. The board (`PaasApplications.tsx`) is a thin shell over these.
 */
import { ApiError } from '~/lib/api/client'
import type { CreateAppInput, DeployInput, PaasApp, PaasDeployment, PaasDomain } from '~/lib/api/paas'

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

// ── Deploy targets (the "Deploy something new" composer) ─────────────────────
//
// One composer, three REAL targets that map onto the platform's own build
// strategies (`clients/platform` `buildTypes` = {nixpacks, dockerfile, static,
// buildpacks, image}). A target is purely a UX framing over `createApp`:
//   - service   → a git repo, auto-built (nixpacks) into a running container.
//   - static    → a git repo, built as a static site (buildType 'static').
//   - container → a prebuilt image, run as-is (source 'image').
// No invented targets — every one is a shape `PaasApi.createApp` accepts.

/** A deploy target the composer offers. */
export type DeployTarget = 'service' | 'static' | 'container'

/** Whether a target deploys from a Git repository (vs a prebuilt image). */
export const targetIsGit = (t: DeployTarget): boolean => t === 'service' || t === 'static'

/** The platform `buildType` for a target (the closed set the backend accepts). */
export function buildTypeFor(t: DeployTarget): 'nixpacks' | 'static' | 'image' {
  switch (t) {
    case 'static':
      return 'static'
    case 'container':
      return 'image'
    default:
      return 'nixpacks'
  }
}

/**
 * True when a string looks like a Git repository URL (https or scp-style ssh),
 * for a host the platform accepts (github/gitlab/bitbucket/gitea/codeberg) OR any
 * https URL ending `.git`. Pure + permissive — the backend re-validates the host
 * at the boundary, so this only drives the composer's Deploy-vs-Build affordance.
 */
export function looksLikeGitUrl(s: string): boolean {
  const v = s.trim()
  if (!v) return false
  // scp-style: git@github.com:owner/repo(.git)
  if (/^git@[\w.-]+:[\w.-]+\/[\w.-]+/.test(v)) return true
  if (!/^https?:\/\//i.test(v)) return false
  if (/\.git($|[?#])/i.test(v)) return true
  return /^https?:\/\/(www\.)?(github\.com|gitlab\.com|bitbucket\.org|gitea\.com|codeberg\.org)\/[\w.-]+\/[\w.-]+/i.test(v)
}

/**
 * True when a string looks like a container image reference (no URL scheme, a
 * registry/namespace path, optional :tag) — e.g. `ghcr.io/hanzoai/app:1.2.3` or
 * `nginx`. Pure; the composer uses it only to pick the right input semantics.
 */
export function looksLikeImageRef(s: string): boolean {
  const v = s.trim()
  if (!v || /\s/.test(v) || /^https?:\/\//i.test(v) || v.includes('://')) return false
  // A bare name (nginx) or a registry/namespace path, with an optional :tag / @digest.
  return /^[a-z0-9]([\w.-]*[a-z0-9])?(:\d+)?(\/[\w.-]+)*(:[\w][\w.-]*)?(@sha256:[a-f0-9]+)?$/i.test(v)
}

/** Split an image ref into `{ repository, tag }` (defaults tag to 'latest'). */
export function parseImageRef(ref: string): { repository: string; tag: string } {
  const v = ref.trim()
  const at = v.indexOf('@') // digest pins live after '@'
  const body = at >= 0 ? v.slice(0, at) : v
  const lastSlash = body.lastIndexOf('/')
  const lastColon = body.lastIndexOf(':')
  // A ':' after the last '/' is a tag (a ':' inside a registry host:port is not).
  if (lastColon > lastSlash) {
    return { repository: body.slice(0, lastColon), tag: body.slice(lastColon + 1) || 'latest' }
  }
  return { repository: body, tag: 'latest' }
}

/**
 * Derive a stable, k8s-safe app name from a repo URL or image ref: the last path
 * segment, lower-cased, non-alphanumerics collapsed to '-', trimmed. Empty input
 * (or all-symbol) yields '' so the caller keeps the user's own name.
 */
export function deriveAppName(input: string): string {
  const v = input.trim()
  if (!v) return ''
  const s = v
    .replace(/^https?:\/\//i, '') // scheme
    .replace(/^git@[\w.-]+:/i, '') // scp-style git@host:
    .replace(/[?#].*$/, '') // query / hash
    .replace(/@[^/@]+$/, '') // a trailing @digest / @ref (no '/' inside it)
    .replace(/\.git$/i, '') // trailing .git
  const segs = s.split('/').filter(Boolean)
  const tail = (segs[segs.length - 1] ?? '').replace(/:[\w.-]+$/, '') // drop an image :tag
  return tail
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

/** The `CreateAppInput` for a target + composer values (pure — no I/O). */
export function createAppInputFor(
  target: DeployTarget,
  v: { name: string; ref: string; branch?: string },
): CreateAppInput {
  const name = v.name.trim()
  if (target === 'container') {
    const { repository, tag } = parseImageRef(v.ref)
    return { name, source: 'image', image: { repository, tag }, buildType: 'image' }
  }
  return {
    name,
    source: 'git',
    repo: { url: v.ref.trim(), branch: (v.branch || 'main').trim() || 'main' },
    buildType: buildTypeFor(target),
  }
}

/** The `deploy` body for a target (image → pin the tag; git → build the ref). */
export function deployInputFor(target: DeployTarget, ref: string): DeployInput {
  if (target === 'container') return { tag: parseImageRef(ref).tag }
  return {}
}
