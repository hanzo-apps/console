/**
 * Apps API — the org's BUILDABLE SITES store (cloud `clients/projectsvc`), the
 * projects hanzo.app publishes when a user ships a site from the conversational
 * builder. Each "app" is a deployed static/SSR site with a live URL and a versioned
 * deployment history (S3-backed, Cloudflare-fronted).
 *
 * Every call is same-origin, keyless and prefix-free (`originV1Url('projects')` →
 * `<origin>/v1/projects`, the CTO one-endpoint form). `next.config.mjs` rewrites the
 * `projects` head to the console's OWN user-bearer `/cloud` proxy, which mints a
 * short-lived user-bound IAM token server-side and forwards it; the projectsvc
 * handler resolves the org from the token's `owner` claim, so every read is
 * org-scoped SERVER-SIDE and no credential reaches the browser. A cookie-only
 * cloud-origin call would 403 ("X-Org-Id required"), so the rewrite to the bearer
 * proxy is mandatory — the EXACT per-tenant path Agents/Prompts/Evals/CRM use
 * (`projects` allow-listed in both `next.config.mjs` CLOUD_V1_HEADS and the proxy's
 * `proxy-allow.ts` CLOUD_HEADS).
 *
 * DISTINCT from two neighbours that share the "project" word:
 *  - IAM tenancy `Project` (`lib/api/projects.ts`) — the org's resource SCOPE
 *    (o11y/API-keys/datasets live under it), served by IAM. NOT a buildable site.
 *  - PaaS `PaasApp` (`lib/api/paas.ts`, `/v1/platform/*`) — long-running container
 *    apps. NOT a hanzo.app-published static site.
 * This client is the hanzo.app buildable-sites store ONLY.
 *
 * Routes (cloud `clients/projectsvc/projectsvc.go`, all return PLAIN JSON — a bare
 * array / object, NOT the casibase `{status,msg,data}` envelope):
 *   GET /v1/projects                     list (org)       → App[]
 *   GET /v1/projects/:slug               get              → App
 *   GET /v1/projects/:slug/deployments   deploy history   → AppDeployment[]
 *
 * The `projectView` nests repo fields under `repo`; a deploy is versioned
 * monotonically (queued→building→uploading→live | error). Payloads are normalized
 * DEFENSIVELY — a field rename upstream degrades a cell rather than throwing, the
 * list reads a bare array OR any common envelope key, and the repo/currentDeploy
 * fields read either the nested HTTP shape or the flat store column. PURE normalizers
 * are unit-tested (apps.test.ts).
 */
import { restGet, originV1Url } from './client'

const BASE = 'projects'
const enc = encodeURIComponent

// ── Coercion helpers (defensive; crm.ts style) ──────────────────────────────
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return 0
}
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Pull the first array found under any common envelope key (or a bare root). */
const arrayUnder = (payload: unknown, keys: string[]): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  if (payload && typeof payload === 'object') {
    for (const k of keys) {
      const v = (payload as Record<string, unknown>)[k]
      if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
    }
  }
  return []
}
const rows = (payload: unknown) => arrayUnder(payload, ['data', 'projects', 'deployments', 'items', 'rows'])

// ── Domain types (mirror cloud clients/projectsvc projectView/deploymentView) ──

/** A linked source repo (the HTTP `repo` object; flat store columns also read). */
export type AppRepo = { url: string; branch: string; provider: string }

/** A buildable/deployed site (projectsvc `projectView`). */
export type App = {
  id: string
  org: string
  slug: string
  name: string
  description: string
  repo: AppRepo
  framework: string
  /** draft | queued | building | uploading | live | error (free-form lifecycle). */
  status: string
  liveUrl: string
  bucket: string
  currentDeploymentId: string
  createdAt: number
  updatedAt: number
}

/** One deploy attempt of a site (projectsvc `deploymentView`, versioned per app). */
export type AppDeployment = {
  id: string
  projectId: string
  version: number
  /** queued | building | uploading | live | error. */
  status: string
  source: string
  commit: string
  liveUrl: string
  prefix: string
  files: number
  bytes: number
  message: string
  createdAt: number
  updatedAt: number
}

// ── Normalizers (pure) ───────────────────────────────────────────────────────

/** The linked repo, from the nested HTTP `repo` object OR the flat store columns. */
function normalizeRepo(raw: unknown, flat: Record<string, unknown>): AppRepo {
  const r = asRecord(raw)
  return {
    url: str(r.url) || str(flat.repoUrl),
    branch: str(r.branch) || str(flat.repoBranch),
    provider: str(r.provider) || str(flat.repoProvider),
  }
}

export function normalizeApp(raw: unknown): App {
  const r = asRecord(raw)
  return {
    id: str(r.id),
    org: str(r.org),
    slug: str(r.slug),
    name: str(r.name),
    description: str(r.description),
    repo: normalizeRepo(r.repo, r),
    framework: str(r.framework),
    status: str(r.status),
    liveUrl: str(r.liveUrl),
    bucket: str(r.bucket),
    // HTTP view: `currentDeploymentId`; flat store column: `currentDeploy`.
    currentDeploymentId: str(r.currentDeploymentId) || str(r.currentDeploy),
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
  }
}

export function normalizeDeployment(raw: unknown): AppDeployment {
  const r = asRecord(raw)
  return {
    id: str(r.id),
    projectId: str(r.projectId),
    version: num(r.version),
    status: str(r.status),
    source: str(r.source),
    commit: str(r.commit),
    liveUrl: str(r.liveUrl),
    prefix: str(r.prefix),
    files: num(r.files),
    bytes: num(r.bytes),
    message: str(r.message),
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
  }
}

/** A site needs an identity (slug or id) to be listed; a bare/garbage row is dropped. */
export const normalizeApps = (p: unknown): App[] =>
  rows(p).map(normalizeApp).filter((a) => a.slug || a.id)

/** Deployments carry an id; newest first (highest version, else newest createdAt). */
export const normalizeDeployments = (p: unknown): AppDeployment[] =>
  rows(p)
    .map(normalizeDeployment)
    .filter((d) => d.id)
    .sort((a, b) => b.version - a.version || b.createdAt - a.createdAt)

// ── Deep-link (pure, injection-safe) ─────────────────────────────────────────

/**
 * The hanzo.app builder deep-link that opens an EXISTING site for conversational
 * editing — the console→app round-trip. The builder (`app/dev`) reads `?project=`
 * and loads that project. `slug` is a single URL-encoded query param
 * (`URLSearchParams` encodes `&`/`=`/`#`/spaces), so nothing in a slug can inject
 * another param or escape the query. `appBase` is defaulted so the helper is
 * pure/testable; callers pass `config.appUrl`.
 */
export function builderEditUrl(slug: string, appBase = 'https://hanzo.app'): string {
  const url = new URL(`${appBase.replace(/\/+$/, '')}/dev`)
  url.searchParams.set('project', slug)
  return url.toString()
}

// ── Network methods (thin — one per documented route) ────────────────────────

export const AppsApi = {
  /** The org's buildable/deployed sites (`GET /v1/projects`, bare array). */
  list: (): Promise<App[]> => restGet<unknown>(originV1Url(BASE)).then(normalizeApps),

  /** One site by slug (`GET /v1/projects/:slug`). */
  get: (slug: string): Promise<App> => restGet<unknown>(originV1Url(`${BASE}/${enc(slug)}`)).then(normalizeApp),

  /** A site's deploy history, newest first (`GET /v1/projects/:slug/deployments`). */
  deployments: (slug: string): Promise<AppDeployment[]> =>
    restGet<unknown>(originV1Url(`${BASE}/${enc(slug)}/deployments`)).then(normalizeDeployments),
}
