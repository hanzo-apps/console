/**
 * Tracker API — a NATIVE, Linear-grade issue tracker over the REAL cloud
 * `/v1/tracker` surface (cloud `clients/tracker`, a per-(org,project) tracker on
 * Base/SQLite). It is the durable replacement for the retired Huly/Svelte
 * hanzo.team tracker, whose reactive-batching render race could not render issue
 * ROWS GROUPED BY STATUS. Native @hanzo/gui over plain JSON renders deterministically.
 *
 * Every call is same-origin, keyless and prefix-free (`originV1Url('tracker/...')`
 * → `<origin>/v1/tracker/...`, the CTO one-endpoint form). On the standalone SPA the
 * ingress routes /v1/tracker straight to cloud; on the admin host the console's own
 * `app/v1` user-bearer BFF serves the `tracker` head (mints a short-lived user token
 * server-side, injects `X-Org-Id` from the token owner) — so every read/write is
 * org-scoped SERVER-SIDE and no credential reaches the browser. The `tracker` head is
 * allow-listed in `proxy-allow.ts` and admits every sub-path.
 *
 * The Issue is POLYMORPHIC by Kind (issue | pr | epic) and tagged by Source
 * (team | git | crm | helpdesk | cms | agent) + a git Repo binding + an ExtRef anchor
 * (a PR branch, a GitHub URL, or an epic parent) — the four immutable discriminators
 * from the cloud contract. GitHub issues mirror in via the App-webhook seam
 * (Source:"git", team "GH", ExtRef "github:owner/repo#123"); agent PRs open via the
 * coding seam (Kind:"pr", Source:"agent"). Every work-item surface here is a FILTER
 * over the one table — never a second store.
 *
 * UNIFIED CROSS-PROJECT VIEW: the backend lists issues per team; `listAllIssues`
 * composes those reads (projects → parallel issue lists → merge) so tracker.hanzo.ai
 * shows ONE unified, filterable board across every team + every mirrored GitHub repo,
 * with zero duplicate backend store. Reads degrade honestly (a team that 404s drops
 * out of the merge, never throws).
 *
 * PLAIN REST — NOT the casibase `{status,msg,data}` envelope: lists return BARE JSON
 * arrays, objects bare JSON, create=201, delete=204. Payloads normalize DEFENSIVELY
 * (a field rename upstream degrades a cell rather than throwing; an unknown status/
 * priority/kind/source coerces to its default).
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

/** Issue lifecycle — the fixed board-column axis (default 'backlog'). */
export const STATUSES = ['backlog', 'todo', 'in_progress', 'done', 'canceled'] as const
export type Status = (typeof STATUSES)[number]

/** Issue priority (default 'none'). */
export const PRIORITIES = ['none', 'urgent', 'high', 'medium', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]

/** What a work item IS — the small closed set (default 'issue'). */
export const KINDS = ['issue', 'pr', 'epic'] as const
export type Kind = (typeof KINDS)[number]

/** Which surface ORIGINATED the work item (default 'team'). */
export const SOURCES = ['team', 'git', 'crm', 'helpdesk', 'cms', 'agent'] as const
export type Source = (typeof SOURCES)[number]

/** The open board columns (Done/Canceled are terminal) — the "Active" filter set. */
export const ACTIVE_STATUSES: readonly Status[] = ['todo', 'in_progress']

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
  /** issue | pr | epic — the immutable shape discriminator. */
  kind: Kind
  /** team | git | crm | helpdesk | cms | agent — which surface opened it. */
  source: Source
  /** git repo binding (owner/name) for git-sourced / agent-PR rows; '' otherwise. */
  repo?: string
  /** external anchor: a PR branch, a GitHub URL, or an epic parent identifier. */
  extRef?: string
  title: string
  description?: string
  status: Status
  priority: Priority
  assignee?: string
  labels: string[]
  createdAt: number
  updatedAt: number
}

/** Create/update bodies — only the writable fields (server owns id/org/number/timestamps). */
export type NewProject = { key?: string; name: string; description?: string }
export type UpdateProject = { name?: string; description?: string }
export type NewIssue = {
  title: string
  description?: string
  status?: Status
  priority?: Priority
  assignee?: string
  labels?: string[]
  kind?: Kind
  source?: Source
  repo?: string
  extRef?: string
}
export type UpdateIssue = Partial<Omit<NewIssue, 'kind' | 'source'>>

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
    kind: oneOf(r.kind, KINDS, 'issue'),
    source: oneOf(r.source, SOURCES, 'team'),
    repo: str(r.repo) || undefined,
    extRef: str(r.extRef) || undefined,
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

// ── Query shape for the client-side unified list ─────────────────────────────

export type IssueQuery = {
  /** Restrict to one team KEY; omit for every team (the unified board). */
  projectKey?: string
  status?: Status
  kind?: Kind
  source?: Source
  /** Free-form git repo binding filter (owner/name). */
  repo?: string
}

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

  /** Issues for ONE team, optionally narrowed by the backend `?status=&kind=&repo=&source=` filter. */
  listIssues: (key: string, q: Omit<IssueQuery, 'projectKey'> = {}): Promise<Issue[]> => {
    const qs = new URLSearchParams()
    if (q.status) qs.set('status', q.status)
    if (q.kind) qs.set('kind', q.kind)
    if (q.repo) qs.set('repo', q.repo)
    if (q.source) qs.set('source', q.source)
    const suffix = qs.toString() ? `?${qs}` : ''
    return restGet<unknown>(originV1Url(`${BASE}/projects/${enc(key)}/issues${suffix}`)).then(normalizeIssues)
  },
  createIssue: (key: string, body: NewIssue): Promise<Issue> =>
    restPost<unknown>(originV1Url(`${BASE}/projects/${enc(key)}/issues`), body).then(normalizeIssue),
  getIssue: (key: string, n: number): Promise<Issue> =>
    restGet<unknown>(originV1Url(`${BASE}/projects/${enc(key)}/issues/${n}`)).then(normalizeIssue),
  updateIssue: (key: string, n: number, body: UpdateIssue): Promise<Issue> =>
    restPatch<unknown>(originV1Url(`${BASE}/projects/${enc(key)}/issues/${n}`), body).then(normalizeIssue),
  deleteIssue: (key: string, n: number): Promise<void> =>
    restDelete(originV1Url(`${BASE}/projects/${enc(key)}/issues/${n}`)),

  /**
   * The UNIFIED cross-project list — every team's issues in ONE array, so
   * tracker.hanzo.ai renders a single filterable board across every native team AND
   * every mirrored GitHub repo. Composed from the existing per-team reads (the
   * backend has no second store): fetch the team list, fan out `listIssues` in
   * parallel, merge. A team whose read fails drops OUT of the merge (honest partial),
   * never rejecting the whole board. `projectKey` scopes to one team (then it is just
   * that team's list); the other fields ride the backend filter.
   */
  async listAllIssues(q: IssueQuery = {}): Promise<Issue[]> {
    const perTeam: Omit<IssueQuery, 'projectKey'> = { status: q.status, kind: q.kind, source: q.source, repo: q.repo }
    if (q.projectKey) return this.listIssues(q.projectKey, perTeam)
    const projects = await this.listProjects()
    const settled = await Promise.allSettled(projects.map((p) => this.listIssues(p.key, perTeam)))
    const out: Issue[] = []
    for (const r of settled) if (r.status === 'fulfilled') out.push(...r.value)
    return out
  },

  /**
   * Hand an issue to a coding agent: mark it (assignee + the `agent` label) so the
   * coding run (cloud clients/coding) picks it up, does the work on a native
   * git.hanzo.ai branch, and opens a linked PR row (Kind:"pr", Source:"agent", same
   * Repo, the branch as ExtRef) — the tracker's own agent-PR seam. Honest: this is
   * the PATCH the console owns; the run + PR are the backend seam. Idempotent.
   */
  assignAgent: (key: string, n: number, agent: string, labels: string[]): Promise<Issue> =>
    restPatch<unknown>(originV1Url(`${BASE}/projects/${enc(key)}/issues/${n}`), {
      assignee: agent,
      labels: Array.from(new Set([...labels, 'agent'])),
    }).then(normalizeIssue),
}
