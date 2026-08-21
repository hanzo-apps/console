/**
 * Cloudflare asset-plane API — an org's Cloudflare Pages, Workers and (Phase 2)
 * R2/KV/D1 over the cloud `apps/cloudflare` surface at `/v1/cloudflare/*` (a sibling
 * of the `cloudflare` CONNECTOR in `apps/integrations` that seals the token, and of
 * hanzodns which drives the same token for `/v1/dns`).
 *
 * Every call is same-origin, keyless and prefix-free (`originV1Url('cloudflare/...')`
 * → `<origin>/v1/cloudflare/...` — NOTHING before `/v1/`), exactly like
 * `integrations.ts`. The console's own `app/v1/[...path]` BFF
 * mints a short-lived user bearer from the session and forwards it; cloud resolves
 * the org from the token's `owner` claim and reads THAT org's KMS-sealed Cloudflare
 * token, so no credential ever reaches the browser and an org can only ever address
 * its own Cloudflare account. The `cloudflare` head is allow-listed in
 * `proxy-allow.ts` (`allowCloudSurface` matches the first segment).
 *
 * AUTHORIZATION (mirrors the backend gate, so the UI can explain a refusal):
 *   - reads  → validated org (any member);
 *   - writes → `principal.IsOrgAdmin` — a non-admin gets 403 "requires org admin";
 *   - 503    → the org has not connected Cloudflare yet (or KMS is down);
 *   - 501    → a Phase-2 capability (R2/KV/D1) whose route exists but is not wired.
 *
 * Transport is PLAIN REST with real HTTP status. Cloud relays Cloudflare's API v4
 * `result` VERBATIM (no field loss, no Hanzo envelope), so the normalizers below map
 * the REAL Cloudflare shapes (`created_on`, `latest_stage`, script `id` = the script
 * NAME). They are pure and defensive — a renamed/partial payload degrades to an
 * honest value instead of throwing.
 */
import { restGet, restPost, restPut, restDelete, originV1Url } from './client'

const BASE = 'cloudflare'
const enc = encodeURIComponent
const url = (path: string): string => originV1Url(`${BASE}/${path}`)

// ── Coercion helpers (defensive; dns.ts / integrations.ts style) ─────────────
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s) => s !== '') : []
/** Cloudflare relays a bare array as the result; tolerate a wrapper key too. */
const rows = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload
  const r = asRecord(payload)
  for (const k of ['result', 'data', 'items']) if (Array.isArray(r[k])) return r[k] as unknown[]
  return []
}

// ── Contract ─────────────────────────────────────────────────────────────────

/** A Pages deployment (the project's `latest_deployment`). */
export interface Deployment {
  id: string
  /** The deployment's own preview/production URL. */
  url: string
  environment: string
  /** `latest_stage.status` — success | failure | active | queued … */
  status: string
  branch: string
  createdAt: string
}

/** A Cloudflare Pages project. */
export interface PagesProject {
  name: string
  /** The `<project>.pages.dev` hostname. */
  subdomain: string
  /** Custom + pages.dev domains bound to the project. There is no domains-LIST
   *  route; this is the authoritative list, read from the project itself. */
  domains: string[]
  productionBranch: string
  latestDeployment: Deployment | null
  createdAt: string
}

/** A Workers script. Cloudflare keys a script by NAME and returns it as `id`. */
export interface WorkerScript {
  name: string
  createdAt: string
  modifiedAt: string
}

/** A Workers route binding a script to a URL pattern within a zone. */
export interface WorkerRoute {
  id: string
  pattern: string
  script: string
}

/** The Phase-2 capabilities: the routes exist and answer an honest 501. */
export const PHASE2 = ['r2', 'kv', 'd1'] as const
export type Phase2 = (typeof PHASE2)[number]

// ── Pure logic (unit-tested) ─────────────────────────────────────────────────

/**
 * Mirror of the backend `nameRE` (`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`) that bounds
 * every Cloudflare NAME path segment — a Pages project, a Worker script, a custom
 * domain. Validating client-side turns a would-be 400 into an inline field error.
 */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
/** Mirror of the backend `idRE` — a Cloudflare 32-hex id (account / zone / route). */
const ID_RE = /^[0-9a-fA-F]{32}$/

export const isName = (v: string): boolean => NAME_RE.test(v.trim())
export const isId = (v: string): boolean => ID_RE.test(v.trim())

/** Validate a Pages project / Worker script name. Returns an error, or null. */
export function validateName(raw: string, what: string): string | null {
  const v = raw.trim()
  if (!v) return `${what} is required.`
  if (!isName(v))
    return `${what} must start with a letter or number and use only letters, numbers, dot, dash or underscore (max 128).`
  return null
}

/** Validate a zone id — Cloudflare routes are keyed by the 32-hex ZONE ID, not a domain. */
export function validateZoneId(raw: string): string | null {
  const v = raw.trim()
  if (!v) return 'Zone ID is required.'
  if (!isId(v)) return 'Zone ID must be a 32-character hex id (copy it from the Cloudflare zone overview).'
  return null
}

/** Validate a Workers route pattern (`example.com/*`). */
export function validatePattern(raw: string): string | null {
  const v = raw.trim()
  if (!v) return 'Route pattern is required.'
  if (/\s/.test(v)) return 'Route pattern cannot contain spaces.'
  if (!v.includes('.')) return 'Enter a host pattern, e.g. example.com/*.'
  return null
}

/** Validate a custom domain added to a Pages project. */
export function validateDomain(raw: string): string | null {
  const v = raw.trim().replace(/\.$/, '')
  if (!v) return 'Domain is required.'
  if (/[/:\s]/.test(v)) return 'Enter a bare domain (app.example.com), not a URL.'
  if (!isName(v) || !v.includes('.')) return 'Enter a valid domain, e.g. app.example.com.'
  return null
}

/** Validate a Worker module source before upload. */
export function validateScript(raw: string): string | null {
  if (!raw.trim()) return 'Script source is required.'
  return null
}

/**
 * The workers.dev URL a script is served at once enabled — `https://<script>.
 * <subdomain>.workers.dev`. Empty when the account has no workers.dev subdomain,
 * so the UI shows nothing rather than a broken link.
 */
export const workersDevUrl = (script: string, subdomain: string): string =>
  script && subdomain ? `https://${script}.${subdomain}.workers.dev` : ''

/** A custom domain is one that is not the project's own `*.pages.dev` hostname. */
export const isCustomDomain = (domain: string): boolean => !domain.endsWith('.pages.dev')

// ── Normalizers (pure; map the REAL Cloudflare API v4 shapes) ────────────────

export function normalizeDeployment(raw: unknown): Deployment | null {
  const r = asRecord(raw)
  const id = str(r.id)
  if (!id) return null
  const stage = asRecord(r.latest_stage ?? r.latestStage)
  const trigger = asRecord(asRecord(r.deployment_trigger ?? r.deploymentTrigger).metadata)
  return {
    id,
    url: str(r.url),
    environment: str(r.environment),
    status: str(stage.status),
    branch: str(trigger.branch),
    createdAt: str(r.created_on) || str(r.createdOn) || str(r.created_at),
  }
}

export function normalizeProject(raw: unknown): PagesProject {
  const r = asRecord(raw)
  return {
    name: str(r.name),
    subdomain: str(r.subdomain),
    domains: strArray(r.domains),
    productionBranch: str(r.production_branch) || str(r.productionBranch),
    latestDeployment: normalizeDeployment(r.latest_deployment ?? r.latestDeployment),
    createdAt: str(r.created_on) || str(r.createdOn) || str(r.created_at),
  }
}

export const normalizeProjects = (payload: unknown): PagesProject[] =>
  rows(payload).map(normalizeProject).filter((p) => p.name)

export function normalizeScript(raw: unknown): WorkerScript {
  const r = asRecord(raw)
  return {
    // Cloudflare returns the script NAME as `id`.
    name: str(r.id) || str(r.name),
    createdAt: str(r.created_on) || str(r.createdOn),
    modifiedAt: str(r.modified_on) || str(r.modifiedOn),
  }
}

export const normalizeScripts = (payload: unknown): WorkerScript[] =>
  rows(payload).map(normalizeScript).filter((s) => s.name)

export function normalizeRoute(raw: unknown): WorkerRoute {
  const r = asRecord(raw)
  return { id: str(r.id), pattern: str(r.pattern), script: str(r.script) }
}

export const normalizeRoutes = (payload: unknown): WorkerRoute[] =>
  rows(payload).map(normalizeRoute).filter((r) => r.id)

/** The account's workers.dev subdomain label (`{ subdomain }`), '' when unset. */
export const normalizeSubdomain = (payload: unknown): string => str(asRecord(payload).subdomain)

// ── Network methods (thin — one per wired cloud route) ───────────────────────

export const CloudflareApi = {
  pages: {
    /** All Pages projects for the org's account. */
    list: (): Promise<PagesProject[]> => restGet<unknown>(url('pages/projects')).then(normalizeProjects),
    /** One project — the authoritative source for its domains + latest deployment. */
    get: (project: string): Promise<PagesProject> =>
      restGet<unknown>(url(`pages/projects/${enc(project)}`)).then(normalizeProject),
    /** Create a project. `productionBranch` defaults server-side when omitted. */
    create: (name: string, productionBranch?: string): Promise<PagesProject> =>
      restPost<unknown>(url('pages/projects'), {
        name: name.trim(),
        ...(productionBranch?.trim() ? { production_branch: productionBranch.trim() } : {}),
      }).then(normalizeProject),
    remove: (project: string): Promise<void> => restDelete(url(`pages/projects/${enc(project)}`)),
    /** Trigger a deployment; an absent branch builds the project's production branch. */
    deploy: (project: string, branch?: string): Promise<Deployment | null> =>
      restPost<unknown>(
        url(`pages/projects/${enc(project)}/deployments`),
        branch?.trim() ? { branch: branch.trim() } : {},
      ).then(normalizeDeployment),
    addDomain: (project: string, name: string): Promise<void> =>
      restPost<unknown>(url(`pages/projects/${enc(project)}/domains`), { name: name.trim() }).then(() => undefined),
    removeDomain: (project: string, domain: string): Promise<void> =>
      restDelete(url(`pages/projects/${enc(project)}/domains/${enc(domain)}`)),
  },
  workers: {
    list: (): Promise<WorkerScript[]> => restGet<unknown>(url('workers/scripts')).then(normalizeScripts),
    /** Upload/replace a module Worker. Cloud builds the multipart body server-side. */
    put: (script: string, source: string, mainModule?: string): Promise<void> =>
      restPut<unknown>(url(`workers/scripts/${enc(script)}`), {
        script: source,
        ...(mainModule?.trim() ? { mainModule: mainModule.trim() } : {}),
      }).then(() => undefined),
    remove: (script: string): Promise<void> => restDelete(url(`workers/scripts/${enc(script)}`)),
    /** The ACCOUNT's workers.dev subdomain label ('' when the account has none). */
    subdomain: (): Promise<string> => restGet<unknown>(url('workers/subdomain')).then(normalizeSubdomain),
    /** Enable/disable ONE script on workers.dev. Write-only — the wired surface
     *  exposes no per-script GET, so the UI never claims to know the current state. */
    setSubdomain: (script: string, enabled: boolean): Promise<void> =>
      restPost<unknown>(url(`workers/scripts/${enc(script)}/subdomain`), { enabled }).then(() => undefined),
    routes: {
      list: (zone: string): Promise<WorkerRoute[]> =>
        restGet<unknown>(url(`workers/zones/${enc(zone)}/routes`)).then(normalizeRoutes),
      create: (zone: string, pattern: string, script?: string): Promise<WorkerRoute> =>
        restPost<unknown>(url(`workers/zones/${enc(zone)}/routes`), {
          pattern: pattern.trim(),
          ...(script?.trim() ? { script: script.trim() } : {}),
        }).then(normalizeRoute),
      remove: (zone: string, route: string): Promise<void> =>
        restDelete(url(`workers/zones/${enc(zone)}/routes/${enc(route)}`)),
    },
  },
}
