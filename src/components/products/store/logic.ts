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

/** Catalog-provenance tags (which source list an app came from) — hidden from the quick
 *  chips (they are noise to a deployer) but still searchable in the full tag list. */
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

/**
 * One service a blueprint provisions, read from its `docker-compose.yml`.
 * `image` is absent for a service built from source (`build:` instead of `image:`).
 */
export type Service = { name: string; image?: string; ports: string[] }

/** What a blueprint actually provisions — the answer to "what am I about to run?". */
export type Blueprint = { services: Service[]; env: string[] }

/** Indent width of a line, tabs counted as one column (compose files are space-indented). */
const indent = (line: string): number => line.length - line.trimStart().length

/**
 * Parse the load-bearing facts out of a `docker-compose.yml`: the services it starts
 * (with image + published ports) and the environment keys it expects.
 *
 * A deliberately SMALL structural reader, not a YAML implementation — it walks the
 * `services:` block by indentation and pulls only the four keys the detail page shows.
 * Anything it cannot read is simply absent, never guessed, so the page degrades to
 * "no blueprint detail" instead of asserting something false about what will run.
 * Pure + total (never throws on malformed input), so it is unit-testable and safe to
 * run on untrusted CDN content.
 */
export function parseBlueprint(yaml: string): Blueprint {
  const lines = yaml.split(/\r?\n/)
  const services: Service[] = []
  const env = new Set<string>()

  let servicesAt = -1 // indent of the `services:` key, -1 until seen
  let current: Service | null = null
  let currentAt = -1 // indent of the current service's name (parser bookkeeping, not a field)
  let listKey: 'ports' | 'environment' | null = null
  let listAt = -1

  for (const raw of lines) {
    const line = raw.replace(/\t/g, ' ')
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const col = indent(line)

    if (servicesAt < 0) {
      if (/^services\s*:/.test(trimmed)) servicesAt = col
      continue
    }
    // Dedent back to or past `services:` ends the block (e.g. a following `volumes:`).
    if (col <= servicesAt) {
      if (!/^services\s*:/.test(trimmed)) break
      continue
    }

    // A service name sits exactly one level inside `services:`.
    if (current === null || col <= currentAt) {
      const m = trimmed.match(/^([A-Za-z0-9._-]+)\s*:\s*$/)
      if (m) {
        current = { name: m[1], ports: [] }
        currentAt = col
        services.push(current)
        listKey = null
        continue
      }
    }
    if (!current) continue

    // Inside a service: the scalar keys we surface, then the two list keys.
    if (listKey && col > listAt && trimmed.startsWith('-')) {
      const item = trimmed.replace(/^-\s*/, '').replace(/^["']|["']$/g, '')
      if (listKey === 'ports') current.ports.push(item)
      else {
        const key = item.split(/[=:]/)[0]?.trim()
        if (key) env.add(key)
      }
      continue
    }
    listKey = null

    const img = trimmed.match(/^image\s*:\s*(.+)$/)
    if (img) {
      current.image = img[1].trim().replace(/^["']|["']$/g, '')
      continue
    }
    if (/^ports\s*:/.test(trimmed)) {
      listKey = 'ports'
      listAt = col
      continue
    }
    if (/^environment\s*:/.test(trimmed)) {
      listKey = 'environment'
      listAt = col
      continue
    }
    // `environment:` in mapping form — `KEY: value` nested under it — is covered by the
    // list branch above only for `- KEY=value`; mapping entries land here harmlessly.
  }

  return { services, env: [...env].sort((a, b) => a.localeCompare(b)) }
}

/** Every distinct tag across the catalog, alphabetized. */
export function availableTags(apps: OssApp[]): string[] {
  const set = new Set<string>()
  for (const a of apps) for (const t of a.tags) set.add(t)
  return [...set].sort((x, y) => x.localeCompare(y))
}

/** The one-tap quick-filter chips: FEATURED_TAGS that are present and not provenance. */
export function featuredQuickTags(apps: OssApp[]): string[] {
  const present = new Set(availableTags(apps))
  return FEATURED_TAGS.filter((t) => present.has(t) && !PROVENANCE_TAGS.has(t))
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
