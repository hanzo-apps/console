/**
 * Web Search + Crawl API — the console client for the LIVE self-hosted web-search
 * product (SearXNG + Crawl4AI), served by cloud `clients/websearch` at
 * `/v1/websearch/*`. Self-hosted, no third-party keys.
 *
 * ENDPOINTS (verified against `hanzoai/cloud/clients/websearch/websearch.go`):
 *   - `GET  /v1/websearch/search`     — SearXNG meta-search proxy. Query passthrough
 *     (`?q=&format=json&engines=&language=&safesearch=`). Response is the SearXNG
 *     JSON: `{ results: [{ url, title, content, img_src?, engine? }] }`. The optional
 *     `X-API-Key` guard admits a MISSING key, so a signed-in user-bearer call passes.
 *   - `POST /v1/websearch/scrape`  — Crawl4AI (Firecrawl-compatible). Body `{url}`,
 *     response `{ success, data:{ markdown, metadata }, error? }`. FAIL-CLOSED: it
 *     requires `Authorization: Bearer <WEBSEARCH_API_KEY>` (the shared crawl key, NOT
 *     an IAM user token) and 503s when unconfigured — so the console CANNOT drive a
 *     live scrape with a user session. The panel documents scrape (endpoint + example)
 *     honestly and does NOT offer a live try-it for it. Search alone is user-callable.
 *
 * TRANSPORT: search is reached at the console's OWN same-origin `/v1/websearch/search`
 * (`originV1Url` — nothing before `/v1/`, the CTO prefix-free contract); `next.config.
 * mjs` rewrites the `websearch` head to the hardened `/v1` user-bearer proxy, which
 * mints a short-lived IAM token server-side (the browser stays keyless). The response
 * is BARE SearXNG JSON (not the casibase envelope) → plain `restGet`. The `search`
 * subsystem has no principal gate, so the minted bearer is accepted (or ignored) and
 * the query proxies straight to SearXNG.
 *
 * NO usage metering exists for websearch yet (it is treated as infra, not a metered
 * product — no `cloud_usage` ledger rows, no product tag). The panel says so honestly
 * and never fabricates a request-volume number. There is also no dedicated
 * `/v1/websearch/health` endpoint — the module derives "healthy" from a real live
 * search probe (a query that returns results proves the SearXNG→cloud path is up).
 */
import { originV1Url, restGet } from './client'

/** One SearXNG result row (the fields the meta-search returns for a hit). */
export type SearchResult = {
  /** The result URL (the locator + row key). */
  url: string
  title: string
  /** Snippet / description text SearXNG extracted. */
  content: string
  /** Thumbnail image URL, when the engine provided one (image results). */
  imgSrc?: string
  /** The upstream engine that produced the hit (google/bing/…), when reported. */
  engine?: string
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Normalize a raw SearXNG result row → `SearchResult`. Defensive: SearXNG's field
 * set varies by engine, so read only the stable four and drop anything without a URL
 * (a hit with no locator is not renderable). Never throws — a garbage row → skipped.
 */
export function normalizeResult(raw: unknown): SearchResult | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const url = str(r.url)
  if (!url) return null
  const out: SearchResult = { url, title: str(r.title) || url, content: str(r.content) }
  const img = str(r.img_src)
  if (img) out.imgSrc = img
  const engine = str(r.engine)
  if (engine) out.engine = engine
  return out
}

/**
 * Extract the result rows from a SearXNG `?format=json` payload. The array lives at
 * `results`; anything else (an error object, an empty body) yields `[]` so the caller
 * renders an honest empty state, never a crash.
 */
export function normalizeSearch(raw: unknown): SearchResult[] {
  const r = (raw ?? {}) as Record<string, unknown>
  const rows = Array.isArray(r.results) ? r.results : []
  return rows.map(normalizeResult).filter((x): x is SearchResult => x !== null)
}

export const WebSearchApi = {
  /**
   * Run a live web search over the self-hosted SearXNG through the `/v1` bearer
   * proxy. Returns the normalized hit list (honest `[]` when empty). Throws a typed
   * `ApiError` the caller renders as an honest state (a 403/404/5xx from the pipeline
   * → "not reachable", never a fabricated result). `format=json` is required or
   * SearXNG 403s the JSON view.
   */
  search: async (query: string): Promise<SearchResult[]> => {
    const q = query.trim()
    if (!q) return []
    const url = `${originV1Url('websearch/search')}?q=${encodeURIComponent(q)}&format=json`
    const data = await restGet<unknown>(url)
    return normalizeSearch(data)
  },
}

// ── Static, honest product facts (the deployed config, from the operator CRs +
// SearXNG ConfigMap). These are REFERENCE facts shown read-only in the panel — the
// SearXNG engine set and instance are configured in-cluster (ConfigMap), not via an
// API, so the console surfaces them as read-only status (honest, per the v1 spec).

/** The self-hosted SearXNG meta-search engines enabled in the deployed instance
 *  (`universe/infra/k8s/searxng/configmap.yaml` — all key-less HTML/JSON engines). */
export const SEARXNG_ENGINES: readonly string[] = [
  'google',
  'bing',
  'duckduckgo',
  'brave',
  'startpage',
  'wikipedia',
  'wikidata',
  'github',
  'stackoverflow',
]

/** The two `/v1/websearch/*` endpoints, for the API/how-to reference. */
export type WebSearchEndpoint = {
  method: 'GET' | 'POST'
  path: string
  summary: string
  /** True when a signed-in console user can call it live (search yes, scrape no). */
  liveInConsole: boolean
}

export const WEBSEARCH_ENDPOINTS: readonly WebSearchEndpoint[] = [
  {
    method: 'GET',
    path: '/v1/websearch/search',
    summary: 'Meta-search the web (SearXNG). Query passthrough — q, format=json, engines, language, safesearch.',
    liveInConsole: true,
  },
  {
    method: 'POST',
    path: '/v1/websearch/scrape',
    summary: 'Scrape a URL to clean markdown, on Crawl4AI. Body { url } → { success, data:{ markdown, metadata } }.',
    liveInConsole: false,
  },
]
