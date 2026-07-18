/**
 * Startups API — the Hanzo Startup Program pipeline, over the REAL cloud
 * `/v1/crm/applications` surface (cloud `clients/crm`: a native-Go per-org
 * applications resource on Base/SQLite). A public marketing form
 * (hanzo.ai/startups) posts an application; an AI screen scores it; staff work it
 * through a pipeline here.
 *
 * Same transport as `CrmApi` — same-origin, keyless, prefix-free
 * (`originV1Url('crm/applications')` → `<origin>/v1/crm/applications`), rewritten
 * to the console's user-bearer `/v1` proxy so every read/write is org-scoped
 * SERVER-SIDE and no credential reaches the browser. The startups pipeline lives
 * in the hanzo org.
 *
 * Routes (from cloud `clients/crm/applications.go`):
 *   GET   /v1/crm/applications        list (?stage=)         (staff)
 *   GET   /v1/crm/applications/:id    detail                 (staff)
 *   PATCH /v1/crm/applications/:id    advance stage / note   (staff)
 *   POST  /v1/crm/applications        public intake (marketing form; not called here)
 *
 * Plain REST (raw JSON, real HTTP status). Payloads normalized DEFENSIVELY.
 */
import { restGet, restPatch, originV1Url } from './client'

const BASE = 'crm/applications'
const enc = encodeURIComponent

// ── Coercion helpers (defensive; crm.ts style) ──────────────────────────────
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return 0
}
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
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
const rows = (payload: unknown) => arrayUnder(payload, ['data', 'items', 'rows'])

// ── Domain types (mirror cloud clients/crm/applications_store.go JSON tags) ──

/** The startup pipeline stages (cloud stage machine; `rejected` is terminal). */
export const STARTUP_STAGES = ['applied', 'screened', 'qualified', 'credits-offered', 'onboarded', 'rejected'] as const

/** The AI screen stored on an application. */
export type ScreenResult = {
  status: 'pending' | 'done' | 'failed' | string
  score: number
  tier1Backed: string
  suggestedCredits: number
  summary: string
  draftReply: string
  model: string
  screenedAt: number
  error: string
}

/** One entry in the append-only stage-transition log. */
export type StageEvent = { from: string; to: string; at: number; by: string; note: string }

export type Application = {
  id: string
  company: string
  website: string
  contactName: string
  email: string
  role: string
  stage: string
  tier1: boolean
  metadata: Record<string, unknown>
  screen: ScreenResult
  events: StageEvent[]
  companyId: string
  contactId: string
  reason: string
  createdAt: number
  updatedAt: number
}

/** The staff PATCH body: advance the stage (reason required to reject) and/or note. */
export type ApplicationPatch = { stage?: string; reason?: string; note?: string }

// ── Normalizers (pure) ──────────────────────────────────────────────────────

export function normalizeScreen(raw: unknown): ScreenResult {
  const r = asRecord(raw)
  return {
    status: str(r.status) || 'pending',
    score: num(r.score),
    tier1Backed: str(r.tier1Backed),
    suggestedCredits: num(r.suggestedCredits),
    summary: str(r.summary),
    draftReply: str(r.draftReply),
    model: str(r.model),
    screenedAt: num(r.screenedAt),
    error: str(r.error),
  }
}

function normalizeEvent(raw: unknown): StageEvent {
  const r = asRecord(raw)
  return { from: str(r.from), to: str(r.to), at: num(r.at), by: str(r.by), note: str(r.note) }
}

export function normalizeApplication(raw: unknown): Application {
  const r = asRecord(raw)
  return {
    id: str(r.id),
    company: str(r.company),
    website: str(r.website),
    contactName: str(r.contactName),
    email: str(r.email),
    role: str(r.role),
    stage: str(r.stage) || 'applied',
    tier1: bool(r.tier1),
    metadata: asRecord(r.metadata),
    screen: normalizeScreen(r.screen),
    events: Array.isArray(r.events) ? r.events.map(normalizeEvent) : [],
    companyId: str(r.companyId),
    contactId: str(r.contactId),
    reason: str(r.reason),
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
  }
}

export const normalizeApplications = (p: unknown): Application[] =>
  rows(p).map(normalizeApplication).filter((a) => a.id)

// ── Network methods (thin — one per documented route) ───────────────────────

export const StartupsApi = {
  list: (stage?: string): Promise<Application[]> =>
    restGet<unknown>(originV1Url(`${BASE}${stage ? `?stage=${enc(stage)}` : ''}`)).then(normalizeApplications),
  get: (id: string): Promise<Application> =>
    restGet<unknown>(originV1Url(`${BASE}/${enc(id)}`)).then(normalizeApplication),
  patch: (id: string, body: ApplicationPatch): Promise<Application> =>
    restPatch<unknown>(originV1Url(`${BASE}/${enc(id)}`), body).then(normalizeApplication),
}
