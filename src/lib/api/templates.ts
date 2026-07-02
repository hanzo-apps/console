/**
 * Templates API — the Hanzo starter-kit gallery (deployable app/site scaffolds,
 * source of truth `hanzoai/gallery`), served READ-ONLY by cloud `clients/templates`
 * at `/v1/templates`. Reached same-origin via `originV1Url('templates')` →
 * next.config rewrites the `templates` head to the console's own `/cloud` bearer
 * proxy, so dev and prod share ONE path (the catalog is public, but routing it
 * through /cloud keeps the surface uniform with prompts/agents).
 *
 * Routes (cloud `clients/templates/templates.go`):
 *   - GET /v1/templates          list the starter-kit catalog
 *   - GET /v1/templates/:slug    one template by slug
 *
 * Defensive normalizers (prompts.ts style): a field rename upstream degrades a
 * cell rather than throwing; the list reads from any common envelope key.
 */
import { restGet, originV1Url } from './client'

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
}
