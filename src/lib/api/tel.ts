/**
 * Telecom API — phone numbers, calls and messages over the REAL cloud `/v1/tel`
 * surface (cloud `apps/tel`: a native-Go, per-org telecom plane on Base/SQLite,
 * carrier-agnostic by construction — `Carrier` is the whole contract and the
 * concrete one is deployment configuration).
 *
 * Every call is same-origin, keyless and prefix-free (`originV1Url('tel/...')` →
 * `<origin>/v1/tel/...`, the CTO one-endpoint form). The console's OWN `app/v1`
 * user-bearer BFF serves the `tel` head — it mints a short-lived user-bound IAM
 * token server-side and forwards it; cloud resolves the org from the token's
 * owner claim (`principal.RequireOrg`), so every read/write is org-scoped
 * SERVER-SIDE and no credential reaches the browser. A cookie-only call would
 * 403, so the bearer BFF is mandatory — the `tel` head is allow-listed in
 * `proxy-allow.ts` CLOUD_HEADS. This is the EXACT path crm/tracker/agents take.
 *
 * Routes (from cloud `apps/tel/tel.go`, all typed zip ops):
 *   GET    /v1/tel/summary             per-org roll-up   -> {numbers,calls,messages}
 *   GET    /v1/tel/numbers/available   carrier inventory -> {data:[Number]}  (?country= REQUIRED)
 *   GET    /v1/tel/numbers             numbers held      -> {data:[Number]}
 *   POST   /v1/tel/numbers             buy one           -> Number  (201)
 *   DELETE /v1/tel/numbers/:id         release one
 *   GET    /v1/tel/calls               call records      -> {data:[Call]}
 *   POST   /v1/tel/calls               place a call      -> Call    (201)
 *   DELETE /v1/tel/calls/:id           hang up
 *   GET    /v1/tel/messages            message records   -> {data:[Message]}
 *   POST   /v1/tel/messages            send one          -> Message (201)
 *
 * WIRE SHAPE, measured against the code rather than the doc comment: zip typed ops
 * write `c.JSON(out)` — bare JSON, NOT the casibase `{status,msg,data}` envelope.
 * So a list is `{data:[…]}` (wrapped, unlike tracker's bare arrays), a create is the
 * bare record at 201, and a delete answers 200 `{}` (the handler returns an empty
 * struct with no `WithStatus`). `restDelete` handles both 200 and 204.
 *
 * TWO BACKEND RULES the caller must respect or every write 403s:
 *   - `from` on a call or a message must be a number THIS org holds
 *     (`store.NumberByE164`). The module therefore offers `from` as a SELECT over
 *     held numbers, never free text.
 *   - `/numbers/available` REQUIRES `country` (400 otherwise), so `available()`
 *     takes it as a required argument rather than an optional filter.
 * `agent` set with no assistant plane configured answers 424.
 *
 * `Number` is the wire's own name for the value and it is kept: TypeScript's type
 * and value namespaces are separate, so this shadows the global `Number` TYPE only
 * — `Number(x)` the constructor is untouched here and at every import site. Do not
 * rename it to a compound; the backend, the route and the UI say one word.
 *
 * Payloads normalize DEFENSIVELY — a field rename upstream degrades a cell rather
 * than throwing, and a list is read from whichever envelope key the backend uses
 * (`data`/`items`/`rows`, or a bare array). PURE normalizers are unit-tested
 * (tel.test.ts).
 */
import { restGet, restPost, restDelete, originV1Url } from './client'

const BASE = 'tel'
const enc = encodeURIComponent

// ── Coercion helpers (defensive; crm.ts style) ──────────────────────────────
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return 0
}
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s) => s !== '') : [])

/** Pull the first array found under any common envelope key (or the root). */
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
export const rows = (payload: unknown): Record<string, unknown>[] => arrayUnder(payload, ['data', 'items', 'rows'])

// ── Domain types (mirror cloud apps/tel/carrier.go JSON tags) ───────────────

/** What a number can carry, as the carrier reports it. */
export const CAPABILITIES = ['voice', 'sms', 'mms', 'fax'] as const

/** Number kinds a search may narrow to ('' = any). */
export const NUMBER_TYPES = ['local', 'national', 'tollfree', 'mobile'] as const

/** Call lifecycle, as the carrier reports it. */
export const CALL_STATUSES = ['queued', 'ringing', 'answered', 'completed', 'failed'] as const

/** Message lifecycle. `queued` is acceptance, NOT delivery — the backend is
 *  deliberate about that distinction and the UI must not collapse it. */
export const MESSAGE_STATUSES = ['queued', 'sent', 'delivered', 'failed'] as const

/** A phone number as this platform holds it. `monthly` is MINOR units (cents), as
 *  the carrier quoted it; 0 means the carrier quoted no rate, never "free". */
export type Number = {
  id: string
  e164: string
  country: string
  type: string
  capable: string[]
  monthly: number
  currency: string
}

export type Call = {
  id: string
  from: string
  to: string
  status: string
  agent: string
}

export type Message = {
  id: string
  from: string
  to: string
  text: string
  status: string
}

export type Summary = { numbers: number; calls: number; messages: number }

/** Narrows a carrier inventory search. `country` is required — numbering is
 *  national, and a search without one is a question no carrier can answer. */
export type NumberQuery = { country: string; area?: string; type?: string; limit?: number }

/** Create bodies — only the writable fields (the server owns id/org/status). */
export type NewCall = { from: string; to: string; agent?: string; record?: boolean; webhook?: string }
export type NewMessage = { from: string; to: string; text: string; media?: string[] }

// ── Normalizers (pure) ─────────────────────────────────────────────────────

export function normalizeNumber(raw: unknown): Number {
  const r = asRecord(raw)
  return {
    id: str(r.id),
    e164: str(r.e164),
    country: str(r.country),
    type: str(r.type),
    capable: strList(r.capable),
    monthly: num(r.monthly),
    currency: str(r.currency),
  }
}

export function normalizeCall(raw: unknown): Call {
  const r = asRecord(raw)
  return { id: str(r.id), from: str(r.from), to: str(r.to), status: str(r.status), agent: str(r.agent) }
}

export function normalizeMessage(raw: unknown): Message {
  const r = asRecord(raw)
  return { id: str(r.id), from: str(r.from), to: str(r.to), text: str(r.text), status: str(r.status) }
}

export function normalizeSummary(raw: unknown): Summary {
  const r = asRecord(raw)
  return { numbers: num(r.numbers), calls: num(r.calls), messages: num(r.messages) }
}

/** An inventory row carries no id until it is bought, so a search result is kept
 *  on its E.164 — filtering on id would discard every row a search returns. */
export const normalizeAvailable = (p: unknown): Number[] => rows(p).map(normalizeNumber).filter((n) => n.e164)
export const normalizeNumbers = (p: unknown): Number[] => rows(p).map(normalizeNumber).filter((n) => n.id)
export const normalizeCalls = (p: unknown): Call[] => rows(p).map(normalizeCall).filter((c) => c.id)
export const normalizeMessages = (p: unknown): Message[] => rows(p).map(normalizeMessage).filter((m) => m.id)

// ── Pure display helpers ───────────────────────────────────────────────────

/**
 * A carrier's quoted monthly rate, in the currency it quoted. Minor units in,
 * display string out. An unquoted rate (0) is an em-dash, never "$0.00" — the
 * carrier said nothing and the UI must not say something.
 */
export function rate(minor: number, currency: string): string {
  if (!Number.isFinite(minor) || minor <= 0) return '—'
  const code = currency || 'USD'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(minor / 100)
  } catch {
    // An unrecognized ISO code makes Intl throw; the amount is still true.
    return `${(minor / 100).toFixed(2)} ${code}`
  }
}

/** The search query string, dropping what was not asked. `country` always rides. */
export function searchQuery(q: NumberQuery): string {
  const p = new URLSearchParams({ country: q.country })
  if (q.area) p.set('area', q.area)
  if (q.type) p.set('type', q.type)
  if (q.limit && q.limit > 0) p.set('limit', String(q.limit))
  return p.toString()
}

// ── Network methods (thin — one per typed op) ──────────────────────────────

export const TelApi = {
  summary: (): Promise<Summary> => restGet<unknown>(originV1Url(`${BASE}/summary`)).then(normalizeSummary),

  numbers: {
    /** The carrier's inventory. `country` is required by the backend (400 without). */
    available: (q: NumberQuery): Promise<Number[]> =>
      restGet<unknown>(originV1Url(`${BASE}/numbers/available?${searchQuery(q)}`)).then(normalizeAvailable),
    list: (): Promise<Number[]> => restGet<unknown>(originV1Url(`${BASE}/numbers`)).then(normalizeNumbers),
    buy: (e164: string): Promise<Number> =>
      restPost<unknown>(originV1Url(`${BASE}/numbers`), { e164 }).then(normalizeNumber),
    release: (id: string): Promise<void> => restDelete(originV1Url(`${BASE}/numbers/${enc(id)}`)),
  },

  calls: {
    list: (): Promise<Call[]> => restGet<unknown>(originV1Url(`${BASE}/calls`)).then(normalizeCalls),
    place: (body: NewCall): Promise<Call> =>
      restPost<unknown>(originV1Url(`${BASE}/calls`), body).then(normalizeCall),
    hangup: (id: string): Promise<void> => restDelete(originV1Url(`${BASE}/calls/${enc(id)}`)),
  },

  messages: {
    list: (): Promise<Message[]> => restGet<unknown>(originV1Url(`${BASE}/messages`)).then(normalizeMessages),
    send: (body: NewMessage): Promise<Message> =>
      restPost<unknown>(originV1Url(`${BASE}/messages`), body).then(normalizeMessage),
  },
}
