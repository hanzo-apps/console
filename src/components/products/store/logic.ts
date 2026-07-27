/**
 * App Store — pure catalog logic (no React, no fetch, no config): the search/filter/
 * paginate + tag helpers that drive the 1000+-app grid. Node-testable in isolation
 * (`logic.test.ts`); the module imports only the `OssApp` TYPE (erased at compile).
 *
 * Performance: the grid filters the full ~1030-item array on every keystroke via these
 * pure functions and renders only `slice(0, visibleCount)` (Load-more, PAGE_SIZE at a
 * time) — so the DOM is capped even though the catalog is large. A search that is a
 * LITERAL case-insensitive substring (never a compiled RegExp of user input) — ReDoS-safe.
 */
import type { OssApp } from '~/lib/api/oss-apps'

/** How many cards a "Load more" page reveals (matches the source marketplace). */
export const PAGE_SIZE = 48

/** The quick-filter tags surfaced as one-tap chips (only those actually present show). */
export const FEATURED_TAGS = [
  'self-hosted',
  'productivity',
  'database',
  'monitoring',
  'automation',
  'ai',
  'media',
  'analytics',
] as const

/** Catalog-provenance tags (which upstream source list an app came from) — never
 *  surfaced as a filter chip: they name other marketplaces, not a category a deployer
 *  browses by. `availableTags` drops them, so neither the quick chips nor the full
 *  "All tags" list renders one. A free-text search still matches them. */
export const PROVENANCE_TAGS = new Set(['caprover', 'dokploy', 'coolify', 'casaos', 'runtipi'])

/** Well-known apps to feature on the Platform home strip, in order (present ones only). */
const FEATURED_IDS = [
  'n8n',
  'postgres',
  'grafana',
  'redis',
  'minio',
  'nocodb',
  'appsmith',
  'metabase',
  'plausible',
  'uptime-kuma',
  'ghost',
  'gitea',
  'nextcloud',
  'supabase',
]

/** An app is one-click deployable when it carries a buildable source (its GitHub repo). */
export function hasDeploySource(app: OssApp): boolean {
  return Boolean(app.links.github)
}

/**
 * A DNS/PaaS-safe slug from a free string (lowercase, non-alnum → single `-`, trimmed,
 * capped at 40 chars). Empty/garbage → `app`. Used to name the PaaS project + app on
 * deploy so the identifier is always valid. Pure (tested) — the random uniqueness
 * suffix is added by the caller.
 */
export function slugify(s: string): string {
  const out = s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return out || 'app'
}

/** Every distinct browsable tag across the catalog, alphabetized — provenance tags
 *  (the upstream marketplace an entry came from) are dropped, so no chip names one. */
export function availableTags(apps: OssApp[]): string[] {
  const set = new Set<string>()
  for (const a of apps) for (const t of a.tags) if (!PROVENANCE_TAGS.has(t)) set.add(t)
  return [...set].sort((x, y) => x.localeCompare(y))
}

/** The one-tap quick-filter chips: FEATURED_TAGS that are present in the catalog. */
export function featuredQuickTags(apps: OssApp[]): string[] {
  const present = new Set(availableTags(apps))
  return FEATURED_TAGS.filter((t) => present.has(t))
}

/**
 * Filter the catalog by a free-text query (case-insensitive substring over name +
 * description + id + tags) AND a tag set (OR — an app matches if it carries ANY selected
 * tag). Empty query + empty tags → the full list. Order is preserved from the input.
 */
export function filterApps(
  apps: OssApp[],
  opts: { query?: string; tags?: string[] } = {},
): OssApp[] {
  const needle = (opts.query ?? '').trim().toLowerCase()
  const tags = opts.tags ?? []
  return apps.filter((a) => {
    if (tags.length > 0 && !a.tags.some((t) => tags.includes(t))) return false
    if (!needle) return true
    if (a.name.toLowerCase().includes(needle)) return true
    if (a.id.toLowerCase().includes(needle)) return true
    if (a.description.toLowerCase().includes(needle)) return true
    return a.tags.some((t) => t.toLowerCase().includes(needle))
  })
}

/** The visible slice for the current page count (Load-more caps the mounted DOM). */
export function paginate(apps: OssApp[], visibleCount: number): OssApp[] {
  return apps.slice(0, Math.max(0, visibleCount))
}

/** How many more apps remain past the visible slice (drives the "Load more (N)" label). */
export function remaining(total: number, visibleCount: number): number {
  return Math.max(0, total - Math.max(0, visibleCount))
}

/**
 * The curated featured set for the Platform home strip: the well-known apps that are
 * actually present in the catalog, in FEATURED_IDS order, up to `n`. Falls back to the
 * first `n` catalog entries if none of the curated ids are present (never fabricated).
 */
export function featuredApps(apps: OssApp[], n = 8): OssApp[] {
  const byId = new Map(apps.map((a) => [a.id, a]))
  const picks: OssApp[] = []
  for (const id of FEATURED_IDS) {
    const a = byId.get(id)
    if (a) picks.push(a)
    if (picks.length >= n) break
  }
  if (picks.length === 0) return apps.slice(0, n)
  return picks
}
