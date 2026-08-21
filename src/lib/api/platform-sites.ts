/**
 * Platform sites — the per-org STATIC-SITE engine of the embedded PaaS
 * (`hanzoai/cloud` clients/projectsvc, exposed at **`/v1/projects/sites/*`** — the
 * SAME org-scoped store hanzo.app's builder deploys to). This is the console HUB's
 * deploy backend: create a site → upload a zip/tar.gz static build → view
 * deployments → bind custom domains.
 *
 * ONE SHARED KEY. A site is addressed by an org-unique `slug`; the HUB uses the IAM
 * project `name` AS the slug, so a project "my-app" deploys to the site "my-app" and
 * the SAME identifier deep-links to hanzo.app/hanzo.chat (`?project=my-app`). There is
 * no `svc` suffix and no second copy of project state.
 *
 * Transport: `cloudProxyV1Url('projects/...')` → the same-origin `/v1` user-bearer BFF;
 * org is server-authoritative from the Bearer `owner` claim (a cookie-only call 403s).
 * The `projects` head is allow-listed in `proxy-allow.ts`. The collection lives under
 * `projects/sites`; a site's OWN record, deployments and domains are the project's, so
 * they are addressed at `projects/:slug` — the per-slug twins under the sites path were
 * deleted rather than moved.
 * The deploy artifact is posted RAW (`restPostRaw`) so its binary bytes + Content-Type
 * ride through the proxy verbatim (never JSON-encoded).
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

/** A buildable/deployable static site (cloud `projectView`). */
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

/** One deploy of a site (cloud `deploymentView`). */
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
/** The site READ — "is it live yet?", answered whether or not anything is deployed. */
const site = (slug: string) => `projects/sites/${seg(slug)}`
/** The project a site IS: its record, its deployments, its domains. The per-slug twins
 *  under the sites path are gone, so every write and every sub-resource is addressed here. */
const project = (slug: string) => `projects/${seg(slug)}`

export const PlatformSitesApi = {
  /** Every site the caller's org owns (newest-updated first). Honest empty when none. */
  list: (): Promise<Site[]> =>
    restGet<Site[]>(cloudProxyV1Url('projects/sites')).then((r) => r ?? []),

  /** One site by slug, or null when it doesn't exist yet. */
  get: async (slug: string): Promise<Site | null> => {
    try {
      return (await restGet<Site>(cloudProxyV1Url(site(slug)))) ?? null
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },

  /** Create a site (`POST /v1/projects/sites`). 201 → the new site; 409 → slug taken. */
  create: (input: CreateSiteInput): Promise<Site> =>
    restPost<Site>(cloudProxyV1Url('projects/sites'), input) as Promise<Site>,

  update: (slug: string, patch: UpdateSiteInput): Promise<Site> =>
    restPatch<Site>(cloudProxyV1Url(project(slug)), patch) as Promise<Site>,

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
    restPostRaw<SiteDeployment>(cloudProxyV1Url(`${project(slug)}/deploy`), artifact, contentType) as Promise<SiteDeployment>,

  listDeployments: (slug: string): Promise<SiteDeployment[]> =>
    restGet<SiteDeployment[]>(cloudProxyV1Url(`${project(slug)}/deployments`)).then((r) => r ?? []),

  getDeployment: async (slug: string, id: string): Promise<SiteDeployment | null> => {
    try {
      return (await restGet<SiteDeployment>(cloudProxyV1Url(`${project(slug)}/deployments/${seg(id)}`))) ?? null
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },

  /** Every public host bound to this site (its hanzo.app subdomain + custom domains). */
  listDomains: (slug: string): Promise<string[]> =>
    restGet<{ domains?: string[] }>(cloudProxyV1Url(`${project(slug)}/domains`)).then((r) => r?.domains ?? []),

  /**
   * Bind one or more custom hostnames (`POST .../domains`). Returns the just-`bound`
   * hosts + the full `domains` set. NOTE: for a non-operator org this 403s honestly
   * ("requires ownership verification; a global admin or the platform-operator org may
   * bind it today") — the caller surfaces that, never fabricates a binding.
   */
  bindDomains: (slug: string, domains: string[]): Promise<{ bound: string[]; domains: string[] }> =>
    restPost<{ bound?: string[]; domains?: string[] }>(cloudProxyV1Url(`${project(slug)}/domains`), { domains }).then(
      (r) => ({ bound: r?.bound ?? [], domains: r?.domains ?? [] }),
    ),
}
