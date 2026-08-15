/**
 * Templates API — the Hanzo starter-kit gallery (deployable app/site scaffolds,
 * source of truth `hanzoai/gallery`), served READ-ONLY by cloud `clients/templates`
 * at `/v1/templates`. Reached same-origin via `originV1Url('templates')` →
 * next.config rewrites the `templates` head to the console's own `/v1` bearer
 * proxy, so dev and prod share ONE path (the catalog is public, but routing it
 * through /v1 keeps the surface uniform with prompts/agents).
 *
 * Routes (cloud `clients/templates/templates.go`):
 *   - GET /v1/templates          list the starter-kit catalog
 *   - GET /v1/templates/:slug    one template by slug
 *
 * Defensive normalizers (prompts.ts style): a field rename upstream degrades a
 * cell rather than throwing; the list reads from any common envelope key.
 */
import { restGet, restPost, originV1Url, ApiError } from './client'

const BASE = 'templates'

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const strList = (v: unknown): string[] => {
  if (!Array.isArray(v)) return []
  return v.map((x) => (typeof x === 'string' ? x : String(x))).filter((x) => x.trim() !== '')
}
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

/** One starter kit in the gallery. */
export type Template = {
  slug: string
  title: string
  category: string
  description?: string
  framework?: string
  features: string[]
  useCase?: string
  tier?: number
  rating?: number
  /** Canonical gallery detail (fork/deploy) URL. */
  source?: string
  /** Screenshot/preview URL. */
  preview?: string
}

/** Normalize one gallery record to a `Template` (drops records with no slug/title). */
export function normalizeTemplate(raw: unknown): Template | null {
  const r = asRecord(raw)
  const slug = str(r.slug) ?? str(r.id)
  const title = str(r.title) ?? str(r.displayName) ?? str(r.name)
  if (!slug || !title) return null
  return {
    slug,
    title,
    category: str(r.category) ?? 'App',
    description: str(r.description),
    framework: str(r.framework),
    features: strList(r.features),
    useCase: str(r.useCase),
    tier: num(r.tier),
    rating: num(r.rating),
    source: str(r.source),
    preview: str(r.preview),
  }
}

/** Normalize the gallery payload to the list of templates (any envelope key or bare array). */
export function normalizeTemplates(payload: unknown): Template[] {
  return arrayUnder(payload, ['data', 'templates', 'items', 'rows'])
    .map(normalizeTemplate)
    .filter((t): t is Template => t !== null)
}

/**
 * A project created by forking a template — the projectsvc `Project` view the
 * fork endpoint returns (`POST /v1/projects/fork` → 201). We keep only the fields
 * the console needs to route to / celebrate the new project; `liveUrl` is present
 * once the project deploys (a fresh fork is `draft` with no `liveUrl` yet).
 */
export type ForkedProject = {
  slug: string
  name: string
  framework: string
  status: string
  liveUrl?: string
}

/** Normalize the projectsvc Project payload to a `ForkedProject` (or null if unusable). */
export function normalizeForkedProject(raw: unknown): ForkedProject | null {
  const r = asRecord(raw)
  const slug = str(r.slug)
  if (!slug) return null
  return {
    slug,
    name: str(r.name) ?? slug,
    framework: str(r.framework) ?? 'static',
    status: str(r.status) ?? 'draft',
    liveUrl: str(r.liveUrl),
  }
}

/**
 * The first-edition seed prompt for the builder — the template context (title,
 * framework, description) plus the user's optional customization ask. The builder
 * generates the first edition from THIS prompt, so it must carry enough of the
 * template to land on the right kind of app. `userText` is optional: with nothing
 * typed we seed just the template ("Customize it to my needs.").
 */
export function customizePrompt(template: Template, userText = ''): string {
  const fw = template.framework ? ` (${template.framework})` : ''
  const desc = template.description ? ` ${template.description.trim()}` : ''
  const ask = userText.trim()
  const tail = ask ? ` Customize it: ${ask}` : ' Customize it to my needs.'
  return `Start from the ${template.title} template${fw}.${desc}${tail}`
}

/**
 * The hanzo.app builder deep-link that opens this starter pre-seeded to customize
 * by prompt — the "fork → open in builder" loop. The builder (`app/dev`) reads
 * `?template=` (the gallery source it customizes from), `?prompt=` (the
 * first-edition seed — its presence AUTO-STARTS generation), and `?action=edit`.
 *
 * Injection-safe: the template fields and `userText` are single, URL-encoded
 * query params (`URLSearchParams` encodes `&`, `=`, `#`, quotes, …), so nothing
 * the user types can inject another param or escape the query. `appBase` is
 * defaulted so the helper is pure/testable; callers pass `config.appUrl`.
 */
export function buildBuilderUrl(
  template: Template,
  userText = '',
  appBase = 'https://hanzo.app',
): string {
  const url = new URL(`${appBase.replace(/\/+$/, '')}/dev`)
  if (template.source) url.searchParams.set('template', template.source)
  url.searchParams.set('prompt', customizePrompt(template, userText))
  url.searchParams.set('action', 'edit')
  return url.toString()
}

/**
 * The result of kicking off a deploy — projectsvc's deployment/project view. A
 * git deploy (a forked template carries a linked repo) returns 202 `queued`/
 * `building` with no `liveUrl` yet; poll `TemplatesApi.status()` for `live` + the
 * URL. An artifact/fast path can come back `live` immediately.
 */
export type DeployResult = {
  status: string // queued | building | uploading | live | error
  liveUrl?: string
  message?: string
}

/** Normalize projectsvc's deployment (or project) view to a `DeployResult`. */
export function normalizeDeployResult(raw: unknown): DeployResult {
  const r = asRecord(raw)
  return {
    status: str(r.status) ?? 'building',
    liveUrl: str(r.liveUrl),
    message: str(r.message),
  }
}

/** True once a project/deploy is serving (has a live URL or a terminal live status). */
export const isLive = (status?: string, liveUrl?: string): boolean =>
  !!liveUrl || (status ?? '').toLowerCase() === 'live'
/** Group templates by category, categories alphabetized, preserving list order within each. */
export function groupByCategory(templates: Template[]): [string, Template[]][] {
  const byCat = new Map<string, Template[]>()
  for (const t of templates) {
    const g = byCat.get(t.category)
    if (g) g.push(t)
    else byCat.set(t.category, [t])
  }
  return [...byCat.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export const TemplatesApi = {
  /** The starter-kit gallery (`GET /v1/templates`) — honest-empty until bound. */
  list: (): Promise<Template[]> => restGet<unknown>(originV1Url(BASE)).then(normalizeTemplates),

  /** One template by slug (`GET /v1/templates/{slug}`) — raw payload. */
  get: (slug: string): Promise<unknown> =>
    restGet<unknown>(originV1Url(`${BASE}/${encodeURIComponent(slug)}`)),

  /**
   * Fork a starter template into a REAL project (`POST /v1/projects/fork`). The
   * cloud projectsvc looks up the template by slug, maps its framework, and creates
   * an org-scoped Project seeded from it (repo = the gallery source). Returns the
   * new project so the UI can route to / celebrate it. Throws `ApiError` (with
   * `.status`) on failure — the caller falls back to the gallery source on 404
   * (older backend with no fork route).
   */
  fork: (slug: string, opts?: { name?: string }): Promise<ForkedProject> =>
    restPost<unknown>(originV1Url('projects/fork'), {
      slug,
      ...(opts?.name ? { name: opts.name } : {}),
    }).then((raw) => {
      const p = normalizeForkedProject(raw)
      if (!p) throw new ApiError('Fork returned an unexpected project shape')
      return p
    }),

  /**
   * Open a deployment for a forked project (`POST /v1/projects/{slug}/deployments`)
   * — the collection is where a deployment is created. Cloud answers 202 `queued`
   * and CI ships the build to S3 under the write grant on that answer, then flips
   * the project `live` with a `liveUrl`. Returns the initial status; poll
   * `status()` for `live`.
   *
   * The body is empty because a deployment start needs a DESTINATION, not a
   * source: cloud derives the prefix from the project. This used to be
   * `{source:'git'}` on `.../deploy`, where `source` was a Content-Type
   * discriminator picking between two operations at one address. That address is
   * the archive upload alone now and reads any body as bytes, so the JSON was
   * sniffed as a tar and refused.
   */
  deploy: (slug: string): Promise<DeployResult> =>
    restPost<unknown>(originV1Url(`projects/${encodeURIComponent(slug)}/deployments`), {}).then(
      normalizeDeployResult,
    ),

  /** One project's current state (`GET /v1/projects/{slug}`) — polls draft→building→live. */
  status: (slug: string): Promise<ForkedProject | null> =>
    restGet<unknown>(originV1Url(`projects/${encodeURIComponent(slug)}`)).then(normalizeForkedProject),
}
