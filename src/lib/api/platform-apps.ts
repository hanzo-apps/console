/**
 * Typed client for the per-org **Hanzo PaaS** — cloud's native `/v1/platform/*`
 * control plane (`hanzoai/cloud` clients/platform). This is the USER-facing PaaS:
 * a signed-in org member manages their OWN projects → container apps (deploy,
 * logs, env, domains), scoped to their org by the Bearer owner claim server-side.
 *
 * It is DISTINCT from `lib/api/platform.ts` (`PlatformApi.apps()` — the ADMIN
 * fleet drift board over the `/paas` proxy) and from the casibase
 * `applications` OAuth admin. cloud's `/v1/platform` speaks PLAIN REST (raw JSON,
 * not the casibase `{status,msg,data}` envelope), so this uses the `restGet/
 * restPost/restPut/restDelete` layer.
 *
 * Transport: `cloudProxyV1Url('platform/...')` builds `<origin>/v1/platform/...`,
 * which `next.config.mjs` rewrites to the hardened `/v1` bearer proxy (mints a
 * short-lived user token, org from its owner claim). The raw session cookie never
 * reaches cloud-api. `platform` is allow-listed in `proxy-allow.ts` CLOUD_HEADS.
 */
import { ApiError, cloudProxyV1Url, restDelete, restGet, restPost, restPut } from './client'

export type PlatformEnvVar = { key: string; value: string; secret: boolean }

export type PlatformProject = {
  id: string
  org: string
  slug: string
  name: string
  description?: string
  applications: number
  createdAt: number
  updatedAt: number
}

export type PlatformApp = {
  id: string
  org: string
  projectId: string
  slug: string
  name: string
  description?: string
  environment: string
  source: string // git | image
  repo: { url?: string; branch?: string; provider?: string }
  image: { repository?: string; tag?: string }
  buildType?: string
  env: PlatformEnvVar[]
  port: number
  replicas: number
  domains: string[]
  status: string
  namespace?: string
  currentDeploymentId?: string
  phase?: string
  health?: string
  secretSync?: string // ''|pending|syncing|ready|failed
  secretSyncDetail?: string
  createdAt: number
  updatedAt: number
  /** Client-side join: the project this app belongs to (for the flat list). */
  projectSlug?: string
}

export type PlatformDeployment = {
  id: string
  applicationId: string
  version: number
  status: string
  source: string
  commit?: string
  image?: string
  buildId?: string
  message?: string
  createdAt: number
  updatedAt: number
}

export type PlatformDnsRecord = { type: string; name: string; value: string }

export type PlatformDomain = {
  host: string
  kind: string // default | subtree | custom
  status: string // live | provisioning | pending_deploy | pending
  url: string
  verified: boolean
  primary?: boolean
  records?: PlatformDnsRecord[]
  detail?: string
  createdAt?: number
}

export type PlatformDeploymentLogs = {
  deploymentId: string
  source: string // build | app | none
  logs: string
}

/** One row of a software bill of materials (SBOM) — a resolved dependency. */
export type SbomComponent = {
  name: string
  version: string
  type: string
  purl: string
  license: string
}

/**
 * The SBOM recorded for a container image (`GET /v1/sbom/{ref}`, cloud clients/sbom).
 * Published by CI on release and tracked in the datastore, keyed by image digest;
 * a lookup for an un-released image simply has none (404 -> null at the client).
 */
export type Sbom = {
  imageDigest: string
  imageRef: string
  sourceRepo: string
  gitSha: string
  ingestedAt: string // RFC3339
  componentCount: number
  components: SbomComponent[]
}

const seg = (s: string) => encodeURIComponent(s)
const appBase = (project: string, app: string) =>
  `platform/projects/${seg(project)}/apps/${seg(app)}`

export const PlatformAppsApi = {
  listProjects: (): Promise<PlatformProject[]> =>
    restGet<PlatformProject[]>(cloudProxyV1Url('platform/projects')).then((r) => r ?? []),

  listApps: (project: string): Promise<PlatformApp[]> =>
    restGet<PlatformApp[]>(cloudProxyV1Url(`platform/projects/${seg(project)}/apps`)).then((r) => r ?? []),

  /**
   * Every app the caller's org owns, flattened across its projects (newest first),
   * each tagged with its `projectSlug`. The org-wide app inventory the PaaS module
   * and the unified resource overview both render — one read, one place.
   */
  listAllApps: async (): Promise<PlatformApp[]> => {
    const projects = await PlatformAppsApi.listProjects()
    const perProject = await Promise.all(
      projects.map(async (p) => (await PlatformAppsApi.listApps(p.slug)).map((a) => ({ ...a, projectSlug: p.slug }))),
    )
    return perProject.flat().sort((a, b) => b.updatedAt - a.updatedAt)
  },

  getApp: (project: string, app: string): Promise<PlatformApp> =>
    restGet<PlatformApp>(cloudProxyV1Url(appBase(project, app))) as Promise<PlatformApp>,

  deploy: (project: string, app: string, body?: { tag?: string; commit?: string }): Promise<PlatformDeployment> =>
    restPost<PlatformDeployment>(cloudProxyV1Url(`${appBase(project, app)}/deploy`), body ?? {}) as Promise<PlatformDeployment>,

  stop: (project: string, app: string): Promise<PlatformApp> =>
    restPost<PlatformApp>(cloudProxyV1Url(`${appBase(project, app)}/stop`)) as Promise<PlatformApp>,

  start: (project: string, app: string): Promise<PlatformApp> =>
    restPost<PlatformApp>(cloudProxyV1Url(`${appBase(project, app)}/start`)) as Promise<PlatformApp>,

  listDeployments: (project: string, app: string): Promise<PlatformDeployment[]> =>
    restGet<PlatformDeployment[]>(cloudProxyV1Url(`${appBase(project, app)}/deployments`)).then((r) => r ?? []),

  deploymentLogs: (project: string, app: string, id: string): Promise<PlatformDeploymentLogs> =>
    restGet<PlatformDeploymentLogs>(cloudProxyV1Url(`${appBase(project, app)}/deployments/${seg(id)}/logs`)) as Promise<PlatformDeploymentLogs>,

  /**
   * The SBOM recorded for an image ref (`repository:tag`) or digest (`sha256:…`).
   * Returns null on 404 (no SBOM recorded yet — expected for un-released images, so
   * NOT an error); throws on any other non-200 (e.g. 503 datastore-unavailable).
   */
  sbom: async (imageRef: string): Promise<Sbom | null> => {
    try {
      return (await restGet<Sbom>(cloudProxyV1Url(`sbom/${seg(imageRef)}`))) ?? null
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },

  setEnv: (project: string, app: string, env: PlatformEnvVar[]): Promise<PlatformApp> =>
    restPut<PlatformApp>(cloudProxyV1Url(`${appBase(project, app)}/env`), { env }) as Promise<PlatformApp>,

  listDomains: (project: string, app: string): Promise<PlatformDomain[]> =>
    restGet<PlatformDomain[]>(cloudProxyV1Url(`${appBase(project, app)}/domains`)).then((r) => r ?? []),

  addDomain: (project: string, app: string, host: string): Promise<PlatformDomain> =>
    restPost<PlatformDomain>(cloudProxyV1Url(`${appBase(project, app)}/domains`), { host }) as Promise<PlatformDomain>,

  verifyDomain: (project: string, app: string, host: string): Promise<PlatformDomain> =>
    restPost<PlatformDomain>(cloudProxyV1Url(`${appBase(project, app)}/domains/${seg(host)}/verify`)) as Promise<PlatformDomain>,

  removeDomain: (project: string, app: string, host: string): Promise<void> =>
    restDelete(cloudProxyV1Url(`${appBase(project, app)}/domains/${seg(host)}`)),
}
