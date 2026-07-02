/**
 * PaasApi — the org's Hanzo PaaS (container-app platform), the LIVE per-org
 * `/v1/platform/*` surface on cloud (`clients/platform`). Projects → apps →
 * deployments (git BuildKit builds or image deploys), all reconciled to operator
 * Service CRs.
 *
 * Transport mirrors `functions.ts`: the `/cloud` bearer proxy via
 * `cloudProxyV1Url` — the browser sends only its session cookie, the proxy mints a
 * short-lived user IAM Bearer and forwards it; cloud's `SanitizeIdentity` resolves
 * the org from the Bearer OWNER claim and pins every read/write to it, so the
 * caller only ever sees THEIR org's projects/apps (backend-enforced; the console
 * just displays). These endpoints return PLAIN JSON (arrays/objects), NOT the
 * casibase `{status,msg,data}` envelope — so we use the `rest*` transport and
 * normalize defensively (a bare array OR a `{projects|apps|deployments:[…]}` wrap).
 */
import { restGet, restPost, restDelete, cloudProxyV1Url } from './client'

const BASE = 'platform'
const enc = encodeURIComponent

/** A deploy project (a grouping of apps), `projectView`. */
export interface PaasProject {
  id: string
  org: string
  slug: string
  name: string
  description?: string
  /** Number of apps in the project. */
  applications?: number
  createdAt?: number
  updatedAt?: number
}

/** A key/value app env pair; a secret value is masked ("") on read. */
export interface PaasEnvVar {
  key: string
  value: string
  secret?: boolean
}

/** A deployed app, `appView`. `phase`/`health` are live from the operator CR. */
export interface PaasApp {
  id: string
  org: string
  projectId: string
  slug: string
  name: string
  description?: string
  environment?: string
  /** How the app builds/deploys. */
  source?: 'git' | 'image' | (string & {})
  repo?: { url?: string; branch?: string; provider?: string }
  image?: { repository?: string; tag?: string }
  buildType?: string
  env?: PaasEnvVar[]
  port?: number
  replicas?: number
  domains?: string[]
  /** draft | building | deploying | live | stopped | error. */
  status?: string
  namespace?: string
  currentDeploymentId?: string
  /** Live operator phase/health (present on getApp / a live|deploying app). */
  phase?: string
  health?: string
  createdAt?: number
  updatedAt?: number
}

/** One deployment of an app, `deploymentView` (monotonic `version` per app). */
export interface PaasDeployment {
  id: string
  org: string
  applicationId: string
  version?: number
  /** building | deploying | live | error | superseded (design also: queued|canceled). */
  status?: string
  source?: string
  commit?: string
  image?: string
  buildId?: string
  message?: string
  createdAt?: number
  updatedAt?: number
}

/** An app carrying its project context (for the aggregate Applications board). */
export interface PaasAppWithProject extends PaasApp {
  project: PaasProject
}

export interface CreateProjectInput {
  name: string
  slug?: string
  description?: string
}

export interface CreateAppInput {
  name: string
  slug?: string
  description?: string
  environment?: string
  source: 'git' | 'image'
  repo?: { url: string; branch?: string }
  image?: { repository: string; tag?: string }
  buildType?: string
  port?: number
  replicas?: number
  env?: PaasEnvVar[]
  domains?: string[]
}

/** Deploy inputs: a git ref to build, or an image tag to apply. Body is optional. */
export interface DeployInput {
  commit?: string
  tag?: string
}

/** Pull a list from a bare array OR a `{ <key>: [...] }` wrapper (defensive). */
function asArray<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object') {
    const v = (payload as Record<string, unknown>)[key]
    if (Array.isArray(v)) return v as T[]
    const data = (payload as Record<string, unknown>).data
    if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>)[key])) {
      return (data as Record<string, unknown>)[key] as T[]
    }
  }
  return []
}

/** Unwrap a single object from a bare object OR a `{ <key>: {...} }` wrapper. */
function asObject<T>(payload: unknown, key: string): T {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const v = (payload as Record<string, unknown>)[key]
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as T
  }
  return payload as T
}

const projectsPath = (p?: string) => (p ? `${BASE}/projects/${enc(p)}` : `${BASE}/projects`)
const appsPath = (p: string, a?: string) =>
  a ? `${projectsPath(p)}/apps/${enc(a)}` : `${projectsPath(p)}/apps`
const deploysPath = (p: string, a: string, id?: string) =>
  id ? `${appsPath(p, a)}/deployments/${enc(id)}` : `${appsPath(p, a)}/deployments`

export const PaasApi = {
  // ── Projects ──────────────────────────────────────────────────────────────
  listProjects: (): Promise<PaasProject[]> =>
    restGet<unknown>(cloudProxyV1Url(projectsPath())).then((p) => asArray<PaasProject>(p, 'projects')),
  getProject: (project: string): Promise<PaasProject> =>
    restGet<unknown>(cloudProxyV1Url(projectsPath(project))).then((p) => asObject<PaasProject>(p, 'project')),
  createProject: (input: CreateProjectInput): Promise<PaasProject> =>
    restPost<unknown>(cloudProxyV1Url(projectsPath()), input).then((p) => asObject<PaasProject>(p, 'project')),
  deleteProject: (project: string): Promise<void> => restDelete(cloudProxyV1Url(projectsPath(project))),

  // ── Apps ──────────────────────────────────────────────────────────────────
  listApps: (project: string): Promise<PaasApp[]> =>
    restGet<unknown>(cloudProxyV1Url(appsPath(project))).then((p) => asArray<PaasApp>(p, 'apps')),
  getApp: (project: string, app: string): Promise<PaasApp> =>
    restGet<unknown>(cloudProxyV1Url(appsPath(project, app))).then((p) => asObject<PaasApp>(p, 'app')),
  createApp: (project: string, input: CreateAppInput): Promise<PaasApp> =>
    restPost<unknown>(cloudProxyV1Url(appsPath(project)), input).then((p) => asObject<PaasApp>(p, 'app')),
  deleteApp: (project: string, app: string): Promise<void> =>
    restDelete(cloudProxyV1Url(appsPath(project, app))),
  deploy: (project: string, app: string, input: DeployInput = {}): Promise<PaasDeployment> =>
    restPost<unknown>(cloudProxyV1Url(`${appsPath(project, app)}/deploy`), input).then((p) =>
      asObject<PaasDeployment>(p, 'deployment'),
    ),
  stop: (project: string, app: string): Promise<PaasApp> =>
    restPost<unknown>(cloudProxyV1Url(`${appsPath(project, app)}/stop`), {}).then((p) => asObject<PaasApp>(p, 'app')),
  start: (project: string, app: string): Promise<PaasApp> =>
    restPost<unknown>(cloudProxyV1Url(`${appsPath(project, app)}/start`), {}).then((p) => asObject<PaasApp>(p, 'app')),

  // ── Deployments (history = releases; builds derive from git-source deployments) ──
  listDeployments: (project: string, app: string): Promise<PaasDeployment[]> =>
    restGet<unknown>(cloudProxyV1Url(deploysPath(project, app))).then((p) => asArray<PaasDeployment>(p, 'deployments')),
  getDeployment: (project: string, app: string, id: string): Promise<PaasDeployment> =>
    restGet<unknown>(cloudProxyV1Url(deploysPath(project, app, id))).then((p) => asObject<PaasDeployment>(p, 'deployment')),
  deploymentLogs: (project: string, app: string, id: string): Promise<string> =>
    restGet<{ logs?: string }>(cloudProxyV1Url(`${deploysPath(project, app, id)}/logs`)).then((r) => r?.logs ?? ''),

  /**
   * The org's ENTIRE app fleet with project context — the aggregate the
   * Applications board renders. Lists projects, then each project's apps, and
   * flattens; a per-project failure degrades that project to zero apps rather
   * than blanking the whole board.
   */
  listAllApps: async (): Promise<PaasAppWithProject[]> => {
    const projects = await PaasApi.listProjects()
    const perProject = await Promise.all(
      projects.map((project) =>
        PaasApi.listApps(project.slug || project.id)
          .then((apps) => apps.map((app) => ({ ...app, project })))
          .catch(() => [] as PaasAppWithProject[]),
      ),
    )
    return perProject.flat()
  },
}
