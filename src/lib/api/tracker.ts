/**
 * Tracker API — a native issue tracker (projects + issues, rows grouped by
 * status) over the REAL cloud `/v1/tracker` surface (cloud `clients/tracker`, a
 * per-org tracker on Base/SQLite). It replaces the old Huly/Svelte hanzo.team
 * tracker, which could not render issue ROWS GROUPED BY STATUS natively.
 *
 * Every call is same-origin, keyless and prefix-free (`originV1Url('tracker/...')`
 * → `<origin>/v1/tracker/...`, the CTO one-endpoint form). `next.config.mjs`
 * rewrites the `tracker` head to the console's OWN user-bearer `/cloud` proxy
 * (`app/cloud`), which mints a short-lived user-bound IAM token server-side and
 * injects `X-Org-Id` from the token's `owner` claim — so every read/write is
 * org-scoped SERVER-SIDE and no credential reaches the browser (the exact path
 * CRM / Agents / Evals use; the `tracker` head is allow-listed in both
 * `next.config.mjs` CLOUD_V1_HEADS and the proxy's `proxy-allow.ts` CLOUD_HEADS).
 *
 * PLAIN REST — NOT the casibase `{status,msg,data}` envelope: lists return BARE
 * JSON arrays, objects return bare JSON, create=201, delete=204. Payloads are
 * normalized DEFENSIVELY (a field rename upstream degrades a cell rather than
 * throwing; an unknown status/priority coerces to its default), and lists are read
 * as bare arrays (no `data`/`rows` unwrap — the tracker backend never wraps).
 *
 * Routes (cloud `clients/tracker`):
 *   GET/POST                 /v1/tracker/projects                     list / create
 *   GET/PATCH/DELETE         /v1/tracker/projects/:key                detail / update / delete
 *   GET/POST                 /v1/tracker/projects/:key/issues         list (?status=) / create
 *   GET/PATCH/DELETE         /v1/tracker/projects/:key/issues/:num    detail / update / delete
 */
import { restGet, restPost, restPatch, restDelete, originV1Url } from './client'

const BASE = 'tracker'
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

/** The tracker backend returns BARE arrays — take the objects out of one. */
const asArray = (payload: unknown): Record<string, unknown>[] =>
  Array.isArray(payload) ? (payload.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : []

/** Coerce an unknown into a member of `allowed`, else the default (first). */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], dflt: T): T {
  const s = str(v)
  return (allowed as readonly string[]).includes(s) ? (s as T) : dflt
}

const asLabels = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s) => s !== '') : []

// ── Domain types (mirror cloud clients/tracker store JSON tags) ──────────────

/** Issue lifecycle — the fixed group axis (default 'backlog'). */
export const STATUSES = ['backlog', 'todo', 'in_progress', 'done', 'canceled'] as const
export type Status = (typeof STATUSES)[number]

/** Issue priority (default 'none'). */
export const PRIORITIES = ['none', 'urgent', 'high', 'medium', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]

export type Project = {
  id: string
  org: string
  key: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
}

export type Issue = {
  id: string
  /** "ENG-1" — projectKey + number. */
  identifier: string
  projectKey: string
  number: number
  title: string
  description?: string
  status: Status
  priority: Priority
  assignee?: string
  labels: string[]
  createdAt: number
  updatedAt: number
}

/** Create/update bodies — only the writable fields (server owns id/org/timestamps). */
export type NewProject = { key?: string; name: string; description?: string }
export type UpdateProject = { name?: string; description?: string }
export type NewIssue = {
  title: string
  description?: string
  status?: Status
  priority?: Priority
  assignee?: string
  labels?: string[]
}
export type UpdateIssue = Partial<NewIssue>

// ── Normalizers (pure) ───────────────────────────────────────────────────────

export function normalizeProject(raw: unknown): Project {
  const r = asRecord(raw)
  return {
    id: str(r.id),
    org: str(r.org),
    key: str(r.key),
    name: str(r.name),
    description: str(r.description) || undefined,
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
  }
}

export function normalizeIssue(raw: unknown): Issue {
  const r = asRecord(raw)
  return {
    id: str(r.id),
    identifier: str(r.identifier),
    projectKey: str(r.projectKey),
    number: num(r.number),
    title: str(r.title),
    description: str(r.description) || undefined,
    status: oneOf(r.status, STATUSES, 'backlog'),
    priority: oneOf(r.priority, PRIORITIES, 'none'),
    assignee: str(r.assignee) || undefined,
    labels: asLabels(r.labels),
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
  }
}

export const normalizeProjects = (p: unknown): Project[] => asArray(p).map(normalizeProject).filter((x) => x.key)
export const normalizeIssues = (p: unknown): Issue[] => asArray(p).map(normalizeIssue).filter((x) => x.id)

// ── Network methods (thin — one per documented route) ────────────────────────

export const TrackerApi = {
  listProjects: (): Promise<Project[]> =>
    restGet<unknown>(originV1Url(`${BASE}/projects`)).then(normalizeProjects),
  createProject: (body: NewProject): Promise<Project> =>
    restPost<unknown>(originV1Url(`${BASE}/projects`), body).then(normalizeProject),
  getProject: (key: string): Promise<Project> =>
    restGet<unknown>(originV1Url(`${BASE}/projects/${enc(key)}`)).then(normalizeProject),
  updateProject: (key: string, body: UpdateProject): Promise<Project> =>
    restPatch<unknown>(originV1Url(`${BASE}/projects/${enc(key)}`), body).then(normalizeProject),
  deleteProject: (key: string): Promise<void> => restDelete(originV1Url(`${BASE}/projects/${enc(key)}`)),

  listIssues: (key: string, status?: Status): Promise<Issue[]> =>
    restGet<unknown>(
      originV1Url(`${BASE}/projects/${enc(key)}/issues${status ? `?status=${enc(status)}` : ''}`),
    ).then(normalizeIssues),
  createIssue: (key: string, body: NewIssue): Promise<Issue> =>
    restPost<unknown>(originV1Url(`${BASE}/projects/${enc(key)}/issues`), body).then(normalizeIssue),
  getIssue: (key: string, num: number): Promise<Issue> =>
    restGet<unknown>(originV1Url(`${BASE}/projects/${enc(key)}/issues/${num}`)).then(normalizeIssue),
  updateIssue: (key: string, num: number, body: UpdateIssue): Promise<Issue> =>
    restPatch<unknown>(originV1Url(`${BASE}/projects/${enc(key)}/issues/${num}`), body).then(normalizeIssue),
  deleteIssue: (key: string, num: number): Promise<void> =>
    restDelete(originV1Url(`${BASE}/projects/${enc(key)}/issues/${num}`)),
}
