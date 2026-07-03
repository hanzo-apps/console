/**
 * Pure logic for the Web Search + Crawl product panel — the decisions the module
 * renders, kept out of the component so they are unit-tested (never eyeballed).
 * No React, no network: functions over plain data.
 */
import type { SearchResult, WebSearchEndpoint } from '~/lib/api/websearch'

/** The panel's health verdict, derived from a REAL live search probe. */
export type SearchHealth = 'healthy' | 'reachable' | 'down' | 'unknown'

/**
 * Derive the pipeline health from a live search probe outcome. There is no dedicated
 * `/v1/websearch/health` endpoint, so a real query IS the probe:
 *   - the probe returned ≥1 result   → `healthy`  (SearXNG → cloud path fully works).
 *   - the probe returned 0 results   → `reachable` (the proxy answered, but the query
 *     had no hits — the pipeline is up; honest, not a fabricated "healthy").
 *   - the probe threw (403/404/5xx)  → `down`      (the pipeline is not reachable).
 *   - not probed yet                 → `unknown`.
 * Pure so the badge color is tested, not guessed.
 */
export function deriveSearchHealth(probe: { ok: boolean; results: number } | null): SearchHealth {
  if (!probe) return 'unknown'
  if (!probe.ok) return 'down'
  return probe.results > 0 ? 'healthy' : 'reachable'
}

/** Human label + status-dot verdict for a `SearchHealth`. */
export function searchHealthLabel(h: SearchHealth): { label: string; tone: 'green' | 'yellow' | 'red' | 'gray' } {
  switch (h) {
    case 'healthy':
      return { label: 'Operational', tone: 'green' }
    case 'reachable':
      return { label: 'Reachable', tone: 'yellow' }
    case 'down':
      return { label: 'Not reachable', tone: 'red' }
    default:
      return { label: 'Checking…', tone: 'gray' }
  }
}

/**
 * The tabbed sections of the panel (`:tab` route, like Functions/GPUs/Models).
 *
 * The slugs are deliberately NON-base (`search`/`api`/`engines`/`config`) so they
 * route to this module's `:tab` handler and never collide with the shared per-product
 * base sub-pages (Settings/Status/Logs/Metrics), which render the real deployment
 * facts for EVERY product (DRY). "Config" is this module's product-specific read-only
 * configuration view; the uniform "Settings" base sub-page stays the shared one.
 */
export const SEARCH_TABS = [
  { id: '', label: 'Overview' },
  { id: 'search', label: 'Try Search' },
  { id: 'api', label: 'API' },
  { id: 'engines', label: 'Engines' },
  { id: 'config', label: 'Config' },
] as const

export type SearchTabId = (typeof SEARCH_TABS)[number]['id']

/** Resolve a raw `:tab` param to a known tab id (unknown → Overview). */
export function resolveTab(raw: string | undefined): SearchTabId {
  return (SEARCH_TABS.some((t) => t.id === raw) ? (raw as SearchTabId) : '') as SearchTabId
}

/**
 * A copy-pasteable curl example for an endpoint, built against the caller's origin
 * (the same-origin `/v1/websearch/*` the console uses). The host is passed in (the
 * caller reads `window.location.origin`) so this stays pure + testable.
 */
export function curlFor(endpoint: WebSearchEndpoint, origin: string): string {
  const base = origin.replace(/\/+$/, '')
  if (endpoint.method === 'GET') {
    // Search — a plain GET with the query + json format.
    return `curl '${base}${endpoint.path}?q=hanzo+ai&format=json'`
  }
  // Scrape — a POST with the firecrawl body + the shared crawl key (server-side).
  return [
    `curl -X POST '${base}${endpoint.path}' \\`,
    `  -H 'Authorization: Bearer $WEBSEARCH_API_KEY' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"url":"https://example.com"}'`,
  ].join('\n')
}

/** A short host for each result row (the domain), for a compact secondary line. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/** Drop results with no title AND no snippet (nothing to render) — defensive display filter. */
export function presentableResults(results: SearchResult[]): SearchResult[] {
  return results.filter((r) => r.title || r.content)
}
