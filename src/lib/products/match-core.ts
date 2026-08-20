/**
 * Pure catalog matching — routing + filtering, with NO runtime registry import
 * (types only, erased by the compiler). Kept separate from `match.ts`/`search.ts`
 * (which bind these to the real `productModules`/`catalog`) so the logic is unit-
 * testable in a plain-node test without pulling the GUI component tree.
 */
import type { CatalogEntry, ProductModule, ProductRoute, ProductSubpage } from './registry'
import { type Stage, type Viewer, operator, listed, stageOf } from './stage'

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
 * label/id/category/description? Empty query → true (everything shows). Unlike
 * `searchCatalog` (which RANKS into a flat list), the sidebar keeps its category
 * grouping and just needs a per-entry predicate.
 */
export function entryMatches(e: CatalogEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `${e.label} ${e.id} ${e.category} ${e.description}`.toLowerCase().includes(q)
}

// ── Slug aliases (conventional URL → canonical entry id) ─────────────────────

/**
 * Conventional / intuitive slugs that a user (or an external doc, bookmark, or a
 * hand-typed URL) reasonably expects, mapped to the canonical catalog `id`. The
 * nav/⌘K always open the canonical id, so these aliases exist ONLY to
 * keep a directly-navigated URL from 404ing — the ONE place aliasing is defined
 * (DRY), consumed only by `resolveProductView`.
 *
 * `auto`/`automation` → `automations` (the ONE native Automations module; the
 * external auto.hanzo.ai engine + its `/v1/auto` proxy are retired), and
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
  traces: 'o11y',
  // `deploy` used to alias App Platform, back when the PaaS canvas was the only
  // place a deploy happened. It is a real product now — the front door over apps,
  // sites, domains, CD, CI, and storage — so the slug resolves to itself and App
  // Platform keeps its own id. An alias to a sibling would make the front door
  // unreachable: `canonicalSlug` rewrites the head before any lookup.
  'plans-pricing': 'plans',
  wallets: 'wallet',
  'model-catalog': 'models',
  'fine-tuning': 'finetuning',
  'web-search': 'websearch',
  // The former standalone Git product folded into the unified Code hub — a bookmarked
  // `/git` lands on the hub (never a 404); the canonical repo path is `/code/repos/:name`.
  git: 'code',
  // Records was a second product over the org's own Base, from when a separate
  // orchestrator deployment held a registry of Base instances and "which Base" was
  // a question worth a page. An org has one Base, so browsing it is not a different
  // product from having it: `/records/:collection/:id` lands on the same view under
  // `/base`, because the route shapes are identical.
  records: 'base',
}

/**
 * The address, as the segments the registry matches against. `/` → `[]`.
 *
 * ONE reader, because the URL is the app's only source of truth about which screen
 * it is on: production serves one index.html for every address, so a slug can never
 * come from a route param without the two disagreeing the moment the address changes
 * without a document load.
 */
export function slugOf(pathname: string): string[] {
  return pathname.split('/').filter(Boolean)
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

/** The index sub-page for a product: its own `indexLabel` when it names its index
 *  (Models → Catalog, Tasks → Workflows), else the uniform "Overview". */
export const indexSubpage = (entry: CatalogEntry): ProductSubpage =>
  entry.indexLabel ? { ...OVERVIEW_SUBPAGE, label: entry.indexLabel } : OVERVIEW_SUBPAGE

/**
 * The uniform base sub-page set every product gets, in exact order, so no
 * product is a snowflake. Overview ('') is prepended separately; a product's own
 * declared specific that owns one of these slugs takes precedence (deduped).
 */
export const BASE_SUBPAGES: ProductSubpage[] = [
  { slug: 'settings', label: 'Settings' },
  // Observability trio reads raw → summary: Logs, then Metrics, then Status LAST
  // (the live-health verdict comes after the signals it is derived from).
  { slug: 'logs', label: 'Logs' },
  { slug: 'metrics', label: 'Metrics' },
  { slug: 'status', label: 'Status' },
]

/**
 * The base sub-pages a product actually gets: the uniform set minus any whose
 * slug IS the product's own id. A product that already IS one of these concerns
 * — Settings, Status, Logs, Metrics — must not also carry a base sub-tab bearing
 * its own name (that is a self-referential duplicate: the Settings product would
 * show a "Settings" tab of itself). One rule, read by both the nav and the
 * router, so the two never disagree on whether that tab exists.
 */
export const baseSubpagesFor = (entry: CatalogEntry): ProductSubpage[] =>
  BASE_SUBPAGES.filter((b) => b.slug !== entry.id)

/**
 * The full ordered level-2 nav for a product: Overview, then its declared
 * SPECIFIC sub-pages, then the uniform base set (`baseSubpagesFor` — the uniform
 * set minus any slug that IS the product's own id, so Settings has no "Settings"
 * child). A base slug the product already declares as a specific is not duplicated.
 * Non-module entries have none.
 *
 * `viewer` narrows the specifics by STAGE — the same axis and the same predicate
 * the catalog uses, so an admin or pre-GA tab is absent from the sub-nav and ⌘K
 * for exactly the people it is absent from the rail for. The default is the
 * operator, which is what a module asking "which tabs do I have?" wants: that is
 * not a nav decision, and the router already made the real one.
 */
export function productSubpages(entry: CatalogEntry, viewer: Viewer = operator): ProductSubpage[] {
  if (entry.kind !== 'module') return []
  const specifics = (entry.subpages ?? []).filter((s) => s.slug !== '' && listed(stageOf(s), viewer))
  const seen = new Set(specifics.map((s) => s.slug))
  const out: ProductSubpage[] = [indexSubpage(entry), ...specifics]
  for (const b of baseSubpagesFor(entry)) if (!seen.has(b.slug)) out.push(b)
  return out
}

/**
 * The level-2 slug a URL segment selects within a product — the segment itself
 * when it is one of the product's own sub-pages, else '' (the index). ONE
 * validator: the nav highlights and the module switches on the same answer, so a
 * hand-typed `/tasks/bogus` can never light a tab the module doesn't render.
 */
export function subpageSlug(entry: CatalogEntry, seg: string | undefined, viewer: Viewer = operator): string {
  if (!seg) return ''
  return productSubpages(entry, viewer).some((s) => s.slug === seg) ? seg : ''
}

/** The URL for a product's sub-page — `/id` for the index, `/id/slug` otherwise. */
export const subpageHref = (id: string, slug: string): string => (slug ? `/${id}/${slug}` : `/${id}`)

/**
 * The sub-page slug the CURRENT path is on within a product ('' = index; '' when
 * the path is elsewhere entirely). Level 2 is carried by the URL — nothing else —
 * so a reload, a deep link, and Back all resolve to the same nav state.
 */
export function activeSubpage(pathname: string, id: string): string {
  const segs = pathname.split('/').filter(Boolean)
  if (segs[0] !== id) return ''
  return segs[1] ?? ''
}

/**
 * The stage an ADDRESS renders at: the sub-page's when the address names one,
 * else the product's. The catch-all weighs this with `reachable` to render the
 * honest "managed by Hanzo" notice instead of letting the module throw a 403.
 *
 * The deeper of the two wins, because a GA product can hold an operator-only tab
 * (Models › Routing) and the tab is what the address asked for. An address that
 * names no product at all is `ga` — 404 is `resolveProductView`'s answer, not a
 * visibility decision.
 */
export function stageAt(catalog: CatalogEntry[], slug: string[]): Stage {
  const entry = catalog.find((e) => e.id === slug[0])
  if (!entry || entry.kind !== 'module') return 'ga'
  const seg = slug[1]
  const sub = seg ? (entry.subpages ?? []).find((s) => s.slug === seg) : undefined
  return sub ? stageOf(sub) : stageOf(entry)
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
 * specific sub-pages. Both levels are narrowed by the SAME stage predicate the
 * rail uses, so the palette can never offer a jump to a surface the nav hides.
 * Pure (takes the catalog), so the indexing is unit-testable without the GUI tree.
 */
export function destinationsFor(catalog: CatalogEntry[], viewer: Viewer): Destination[] {
  const products = catalog.filter((e) => listed(stageOf(e), viewer))
  const out: Destination[] = products.map((entry) => ({ kind: 'product', entry }))
  for (const entry of products) {
    if (entry.kind !== 'module') continue
    for (const sp of entry.subpages ?? []) {
      if (sp.slug === '' || !listed(stageOf(sp), viewer)) continue
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
  // instead of 404ing. The nav/palette never produce this (they `openProduct`
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
  // up front, so aliasing lives in exactly one place
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
      const base = baseSubpagesFor(entry).find((s) => s.slug === seg)
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
      const base = baseSubpagesFor(entry).find((s) => s.slug === seg)
      const sp = declared ?? base
      if (sp) return { kind: 'stub', entry, subpage: sp }
    }
  }
  return { kind: 'notfound' }
}
