/**
 * Mission Control API — the live agent-session control plane + run-targets over the
 * cloud `/v1/agents/*` surface (cloud `apps/agents`: sessions + events + control +
 * targets). Same-origin, keyless, prefix-free (`originV1Url('agents/…')` →
 * `<origin>/v1/agents/…`, the ONE endpoint form); the `agents` head is already
 * allow-listed in `proxy-allow.ts`, so a signed-in call is org-scoped SERVER-SIDE
 * (the cloud plane resolves the org from the bearer owner and fail-closed 403s a
 * cookie-only / cross-tenant call). This client only READS + DRIVES that plane — it
 * never invents a session, event, or device.
 *
 * Plain REST (raw JSON, real HTTP status) like agents.ts — `restGet/restPost/
 * restPatch/restDelete`, not the casibase envelope. Payloads are normalized
 * DEFENSIVELY so a field rename upstream degrades a cell to "—" rather than throwing.
 */
import { restGet, restPost, restPatch, restDelete, originV1Url } from './client'

// ── coercion helpers (defensive) ─────────────────────────────────────────────
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const arrayUnder = (payload: unknown, key: string): Record<string, unknown>[] => {
  const root = asRecord(payload)
  const v = Array.isArray(payload) ? payload : root[key]
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : []
}

// ── domain types (the published contract) ────────────────────────────────────

/** A live agent-session's status. running/paused are live; done/error are terminal. */
export type SessionStatus = 'running' | 'paused' | 'done' | 'error'
export const SESSION_STATUSES: SessionStatus[] = ['running', 'paused', 'done', 'error']

/** The compact last-activity line a card shows without fetching full detail. */
export type LastEvent = { seq: number; kind: string; actor?: string; preview?: string; at?: string }

/** One agent session — a CLI run, a bot loop, a dispatched job — and WHERE it runs. */
export type Session = {
  id: string
  agent: string
  actor?: string
  status: SessionStatus
  title?: string
  rootSessionId?: string
  parentSessionId?: string
  taskWorkflowId?: string
  /** Execution context (mission-control): the machine/repo/cwd + dispatch target. */
  host?: string
  cwd?: string
  repo?: string
  target?: string
  events: number
  children: number
  startedAt?: string
  endedAt?: string
  updatedAt?: string
  lastEvent?: LastEvent
}

/** One entry in a session's ordered log (message/tool-call/spawn/log/status/control). */
export type SessionEvent = {
  id: string
  sessionId: string
  seq: number
  kind: string
  actor?: string
  payload?: unknown
  at?: string
}

/** A session plus its recent events + direct children (the detail view). */
export type SessionDetail = Session & { recentEvents: SessionEvent[]; childSessions: Session[] }

/** A run-target: a machine a session can be dispatched to. */
export type TargetKind = 'laptop' | 'cloud' | 'gpu' | 'cluster' | 'machine'
export const TARGET_KINDS: TargetKind[] = ['laptop', 'cloud', 'gpu', 'cluster', 'machine']
export type TargetStatus = 'online' | 'offline' | 'draining'

export type Target = {
  id: string
  label: string
  kind: TargetKind
  status: TargetStatus
  capacity?: string
  host?: string
  /** Live session load (from the backend rollup). */
  sessions: number
  running: number
  registered: true
  updatedAt?: string
}

// ── normalizers (pure) ───────────────────────────────────────────────────────

function foldStatus(raw: string): SessionStatus {
  const s = raw.toLowerCase().trim()
  return (SESSION_STATUSES as string[]).includes(s) ? (s as SessionStatus) : 'running'
}

export function normalizeSession(raw: unknown): Session | null {
  const r = asRecord(raw)
  const id = str(r.id)
  if (!id) return null
  const le = asRecord(r.lastEvent)
  const lastEvent: LastEvent | undefined = le.kind
    ? { seq: num(le.seq), kind: str(le.kind), actor: optStr(le.actor), preview: optStr(le.preview), at: optStr(le.at) }
    : undefined
  return {
    id,
    agent: str(r.agent) || 'agent',
    actor: optStr(r.actor),
    status: foldStatus(str(r.status)),
    title: optStr(r.title),
    rootSessionId: optStr(r.rootSessionId),
    parentSessionId: optStr(r.parentSessionId),
    taskWorkflowId: optStr(r.taskWorkflowId),
    host: optStr(r.host),
    cwd: optStr(r.cwd),
    repo: optStr(r.repo),
    target: optStr(r.target),
    events: num(r.events),
    children: num(r.children),
    startedAt: optStr(r.startedAt),
    endedAt: optStr(r.endedAt),
    updatedAt: optStr(r.updatedAt),
    lastEvent,
  }
}

export function normalizeSessions(payload: unknown): Session[] {
  return arrayUnder(payload, 'sessions')
    .map(normalizeSession)
    .filter((s): s is Session => s !== null)
}

export function normalizeEvent(raw: unknown): SessionEvent | null {
  const r = asRecord(raw)
  const id = str(r.id)
  if (!id) return null
  return {
    id,
    sessionId: str(r.sessionId),
    seq: num(r.seq),
    kind: str(r.kind) || 'log',
    actor: optStr(r.actor),
    payload: r.payload,
    at: optStr(r.createdAt) ?? optStr(r.at),
  }
}

export function normalizeEvents(payload: unknown, key = 'recentEvents'): SessionEvent[] {
  return arrayUnder(payload, key)
    .map(normalizeEvent)
    .filter((e): e is SessionEvent => e !== null)
}

export function normalizeDetail(payload: unknown): SessionDetail | null {
  const base = normalizeSession(payload)
  if (!base) return null
  return {
    ...base,
    recentEvents: normalizeEvents(payload, 'recentEvents'),
    childSessions: arrayUnder(payload, 'childSessions').map(normalizeSession).filter((s): s is Session => s !== null),
  }
}

function foldTargetKind(raw: string): TargetKind {
  const k = raw.toLowerCase().trim()
  return (TARGET_KINDS as string[]).includes(k) ? (k as TargetKind) : 'machine'
}

export function normalizeTarget(raw: unknown): Target | null {
  const r = asRecord(raw)
  const id = str(r.id)
  if (!id) return null
  const st = str(r.status).toLowerCase().trim()
  return {
    id,
    label: str(r.label) || id,
    kind: foldTargetKind(str(r.kind)),
    status: st === 'offline' || st === 'draining' ? (st as TargetStatus) : 'online',
    capacity: optStr(r.capacity),
    host: optStr(r.host),
    sessions: num(r.sessions),
    running: num(r.running),
    registered: true,
    updatedAt: optStr(r.updatedAt),
  }
}

export function normalizeTargets(payload: unknown): Target[] {
  return arrayUnder(payload, 'targets')
    .map(normalizeTarget)
    .filter((t): t is Target => t !== null)
}

// ── pure display + roster helpers (unit-tested) ──────────────────────────────

/** A session is LIVE (steerable) when running or paused. */
export const isLive = (s: SessionStatus): boolean => s === 'running' || s === 'paused'

/** Control commands are only meaningful on a non-terminal session. */
export const canControl = (s: SessionStatus): boolean => isLive(s)

/** Semantic tone for a status pill (maps to the UI palette, not a raw color). */
export function statusTone(s: SessionStatus): 'live' | 'paused' | 'ok' | 'error' {
  switch (s) {
    case 'running':
      return 'live'
    case 'paused':
      return 'paused'
    case 'done':
      return 'ok'
    case 'error':
      return 'error'
  }
}

/**
 * A one-line display string for an event — pulls a human field out of the opaque
 * payload (message/text/content/line/command), else falls back to the kind. Accepts
 * either a parsed payload object (an event) OR the truncated preview STRING the list
 * carries. Never throws; a payload with nothing readable shows its kind.
 */
export function eventLine(payload: unknown, kind = 'log'): string {
  if (typeof payload === 'string') {
    const t = payload.trim()
    if (!t) return kind
    // A JSON preview string — try to read a field, else show the raw snippet.
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return eventLine(JSON.parse(t), kind)
      } catch {
        return t
      }
    }
    return t
  }
  const r = asRecord(payload)
  for (const k of ['message', 'text', 'content', 'line', 'command', 'msg', 'output', 'error']) {
    const v = r[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return kind
}

/** Merge live events into an existing transcript, deduped by seq (or id), seq-ordered. */
export function mergeEvents(prev: SessionEvent[], incoming: SessionEvent[]): SessionEvent[] {
  const bySeq = new Map<string, SessionEvent>()
  for (const e of [...prev, ...incoming]) bySeq.set(e.seq > 0 ? `s${e.seq}` : `i${e.id}`, e)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))
}

/** Clamp a pager index into [0, n). */
export const clampIndex = (i: number, n: number): number => (n <= 0 ? 0 : Math.min(Math.max(0, i), n - 1))

/** A device in the roster — a registered target OR a host derived from live sessions. */
export type Device = {
  id: string
  label: string
  kind: TargetKind | 'unknown'
  status: TargetStatus | 'active' | 'idle'
  host?: string
  capacity?: string
  registered: boolean
  sessions: Session[]
  running: number
}

const sessionOnTarget = (s: Session, t: Target): boolean =>
  (!!s.target && s.target === t.id) || (!!t.host && !!s.host && s.host === t.host)

/**
 * The devices roster — the UNION of the registered run-targets and the distinct hosts
 * that live sessions report, so a machine appears whether it was explicitly registered
 * (#48) OR merely ran a session. Composes with the compute fleet at the view layer.
 * Every session is mapped to exactly one device (registered target wins; else its host;
 * else the synthetic "Unassigned" bucket), so counts never double. PURE.
 */
export function deviceRoster(sessions: Session[], targets: Target[]): Device[] {
  const claimed = new Set<string>()
  const devices: Device[] = targets.map((t) => {
    const mine = sessions.filter((s) => sessionOnTarget(s, t))
    mine.forEach((s) => claimed.add(s.id))
    return {
      id: t.id,
      label: t.label,
      kind: t.kind,
      status: t.status,
      host: t.host,
      capacity: t.capacity,
      registered: true,
      sessions: mine,
      running: mine.filter((s) => s.status === 'running').length,
    }
  })

  // Ambient hosts — sessions on a machine we didn't register as a target.
  const byHost = new Map<string, Session[]>()
  const unassigned: Session[] = []
  for (const s of sessions) {
    if (claimed.has(s.id)) continue
    if (s.host) byHost.set(s.host, [...(byHost.get(s.host) ?? []), s])
    else unassigned.push(s)
  }
  for (const [host, mine] of byHost) {
    const running = mine.filter((s) => s.status === 'running').length
    devices.push({
      id: `host:${host}`,
      label: host,
      kind: 'unknown',
      status: running > 0 ? 'active' : 'idle',
      host,
      registered: false,
      sessions: mine,
      running,
    })
  }
  if (unassigned.length) {
    const running = unassigned.filter((s) => s.status === 'running').length
    devices.push({
      id: 'unassigned',
      label: 'Unassigned',
      kind: 'unknown',
      status: running > 0 ? 'active' : 'idle',
      registered: false,
      sessions: unassigned,
      running,
    })
  }
  // Most-active first (running sessions, then total).
  return devices.sort((a, b) => b.running - a.running || b.sessions.length - a.sessions.length)
}

/** Relative "time ago" (now injectable for tests). Em dash for missing/invalid. */
export function fmtRelative(iso?: string, now: number = Date.now()): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return `${Math.round(d / 30)}mo ago`
}

// ── network methods ──────────────────────────────────────────────────────────

const enc = encodeURIComponent
const SESSIONS = 'agents/sessions'
const TARGETS = 'agents/targets'

export type SessionFilter = { status?: SessionStatus; root?: string; parent?: string; limit?: number }
export type ControlCommand = 'pause' | 'resume' | 'stop' | 'message'
export type NewTarget = { label: string; kind?: TargetKind; status?: TargetStatus; capacity?: string; host?: string }

export const MissionControlApi = {
  /** The org's live sessions (`GET /v1/agents/sessions`), honest-empty until bound. */
  sessions: (f: SessionFilter = {}): Promise<Session[]> => {
    const q = new URLSearchParams()
    if (f.status) q.set('status', f.status)
    if (f.root) q.set('root', f.root)
    if (f.parent) q.set('parent', f.parent)
    if (f.limit) q.set('limit', String(f.limit))
    const qs = q.toString()
    return restGet<unknown>(originV1Url(`${SESSIONS}${qs ? `?${qs}` : ''}`)).then(normalizeSessions)
  },

  /** One session + recent events + children (`GET /v1/agents/sessions/:id`). */
  session: (id: string): Promise<SessionDetail | null> =>
    restGet<unknown>(originV1Url(`${SESSIONS}/${enc(id)}`)).then(normalizeDetail),

  /** Steer a session (`POST /v1/agents/sessions/:id/{pause|resume|stop|message}`). */
  control: (id: string, cmd: ControlCommand, message?: string): Promise<unknown> =>
    restPost<unknown>(originV1Url(`${SESSIONS}/${enc(id)}/${cmd}`), message ? { message } : undefined),

  /** Update a session's status/title/target (`PATCH /v1/agents/sessions/:id`). */
  patchSession: (id: string, body: { status?: SessionStatus; title?: string; target?: string }): Promise<Session | null> =>
    restPatch<unknown>(originV1Url(`${SESSIONS}/${enc(id)}`), body).then(normalizeSession),

  /** The org's run-targets with live load (`GET /v1/agents/targets`). */
  targets: (): Promise<Target[]> => restGet<unknown>(originV1Url(TARGETS)).then(normalizeTargets),

  /** Register a run-target (`POST /v1/agents/targets`). */
  registerTarget: (body: NewTarget): Promise<Target | null> =>
    restPost<unknown>(originV1Url(TARGETS), body).then(normalizeTarget),

  /** Update a run-target (`PATCH /v1/agents/targets/:id`). */
  patchTarget: (id: string, body: Partial<NewTarget>): Promise<Target | null> =>
    restPatch<unknown>(originV1Url(`${TARGETS}/${enc(id)}`), body).then(normalizeTarget),

  /** Deregister a run-target (`DELETE /v1/agents/targets/:id`). */
  removeTarget: (id: string): Promise<void> => restDelete(originV1Url(`${TARGETS}/${enc(id)}`)),

  /** The SSE stream URL for live session + event updates (same-origin, cookie-auth). */
  streamUrl: (): string => originV1Url(`${SESSIONS}/stream`),
}
