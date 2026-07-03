/**
 * Typed client for the per-org **Hanzo PaaS** — cloud's native `/v1/platform/*`
 * control plane (`hanzoai/cloud` clients/platform). This is the USER-facing PaaS:
 * a signed-in org member manages their OWN projects → container apps (deploy,
 * logs, env, domains), scoped to their org by the Bearer owner claim server-side.
 *
 * It is DISTINCT from `lib/api/platform.ts` (`PlatformApi.apps()` — the ADMIN
 * fleet drift board over `platform.hanzo.ai/v1/apps`) and from the casibase
 * `applications` OAuth admin. cloud's `/v1/platform` speaks PLAIN REST (raw JSON,
 * not the casibase `{status,msg,data}` envelope), so this uses the `restGet/
 * restPost/restPut/restDelete` layer.
 *
 * Transport: `originV1Url('platform/...')` builds `<origin>/v1/platform/...`,
 * which `next.config.mjs` rewrites to the hardened `/cloud` bearer proxy (mints a
 * short-lived user token, org from its owner claim). The raw session cookie never
 * reaches cloud-api. `platform` is allow-listed in `proxy-allow.ts` CLOUD_HEADS.
 */
import { originV1Url, restDelete, restGet, restPost, restPut } from './client'

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

const seg = (s: string) => encodeURIComponent(s)
const appBase = (project: string, app: string) =>
  `platform/projects/${seg(project)}/apps/${seg(app)}`

export const PlatformAppsApi = {
  listProjects: (): Promise<PlatformProject[]> =>
    restGet<PlatformProject[]>(originV1Url('platform/projects')).then((r) => r ?? []),

  listApps: (project: string): Promise<PlatformApp[]> =>
    restGet<PlatformApp[]>(originV1Url(`platform/projects/${seg(project)}/apps`)).then((r) => r ?? []),

  getApp: (project: string, app: string): Promise<PlatformApp> =>
    restGet<PlatformApp>(originV1Url(appBase(project, app))) as Promise<PlatformApp>,

  deploy: (project: string, app: string, body?: { tag?: string; commit?: string }): Promise<PlatformDeployment> =>
    restPost<PlatformDeployment>(originV1Url(`${appBase(project, app)}/deploy`), body ?? {}) as Promise<PlatformDeployment>,

  stop: (project: string, app: string): Promise<PlatformApp> =>
    restPost<PlatformApp>(originV1Url(`${appBase(project, app)}/stop`)) as Promise<PlatformApp>,

  start: (project: string, app: string): Promise<PlatformApp> =>
    restPost<PlatformApp>(originV1Url(`${appBase(project, app)}/start`)) as Promise<PlatformApp>,

  listDeployments: (project: string, app: string): Promise<PlatformDeployment[]> =>
    restGet<PlatformDeployment[]>(originV1Url(`${appBase(project, app)}/deployments`)).then((r) => r ?? []),

  deploymentLogs: (project: string, app: string, id: string): Promise<PlatformDeploymentLogs> =>
    restGet<PlatformDeploymentLogs>(originV1Url(`${appBase(project, app)}/deployments/${seg(id)}/logs`)) as Promise<PlatformDeploymentLogs>,

  setEnv: (project: string, app: string, env: PlatformEnvVar[]): Promise<PlatformApp> =>
    restPut<PlatformApp>(originV1Url(`${appBase(project, app)}/env`), { env }) as Promise<PlatformApp>,

  listDomains: (project: string, app: string): Promise<PlatformDomain[]> =>
    restGet<PlatformDomain[]>(originV1Url(`${appBase(project, app)}/domains`)).then((r) => r ?? []),

  addDomain: (project: string, app: string, host: string): Promise<PlatformDomain> =>
    restPost<PlatformDomain>(originV1Url(`${appBase(project, app)}/domains`), { host }) as Promise<PlatformDomain>,

  verifyDomain: (project: string, app: string, host: string): Promise<PlatformDomain> =>
    restPost<PlatformDomain>(originV1Url(`${appBase(project, app)}/domains/${seg(host)}/verify`)) as Promise<PlatformDomain>,

  removeDomain: (project: string, app: string, host: string): Promise<void> =>
    restDelete(originV1Url(`${appBase(project, app)}/domains/${seg(host)}`)),
}
