/**
 * Platform sites — the per-org STATIC-SITE engine (`hanzoai/cloud` clients/projectsvc,
 * exposed at **`/v1/projects/*`** — the SAME org-scoped store hanzo.app's builder
 * deploys to). This is the console HUB's deploy backend: create a site → upload a
 * zip/tar.gz static build → view deployments → bind custom domains.
 *
 * ONE SHARED KEY. A site is addressed by an org-unique `slug`; the HUB uses the IAM
 * project `name` AS the slug, so a project "my-app" deploys to the site "my-app" and
 * the SAME identifier deep-links to hanzo.app/hanzo.chat (`?project=my-app`). There is
 * no `svc` suffix and no second copy of project state.
 *
 * Transport: `cloudProxyV1Url('projects/...')` → the same-origin `/v1` user-bearer
 * BFF; org is server-authoritative from the Bearer `owner` claim (a cookie-only call
 * 403s). The `projects` head is allow-listed in `proxy-allow.ts`. The deploy artifact
 * is posted RAW (`restPostRaw`) so its binary bytes + Content-Type ride through the
 * proxy verbatim (never JSON-encoded).
 */
import {
  ApiError,
  cloudProxyV1Url,
  restGet,
  restPatch,
  restPost,
  restPostRaw,
} from './client'

export type SiteStatus = 'draft' | 'building' | 'live' | 'error' | (string & {})
export type DeploymentStatus =
  | 'queued'
  | 'building'
  | 'uploading'
  | 'live'
  | 'error'
  | (string & {})

/** A buildable/deployable static site (cloud `projectsProject`). */
export type Site = {
  id: string
  org: string
  slug: string
  name: string
  description?: string
  repo: { url?: string; branch?: string; provider?: string }
  framework: string
  status: SiteStatus
  liveUrl?: string
  bucket?: string
  currentDeploymentId?: string
  cacheControl?: string
  lastPurgeAt?: number
  createdAt: number
  updatedAt: number
}

/** One deploy of a site (cloud `projectsDeployment`). */
export type SiteDeployment = {
  id: string
  projectId: string
  version: number
  status: DeploymentStatus
  source: 'upload' | 'git' | (string & {})
  commit?: string
  liveUrl?: string
  bucket?: string
  prefix?: string
  files: number
  bytes: number
  message?: string
  createdAt: number
  updatedAt: number
}

export type CreateSiteInput = {
  name: string
  slug?: string
  description?: string
  framework?: string
  repo?: { url?: string; branch?: string }
}

export type UpdateSiteInput = {
  name?: string
  description?: string
  framework?: string
  cacheControl?: string
  repo?: { url?: string; branch?: string }
}

/** Build hints the pipeline understands ("static" = already built / no build step). */
export const SITE_FRAMEWORKS = [
  'static',
  'vite',
  'next',
  'react',
  'astro',
  'svelte',
  'vue',
  'remix',
  'nuxt',
] as const

/** Artifact media types the deploy endpoint content-sniffs (zip / gzip'd tar). */
export const ARTIFACT_ZIP = 'application/zip'
export const ARTIFACT_GZIP = 'application/gzip'

const seg = (s: string) => encodeURIComponent(s)
const base = (slug: string) => `projects/${seg(slug)}`

export const PlatformSitesApi = {
  /** Every site the caller's org owns (newest-updated first). Honest empty when none. */
  list: (): Promise<Site[]> => restGet<Site[]>(cloudProxyV1Url('projects')).then((r) => r ?? []),

  /** One site by slug, or null when it doesn't exist yet. */
  get: async (slug: string): Promise<Site | null> => {
    try {
      return (await restGet<Site>(cloudProxyV1Url(base(slug)))) ?? null
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },

  /** Create a site (`POST /v1/projects`). 201 → the new site; 409 → slug taken. */
  create: (input: CreateSiteInput): Promise<Site> =>
    restPost<Site>(cloudProxyV1Url('projects'), input) as Promise<Site>,

  update: (slug: string, patch: UpdateSiteInput): Promise<Site> =>
    restPatch<Site>(cloudProxyV1Url(base(slug)), patch) as Promise<Site>,

  /**
   * Ensure a deployable site exists for `slug` (the IAM project name). Create it if
   * missing; a 409 (already created by a prior deploy or another surface) or a race
   * both resolve to the existing record — idempotent, so "deploy" always has a target.
   */
  ensure: async (input: CreateSiteInput & { slug: string }): Promise<Site> => {
    const existing = await PlatformSitesApi.get(input.slug)
    if (existing) return existing
    try {
      return await PlatformSitesApi.create(input)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const s = await PlatformSitesApi.get(input.slug)
        if (s) return s
      }
      throw e
    }
  },

  /**
   * Deploy a BUILT static site: POST the raw zip/tar.gz bytes to
   * `/v1/projects/:slug/deploy`. Synchronous — returns the `live` deployment
   * (or an `error` one with a message). `contentType` is `ARTIFACT_ZIP`/`ARTIFACT_GZIP`;
   * cloud content-sniffs the real format by magic bytes regardless.
   */
  deploy: (
    slug: string,
    artifact: ArrayBuffer | Uint8Array | Blob,
    contentType: string,
  ): Promise<SiteDeployment> =>
    restPostRaw<SiteDeployment>(cloudProxyV1Url(`${base(slug)}/deploy`), artifact, contentType) as Promise<SiteDeployment>,

  listDeployments: (slug: string): Promise<SiteDeployment[]> =>
    restGet<SiteDeployment[]>(cloudProxyV1Url(`${base(slug)}/deployments`)).then((r) => r ?? []),

  getDeployment: async (slug: string, id: string): Promise<SiteDeployment | null> => {
    try {
      return (await restGet<SiteDeployment>(cloudProxyV1Url(`${base(slug)}/deployments/${seg(id)}`))) ?? null
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },

  /** Every public host bound to this site (its hanzo.app subdomain + custom domains). */
  listDomains: (slug: string): Promise<string[]> =>
    restGet<{ domains?: string[] }>(cloudProxyV1Url(`${base(slug)}/domains`)).then((r) => r?.domains ?? []),

  /**
   * Bind one or more custom hostnames (`POST .../domains`). Returns the just-`bound`
   * hosts + the full `domains` set. A SuperAdmin binds VERIFIED immediately; every
   * other caller has the host CLAIMED as pending and gets the DNS challenge back, so a
   * `bound` host is not yet a routing host until `.../domains/:host/verify` proves
   * control. A host another site holds is a 409 — never a fabricated binding.
   */
  bindDomains: (slug: string, domains: string[]): Promise<{ bound: string[]; domains: string[] }> =>
    restPost<{ bound?: string[]; domains?: string[] }>(cloudProxyV1Url(`${base(slug)}/domains`), { domains }).then(
      (r) => ({ bound: r?.bound ?? [], domains: r?.domains ?? [] }),
    ),
}
