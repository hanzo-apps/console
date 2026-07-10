/**
 * Code API — Hanzo Cloud code intelligence (native per-org, HIP-0302): HYBRID
 * retrieval over an org's indexed repos — lexical (FTS5 trigram), symbolic
 * (go/parser + lexical extractors: go-to-symbol + def→ref edges), and semantic
 * (AST-chunk embeddings, cosine) — fused with reciprocal-rank fusion.
 *
 * The DOCUMENTED contract is `GET /v1/code/search`, `GET|POST /v1/code/ask`, and
 * `POST /v1/code/context` on the unified cloud backend, called SAME-ORIGIN with NO
 * prefix (`originV1Url('code/...')` → `<origin>/v1/code/...`, the CTO one-endpoint
 * form). `app/v1/[...path]` mints a short-lived user-bound IAM token server-side and
 * forwards it; the cloud handler resolves the org from the token's `owner` claim
 * (`principal.Tenant`) and the tenant boundary is a PHYSICAL per-org SQLite file — so
 * every read is org-scoped SERVER-SIDE and NO org param is ever sent from the browser.
 * `code` is allow-listed in `proxy-allow.ts` exactly like `agents`/`prompts`.
 *
 * Until the `/v1/code` route is bound the calls 404 and callers render an honest
 * "not connected" state (`classifyBackend`) — never a fabricated result. Everything
 * shown is a real returned span/citation or DERIVED from real rows (`searchFacets`);
 * a field a row omits reads "—". Plain REST (raw JSON, real HTTP status), the same
 * `restGet`/`restPost` transport as agents/functions — payloads are normalized
 * DEFENSIVELY (a rename upstream degrades a cell rather than throwing), the list read
 * from whichever envelope key the backend uses (`results` / `spans` / `data` / `items`).
 */
import { restGet, restPost, originV1Url } from './client'

/** Inventory facade base path (same-origin `/v1/code`). */
const BASE = 'code'

/** Default + max result count the dashboard requests (the backend caps at 100). */
export const SEARCH_LIMIT = 50

// ── Coercion helpers (defensive, agents.ts style) ────────────────────────────
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : undefined
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Pull the first array found under any of the common envelope keys (or the root). */
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

// ── Domain types ─────────────────────────────────────────────────────────────

/** The search modes the dashboard surfaces — each a REAL backend retrieval tier
 *  (`text`/`symbol`/`semantic`) plus the fused default (`hybrid`). The engine also
 *  accepts `regex`; we omit it from the selector (it needs valid regex syntax — a
 *  footgun in a plain box) and default any unknown value to `hybrid`, as the backend
 *  does. */
export type SearchType = 'hybrid' | 'text' | 'symbol' | 'semantic'
export const SEARCH_TYPES: SearchType[] = ['hybrid', 'text', 'symbol', 'semantic']
export const SEARCH_TYPE_LABEL: Record<SearchType, string> = {
  hybrid: 'Hybrid',
  text: 'Text',
  symbol: 'Symbol',
  semantic: 'Semantic',
}

/** Fold a loose type string into one of the surfaced modes (unknown → hybrid). PURE. */
export function canonicalType(raw?: string): SearchType {
  const t = (raw ?? '').toLowerCase().trim()
  return (SEARCH_TYPES as string[]).includes(t) ? (t as SearchType) : 'hybrid'
}

/**
 * One retrieval hit — a span of code the engine matched. `kind`/`symbol`/`tier`/`role`
 * are optional (a lexical hit carries no symbol; a bare match no tier), so the UI
 * renders what is present and shows "—" for the rest.
 */
export type Span = {
  repo: string
  file: string
  line: number
  endLine: number
  /** Symbol kind (func/type/method/const…) when the hit is symbolic. */
  kind?: string
  /** Symbol name when the hit resolved one. */
  symbol?: string
  snippet: string
  /** Fused/relevance score (RRF for hybrid, cosine for semantic, rank for symbol). */
  score: number
  /** Which retrieval tier surfaced it: text | symbol | semantic | hybrid. */
  tier?: string
  /** Context role in a packed bundle: match | definition | caller. */
  role?: string
}

/** The `GET /v1/code/search` result. `degraded` = retrieval had a partial outage. */
export type SearchResult = {
  query: string
  type: SearchType
  results: Span[]
  degraded: boolean
}

/** One citation the `/ask` answer was grounded on — a locator (no snippet). */
export type Citation = {
  repo?: string
  file: string
  line: number
  endLine: number
  symbol?: string
}

/** The `GET|POST /v1/code/ask` result — the synthesized answer + its citations. */
export type AskResult = {
  question: string
  answer: string
  citations: Citation[]
  /** `true` = retrieval succeeded but synthesis was unavailable (cited spans only). */
  degraded: boolean
}

/** The `POST /v1/code/context` result — a budget-packed context bundle for an agent. */
export type ContextBundle = {
  query: string
  repo?: string
  budgetTokens: number
  usedTokens: number
  spans: Span[]
}

// ── Normalizers (pure — unit-tested) ─────────────────────────────────────────

/** Normalize one hit to a `Span` (drops rows with no file — the locator is mandatory). */
export function normalizeSpan(raw: unknown): Span | null {
  const r = asRecord(raw)
  const file = str(r.file) ?? str(r.path) ?? str(r.filename)
  if (!file) return null
  const line = num(r.line) ?? num(r.startLine) ?? num(r.lineNumber) ?? 0
  const endLine = num(r.endLine) ?? num(r.end) ?? line
  return {
    repo: str(r.repo) ?? str(r.repository) ?? '',
    file,
    line,
    endLine: endLine < line ? line : endLine,
    kind: str(r.kind) ?? str(r.type),
    symbol: str(r.symbol) ?? str(r.name),
    snippet: str(r.snippet) ?? str(r.text) ?? str(r.content) ?? '',
    score: num(r.score) ?? 0,
    tier: str(r.tier) ?? str(r.source),
    role: str(r.role),
  }
}

/** Normalize a list of hits under any of the common envelope keys. */
export function normalizeSpans(payload: unknown): Span[] {
  return arrayUnder(payload, ['results', 'spans', 'data', 'items', 'rows'])
    .map(normalizeSpan)
    .filter((s): s is Span => s !== null)
}

/** Normalize the search payload → `{ query, type, results, degraded }`. The response
 *  usually echoes the resolved `type`; when it omits one, keep the caller's request. */
export function normalizeSearch(payload: unknown, fallbackType: SearchType): SearchResult {
  const r = asRecord(payload)
  const rawType = str(r.type)
  return {
    query: str(r.query) ?? '',
    type: rawType ? canonicalType(rawType) : fallbackType,
    results: normalizeSpans(payload),
    degraded: r.degraded === true,
  }
}

/** Normalize one citation (drops rows with no file — the locator is mandatory). */
export function normalizeCitation(raw: unknown): Citation | null {
  const r = asRecord(raw)
  const file = str(r.file) ?? str(r.path)
  if (!file) return null
  const line = num(r.line) ?? num(r.startLine) ?? 0
  const endLine = num(r.endLine) ?? line
  return {
    repo: str(r.repo) ?? str(r.repository),
    file,
    line,
    endLine: endLine < line ? line : endLine,
    symbol: str(r.symbol) ?? str(r.name),
  }
}

/** Normalize the ask payload → `{ question, answer, citations, degraded }`. */
export function normalizeAsk(payload: unknown): AskResult {
  const r = asRecord(payload)
  const citations = arrayUnder(payload, ['citations', 'sources', 'data', 'items'])
    .map(normalizeCitation)
    .filter((c): c is Citation => c !== null)
  return {
    question: str(r.question) ?? str(r.query) ?? '',
    answer: str(r.answer) ?? str(r.text) ?? '',
    citations,
    degraded: r.degraded === true,
  }
}

/** Normalize the context payload → `{ query, repo, budgetTokens, usedTokens, spans }`. */
export function normalizeContext(payload: unknown): ContextBundle {
  const r = asRecord(payload)
  return {
    query: str(r.query) ?? '',
    repo: str(r.repo),
    budgetTokens: num(r.budgetTokens) ?? 0,
    usedTokens: num(r.usedTokens) ?? 0,
    spans: normalizeSpans({ spans: r.spans ?? r.results }),
  }
}

// ── Derived summary + refs (pure — unit-tested) ──────────────────────────────

/**
 * Facets DERIVED from the current search's real spans — the honest per-search
 * summary the results panel shows (never a fabricated GLOBAL index count, which no
 * read endpoint exposes): total hits, the distinct repos matched, and the per-tier
 * / per-kind breakdown. PURE.
 */
export type SearchFacets = {
  count: number
  repos: string[]
  tiers: Record<string, number>
  kinds: Record<string, number>
  /** The largest score in the set (for a relative score bar; `0` when empty). */
  maxScore: number
}

export function searchFacets(spans: Span[]): SearchFacets {
  const repos = new Set<string>()
  const tiers: Record<string, number> = {}
  const kinds: Record<string, number> = {}
  let maxScore = 0
  for (const s of spans) {
    if (s.repo) repos.add(s.repo)
    if (s.tier) tiers[s.tier] = (tiers[s.tier] ?? 0) + 1
    if (s.kind) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1
    if (Number.isFinite(s.score) && s.score > maxScore) maxScore = s.score
  }
  return { count: spans.length, repos: [...repos].sort(), tiers, kinds, maxScore }
}

/** A stable React key for a span (position-qualified so identical locators don't clash). */
export const spanKey = (s: Span, i: number): string => `${s.repo}:${s.file}:${s.line}:${i}`

const EM = '—'

/** A `file:line` (or `file:line-endLine`) locator label. Em dash for a missing file. */
export function locRef(loc: { file?: string; line?: number; endLine?: number }): string {
  if (!loc.file) return EM
  const line = loc.line ?? 0
  const end = loc.endLine ?? line
  return end > line ? `${loc.file}:${line}-${end}` : `${loc.file}:${line}`
}

/** The full copyable reference for a span/citation (`repo file:line`). */
export function fullRef(loc: { repo?: string; file?: string; line?: number; endLine?: number }): string {
  const ref = locRef(loc)
  return loc.repo ? `${loc.repo} ${ref}` : ref
}

/** Score to a compact string; em dash for a non-finite value. */
export const fmtScore = (n?: number | null): string =>
  n === undefined || n === null || !Number.isFinite(n) ? EM : n >= 1 ? n.toFixed(2) : n.toFixed(3)

/** Relative width 0..1 of a score against the set max (for the score bar). PURE. */
export const scoreFraction = (score: number, max: number): number =>
  max > 0 && Number.isFinite(score) ? Math.max(0, Math.min(1, score / max)) : 0

// ── Network methods (thin — forward-compatible against the documented contract) ─

/** Build `<origin>/v1/code/<path>?<query>` with proper encoding (no org param — the
 *  server resolves tenancy from the minted Bearer owner). */
function codeUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === '') continue
      sp.set(k, String(v))
    }
  }
  const qs = sp.toString()
  return originV1Url(qs ? `${BASE}/${path}?${qs}` : `${BASE}/${path}`)
}

export const CodeApi = {
  /**
   * Hybrid code search (`GET /v1/code/search`). Org-scoped server-side; `type` is one
   * of the four surfaced modes, `repo` an optional scope. Honest-empty/error until bound.
   */
  search: (q: string, type: SearchType, repo?: string, limit = SEARCH_LIMIT): Promise<SearchResult> =>
    restGet<unknown>(codeUrl('search', { q, type, repo, limit })).then((p) => normalizeSearch(p, type)),

  /** Cited RAG answer over the org's index (`GET /v1/code/ask`), optional `repo` scope. */
  ask: (q: string, repo?: string): Promise<AskResult> =>
    restGet<unknown>(codeUrl('ask', { q, repo })).then(normalizeAsk),

  /** Budget-packed context bundle for an agent (`POST /v1/code/context`). */
  context: (query: string, repo?: string, budgetTokens?: number): Promise<ContextBundle> =>
    restPost<unknown>(originV1Url(`${BASE}/context`), { query, repo, budgetTokens }).then(normalizeContext),
}
