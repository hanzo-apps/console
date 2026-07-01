/**
 * Prompts API — Hanzo Prompts (versioned prompt management: a named prompt with
 * labels, tags, and a version history the gateway can resolve at call time).
 *
 * The DOCUMENTED contract is the cloud `/v1/prompts` surface (cloud
 * `clients/prompts`), called SAME-ORIGIN with NO prefix (`originV1Url('prompts')`
 * → `<origin>/v1/prompts`, the CTO one-endpoint-form). `next.config.mjs` rewrites
 * the `prompts` head to the console's OWN user-bearer proxy (`app/cloud`), which
 * mints a short-lived user-bound IAM token server-side and forwards it; the cloud
 * backend resolves the org from the token's `owner` claim, so every read is
 * org-scoped server-side and NO credential reaches the browser. This is the SAME
 * per-tenant path Agents + Evals use (allow-listed in `proxy-allow.ts`).
 *
 * The BROKEN pattern this replaces was a cookie-only `v1Url('prompts')` call to the
 * cloud origin: the cloud prompts surface authorizes on the Bearer owner claim and
 * 403s a cookie-only request ("X-Org-Id required"), which surfaced as the live
 * "Access required · GET /v1/prompts" card. Same class as the old "models" bug.
 *
 * Routes (from cloud `clients/prompts/prompts.go`):
 *   - GET    /v1/prompts            list prompt metadata
 *   - POST   /v1/prompts            create a prompt
 *   - GET    /v1/prompts/metrics    usage/performance metrics
 *   - GET    /v1/prompts/:name      prompt detail + version history
 *   - DELETE /v1/prompts/:name      delete a prompt
 *
 * Plain REST (raw JSON, real HTTP status), not the casibase envelope. Payloads are
 * normalized DEFENSIVELY — a field rename upstream degrades a cell rather than
 * throwing, and the list is read from whichever envelope key the backend uses
 * (`data` / `prompts` / `items` / `rows`, or a bare array).
 */
import { restGet, restPost, restDelete, originV1Url } from './client'

/** Facade base path (same-origin `/v1/prompts`). */
const BASE = 'prompts'
const enc = encodeURIComponent

// ── Coercion helpers (defensive, agents.ts style) ───────────────────────────
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : undefined
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** A list of strings from an array of strings, or `undefined` when absent/empty. */
const strList = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined
  const xs = v.map((x) => (typeof x === 'string' ? x : String(x))).filter((x) => x.trim() !== '')
  return xs.length ? xs : undefined
}

/** A list of version numbers from an array of numbers/strings, or `undefined`. */
const numList = (v: unknown): number[] | undefined => {
  if (!Array.isArray(v)) return undefined
  const xs = v.map(num).filter((n): n is number => n !== undefined)
  return xs.length ? xs : undefined
}

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

// ── Domain types ────────────────────────────────────────────────────────────

/** One prompt in the registry (list row). Most fields are optional — the UI shows "—". */
export type Prompt = {
  name: string
  /** The version numbers that exist for this prompt (e.g. `[1, 2, 3]`). */
  versions?: number[]
  /** `text` | `chat` — the prompt kind, as the backend reports it. */
  type?: string
  /** Deploy labels (e.g. `production`, `latest`). */
  labels?: string[]
  /** Free-form tags. */
  tags?: string[]
  lastUpdatedAt?: string
}

/** A create-prompt body (POST /v1/prompts). */
export type NewPromptBody = {
  name: string
  type?: string
  prompt: string
  labels?: string[]
  tags?: string[]
}

/** One row of the prompt-metrics table (usage/performance per prompt version). */
export type PromptMetricRow = Record<string, unknown> & { __rowId: string }

// ── Normalizers (pure — unit-tested) ────────────────────────────────────────

/** Normalize one registry record to a `Prompt` (drops un-named rows). */
export function normalizePrompt(raw: unknown): Prompt | null {
  const r = asRecord(raw)
  const name = str(r.name) ?? str(r.id) ?? str(r.slug)
  if (!name) return null
  return {
    name,
    versions: numList(r.versions) ?? numList(r.versionList) ?? numList(asRecord(r.meta).versions),
    type: str(r.type) ?? str(r.kind) ?? str(r.promptType),
    labels: strList(r.labels),
    tags: strList(r.tags),
    lastUpdatedAt:
      str(r.lastUpdatedAt) ?? str(r.updatedAt) ?? str(r.updatedTime) ?? str(r.updated_at) ?? str(r.modifiedAt),
  }
}

/** Normalize an inventory payload to the list of prompts (any envelope key or bare array). */
export function normalizePrompts(payload: unknown): Prompt[] {
  return arrayUnder(payload, ['data', 'prompts', 'items', 'rows'])
    .map(normalizePrompt)
    .filter((p): p is Prompt => p !== null)
}

/**
 * Normalize a metrics payload to table rows. Each row keeps its raw fields (the
 * metrics table renders columns opportunistically) plus a stable `__rowId` for the
 * key. Reads from `data` / `metrics` / `rows` / a bare array. PURE.
 */
export function normalizeMetricRows(payload: unknown): PromptMetricRow[] {
  return arrayUnder(payload, ['data', 'metrics', 'rows', 'items']).map((row, i) => ({
    ...row,
    __rowId: str(row.name) ?? str(row.id) ?? `metric-${i}`,
  }))
}

// ── Network methods (thin — forward-compatible against the documented contract) ─

export const PromptsApi = {
  /** The prompt registry (`GET /v1/prompts`). Honest-empty/error until bound. */
  list: (): Promise<Prompt[]> => restGet<unknown>(originV1Url(BASE)).then(normalizePrompts),

  /** One prompt's detail + version history (`GET /v1/prompts/{name}`) — raw payload. */
  get: (name: string): Promise<unknown> => restGet<unknown>(originV1Url(`${BASE}/${enc(name)}`)),

  /** Prompt usage/performance metrics (`GET /v1/prompts/metrics`) — normalized rows. */
  metrics: (): Promise<PromptMetricRow[]> =>
    restGet<unknown>(originV1Url(`${BASE}/metrics`)).then(normalizeMetricRows),

  /** Create a prompt (`POST /v1/prompts`). */
  create: (body: NewPromptBody): Promise<unknown> => restPost<unknown>(originV1Url(BASE), body),

  /** Delete a prompt (`DELETE /v1/prompts/{name}`). */
  remove: (name: string): Promise<void> => restDelete(originV1Url(`${BASE}/${enc(name)}`)),
}
