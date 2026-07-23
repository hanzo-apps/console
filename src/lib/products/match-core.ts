/**
 * Pure catalog matching — routing + filtering, with NO runtime registry import
 * (types only, erased by the compiler). Kept separate from `match.ts`/`search.ts`
 * (which bind these to the real `productModules`/`catalog`) so the logic is unit-
 * testable in a plain-node test without pulling the GUI component tree.
 */
import type { CatalogEntry, ProductModule, ProductRoute, ProductSubpage } from './registry'

export type Matched = {
  module: ProductModule
  route: ProductRoute
  params: Record<string, string>
}

/**
 * Resolve a URL slug against a module list to a route + params. Patterns are
 * segment lists; a `:param` segment captures one value. Routes are tried in order
 * and matched by exact segment count, so `''` (index), `:tab`, and `routing/:name`
 * are unambiguous (e.g. `/models` → index, `/models/routing` → `:tab='routing'`,
 * `/models/routing/new` → `routing/:name` with `name='new'`).
 */
export function resolveRoute(modules: ProductModule[], slug: string[]): Matched | null {
  const [id, ...rest] = slug
  if (!id) return null
  const module = modules.find((m) => m.id === id)
  if (!module) return null

  for (const route of module.routes) {
    const pattern = route.path === '' ? [] : route.path.split('/')
    if (pattern.length !== rest.length) continue

    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < pattern.length; i++) {
      const seg = pattern[i]
      const val = rest[i]
      if (seg.startsWith(':')) {
        params[seg.slice(1)] = val
      } else if (seg !== val) {
        ok = false
        break
      }
    }
    if (ok) return { module, route, params }
  }
  return null
}

/**
 * Boolean filter for the sidebar: does an entry contain the query across its
 * label/id/category/gcp/description? Empty query → true (everything shows). Unlike
 * `searchCatalog` (which RANKS into a flat list), the sidebar keeps its category
 * grouping and just needs a per-entry predicate.
 */
export function entryMatches(e: CatalogEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `${e.label} ${e.id} ${e.category} ${e.gcp ?? ''} ${e.description}`.toLowerCase().includes(q)
}

// ── Slug aliases (conventional URL → canonical entry id) ─────────────────────

/**
 * Conventional / intuitive slugs that a user (or an external doc, bookmark, or a
 * hand-typed URL) reasonably expects, mapped to the canonical catalog `id`. The
 * nav/launcher/⌘K always open the canonical id, so these aliases exist ONLY to
 * keep a directly-navigated URL from 404ing — the ONE place aliasing is defined
 * (DRY), consumed only by `resolveProductView`.
 *
 * `auto`/`automation` → `automations` (the ONE native Automations module; the
 * external auto.hanzo.ai engine + its `/v1/auto` proxy are retired), and
 * `mlpipelines`/`kubeflow` → `ml-pipelines` (the old engine-named slug stays live
 * for any existing bookmark after the id rename). An alias only resolves to
 * SOMETHING truthful — a real module route or an external launch — never a fake.
 *
 * The rest close the gap between the product's HUMAN name (what an external doc,
 * bookmark, the CTO's e2e list, or a hand-typed URL uses) and its canonical `id`,
 * which was the single biggest source of "half the pages are blank": a slug with
 * no matching id resolved to `notfound` → a Next 404 the operator read as a blank
 * page. Each maps a real human slug to the id that renders it:
 *   `traces` → `o11y` (that entry IS labelled "Traces"),
 *   `deploy` → `app-platform`, `plans-pricing` → `plans`, `wallets` → `wallet`,
 *   `model-catalog` → `models`, `fine-tuning` → `finetuning`,
 *   `web-search` → `websearch`.
 */
export const SLUG_ALIASES: Record<string, string> = {
  auto: 'automations',
  automation: 'automations',
  mlpipelines: 'ml-pipelines',
  kubeflow: 'ml-pipelines',
  traces: 'o11y',
  deploy: 'app-platform',
  'plans-pricing': 'plans',
  wallets: 'wallet',
  'model-catalog': 'models',
  'fine-tuning': 'finetuning',
  'web-search': 'websearch',
  // The former standalone Git product folded into the unified Code hub — a bookmarked
  // `/git` lands on the hub (never a 404); the canonical repo path is `/code/repos/:name`.
  git: 'code',
}

/** Canonicalize the FIRST slug segment through `SLUG_ALIASES` (identity if none). */
export function canonicalSlug(slug: string[]): string[] {
  const [head, ...rest] = slug
  const canon = head ? SLUG_ALIASES[head] : undefined
  return canon ? [canon, ...rest] : slug
}

// ── Sub-pages (the level-2 nav contract) ─────────────────────────────────────

/** The product index — the implicit Overview sub-page (never declared). */
export const OVERVIEW_SUBPAGE: ProductSubpage = { slug: '', label: 'Overview' }

/**
 * The uniform base sub-page set every product gets, in exact order, so no
 * product is a snowflake. Overview ('') is prepended separately; a product's own
 * declared specific that owns one of these slugs takes precedence (deduped).
 */
export const BASE_SUBPAGES: ProductSubpage[] = [
  { slug: 'settings', label: 'Settings' },
  { slug: 'status', label: 'Status' },
  { slug: 'logs', label: 'Logs' },
  { slug: 'metrics', label: 'Metrics' },
]

/**
 * The full ordered level-2 nav for a product: Overview, then its declared
 * SPECIFIC sub-pages, then the uniform base set (a base slug the product already
 * declares as a specific is not duplicated). Non-module entries have none.
 *
 * `showAdmin` gates admin-only specifics (e.g. Models › Routing): a customer
 * never sees them in the sub-nav (default true keeps every existing caller
 * showing everything).
 */
export function productSubpages(entry: CatalogEntry, showAdmin = true): ProductSubpage[] {
  if (entry.kind !== 'module') return []
  const specifics = (entry.subpages ?? []).filter((s) => s.slug !== '' && (showAdmin || !s.admin))
  const seen = new Set(specifics.map((s) => s.slug))
  const out: ProductSubpage[] = [OVERVIEW_SUBPAGE, ...specifics]
  for (const b of BASE_SUBPAGES) if (!seen.has(b.slug)) out.push(b)
  return out
}

/**
 * Whether a product URL targets an ADMIN-only view — the product itself is
 * admin-gated, or the trailing segment is an admin-only sub-page. The catch-all
 * uses this (with the client admin signal) to render an honest "managed by
 * Hanzo" notice for a customer instead of letting the module throw a 403.
 */
export function isAdminView(catalog: CatalogEntry[], slug: string[]): boolean {
  const entry = catalog.find((e) => e.id === slug[0])
  if (!entry || entry.kind !== 'module') return false
  if (entry.admin) return true
  const seg = slug[1]
  if (!seg) return false
  return Boolean((entry.subpages ?? []).find((s) => s.slug === seg)?.admin)
}

// ── Command-palette destinations (⌘K jumps to any level) ─────────────────────

/**
 * A command-palette jump target: a product, or a specific sub-page within one
 * (e.g. Compute › Tasks › Queues). Only DECLARED specific sub-pages are indexed
 * (real jump targets); the uniform base placeholders have no content to jump to.
 */
export type Destination =
  | { kind: 'product'; entry: CatalogEntry }
  | { kind: 'subpage'; entry: CatalogEntry; subpage: ProductSubpage; path: string }

/**
 * Every ⌘K jump target — products (catalog order), then each product's declared
 * specific sub-pages. `showAdmin` gates admin products AND admin sub-pages so a
 * customer can't jump to a surface they can't see. Pure (takes the catalog), so
 * the indexing + gating is unit-testable without the GUI tree.
 */
export function destinationsFor(catalog: CatalogEntry[], showAdmin: boolean): Destination[] {
  const products = showAdmin ? catalog : catalog.filter((e) => !e.admin)
  const out: Destination[] = products.map((entry) => ({ kind: 'product', entry }))
  for (const entry of products) {
    if (entry.kind !== 'module') continue
    for (const sp of entry.subpages ?? []) {
      if (sp.slug === '' || (!showAdmin && sp.admin)) continue
      out.push({ kind: 'subpage', entry, subpage: sp, path: `/${entry.id}/${sp.slug}` })
    }
  }
  return out
}

/** True when a slug is one of the uniform base sub-pages (Settings/Status/Logs/Metrics). */
export const isBaseSubpageSlug = (slug: string): boolean =>
  slug !== '' && BASE_SUBPAGES.some((b) => b.slug === slug)

/**
 * True when a sub-page renders REAL content (vs. an honest placeholder stub).
 * Two sources of truth, unified:
 *  - A uniform BASE sub-page (Settings/Status/Logs/Metrics) is ALWAYS wired — it
 *    renders the shared per-product sub-page system (real health/logs/metrics/
 *    settings scoped to the product, or an honest managed state), never a dead
 *    stub. So the nav never dims it.
 *  - Any other slug is wired iff the ONE router (`resolveRoute`) matches a real
 *    route (`''` → index; a declared specific on a `:tab` module → the module).
 * One source of truth, so the nav's hint and the actual render can never disagree.
 */
export function subpageIsWired(modules: ProductModule[], id: string, slug: string): boolean {
  if (isBaseSubpageSlug(slug)) return true
  return resolveRoute(modules, slug === '' ? [id] : [id, ...slug.split('/')]) !== null
}

/**
 * What the catch-all renders for a product URL: a real route, the shared
 * per-product sub-page (real Status/Logs/Metrics/Settings), an honest stub for a
 * declared-but-unwired specific, or 404.
 */
export type ProductView =
  | { kind: 'route'; matched: Matched }
  | { kind: 'subpage'; entry: CatalogEntry; subpage: ProductSubpage }
  | { kind: 'stub'; entry: CatalogEntry; subpage: ProductSubpage }
  // A directly-navigated URL that resolves (possibly via an alias) to an EXTERNAL
  // entry — a real product on its own domain (e.g. a Lux/Zoo chain app launch tile).
  // External entries own no in-console route, so the catch-all launches `href`
  // instead of 404ing. The nav/launcher never produce this (they `openProduct`
  // directly); it's only for a hand-typed/bookmarked URL.
  | { kind: 'external'; entry: Extract<CatalogEntry, { kind: 'external' }> }
  | { kind: 'notfound' }

/**
 * Resolve a product URL to a view.
 *
 * Precedence (one way, no snowflakes):
 *  1. A uniform BASE sub-page (`/<product>/{settings|status|logs|metrics}`) that
 *     the product does NOT own as a declared specific renders the shared
 *     per-product sub-page system — REAL per-product health / logs / metrics /
 *     settings, never a generic `:tab` fallback and never a dead stub. This wins
 *     over a `:tab` route so a tabbed product's Status/Logs/Metrics is the real
 *     scoped view, not the product's default tab.
 *  2. A real route wins for everything else (index, declared specifics incl. a
 *     product that OWNS a base slug like Embeddings › Settings or Prompts ›
 *     Metrics — those stay their bespoke route).
 *  3. A declared specific with no backing route yet → an honest placeholder stub.
 *  4. Otherwise 404.
 *
 * So every product URL resolves to something truthful — a real route, a real
 * per-product sub-page, or an honest placeholder — never a dead link, never a
 * fabricated surface, never a generic page masquerading as per-product data.
 */
export function resolveProductView(
  catalog: CatalogEntry[],
  modules: ProductModule[],
  slugIn: string[],
): ProductView {
  // Canonicalize a conventional/aliased slug (e.g. `/automation` → `auto`,
  // `/kubeflow` → `ml-pipelines`) up front, so aliasing lives in exactly one place
  // and every branch below reasons over the canonical id — no dead alias URL.
  const slug = canonicalSlug(slugIn)

  // A bare `/<external-product>` (its canonical id, or an alias like `/automation`)
  // resolves to the external launch — a real product on its own domain, not a 404.
  if (slug.length === 1) {
    const entry = catalog.find((e) => e.id === slug[0])
    if (entry && entry.kind === 'external') return { kind: 'external', entry }
  }

  if (slug.length === 2) {
    const entry = catalog.find((e) => e.id === slug[0])
    if (entry && entry.kind === 'module') {
      const seg = slug[1]
      const ownsAsSpecific = (entry.subpages ?? []).some((s) => s.slug === seg)
      const base = BASE_SUBPAGES.find((s) => s.slug === seg)
      if (base && !ownsAsSpecific) return { kind: 'subpage', entry, subpage: base }
    }
  }

  const matched = resolveRoute(modules, slug)
  if (matched) return { kind: 'route', matched }

  if (slug.length === 2) {
    const entry = catalog.find((e) => e.id === slug[0])
    if (entry && entry.kind === 'module') {
      const seg = slug[1]
      const declared = (entry.subpages ?? []).find((s) => s.slug === seg)
      const base = BASE_SUBPAGES.find((s) => s.slug === seg)
      const sp = declared ?? base
      if (sp) return { kind: 'stub', entry, subpage: sp }
    }
  }
  return { kind: 'notfound' }
}
