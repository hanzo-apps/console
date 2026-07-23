/**
 * Tracker logic — PURE, dependency-free decisions for the Linear-grade tracker, so
 * the grouping / filtering / sorting / cycle+roadmap derivation / link building is
 * unit-tested in isolation (logic.test.ts) with no React, no network. The views are
 * thin renderers over these functions; every "where does this issue go / how is it
 * ordered / what links to it" question is answered HERE, once.
 *
 * All of it operates over the real `Issue`/`Project` payloads from `lib/api/tracker`
 * — no fabricated rows, honest empties. Cycles + Roadmap are DERIVED from the real
 * model (active set + progress; epics and their ExtRef children), never invented.
 */
import {
  type Issue,
  type Project,
  type Status,
  type Priority,
  type Kind,
  type Source,
  STATUSES,
  ACTIVE_STATUSES,
} from '~/lib/api/tracker'

// ── Presentation tokens (as-const so literals satisfy the GUI color union, exactly
//    like StatusTag's TONE maps) ──────────────────────────────────────────────
export const STATUS_ORDER: readonly Status[] = STATUSES

export const STATUS_LABEL: Record<Status, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  done: 'Done',
  canceled: 'Canceled',
}
export const STATUS_DOT = {
  backlog: '$color8',
  todo: '$blue10',
  in_progress: '$yellow10',
  done: '$green10',
  canceled: '$red10',
} as const

export const PRIORITY_ORDER: readonly Priority[] = ['urgent', 'high', 'medium', 'low', 'none']
export const PRIORITY_LABEL: Record<Priority, string> = {
  none: 'No priority',
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}
export const PRIORITY_COLOR = {
  none: '$color9',
  urgent: '$red10',
  high: '$orange10',
  medium: '$yellow10',
  low: '$color10',
} as const
/** Sort rank — urgent first, no-priority last. Lower = higher up. */
export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }

export const KIND_LABEL: Record<Kind, string> = { issue: 'Issue', pr: 'Pull Request', epic: 'Epic' }
export const SOURCE_LABEL: Record<Source, string> = {
  team: 'Team',
  git: 'GitHub',
  crm: 'CRM',
  helpdesk: 'Helpdesk',
  cms: 'CMS',
  agent: 'Agent',
}

// ── Dates ────────────────────────────────────────────────────────────────────

/** Format an epoch timestamp (seconds OR milliseconds) as a local date. */
export const fmtDate = (ts?: number): string => {
  if (!ts) return '—'
  const d = new Date(ts < 1e12 ? ts * 1000 : ts)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

/** Compact relative time ("3d", "2h", "just now"). `now` injectable for tests. */
export const relTime = (ts?: number, now: number = Date.now()): string => {
  if (!ts) return '—'
  const ms = ts < 1e12 ? ts * 1000 : ts
  const s = Math.max(0, Math.floor((now - ms) / 1000))
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w`
  return fmtDate(ts)
}

// ── Filtering ────────────────────────────────────────────────────────────────

export type IssueFilters = {
  status?: Status
  priority?: Priority
  kind?: Kind
  source?: Source
  assignee?: string
  label?: string
  team?: string
  /** free-text — substring over identifier / title / labels / assignee / repo. */
  q?: string
}

/** Split a comma input into a clean label list. */
export const parseLabels = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean)

/** Does `issue` match the free-text query (case-insensitive substring, any field)? */
export function matchesQuery(i: Issue, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const hay = [i.identifier, i.title, i.assignee ?? '', i.repo ?? '', i.labels.join(' ')]
    .join(' ')
    .toLowerCase()
  return hay.includes(needle)
}

/** Apply the active filter set. Empty fields impose no constraint. Pure. */
export function filterIssues(issues: Issue[], f: IssueFilters): Issue[] {
  return issues.filter((i) => {
    if (f.status && i.status !== f.status) return false
    if (f.priority && i.priority !== f.priority) return false
    if (f.kind && i.kind !== f.kind) return false
    if (f.source && i.source !== f.source) return false
    if (f.team && i.projectKey !== f.team) return false
    if (f.assignee && (i.assignee ?? '') !== f.assignee) return false
    if (f.label && !i.labels.includes(f.label)) return false
    if (f.q && !matchesQuery(i, f.q)) return false
    return true
  })
}

/** Count active (non-empty) constraints — drives the "N filters" pill. */
export const countFilters = (f: IssueFilters): number =>
  (['status', 'priority', 'kind', 'source', 'assignee', 'label', 'team', 'q'] as const).filter(
    (k) => (f[k] ?? '') !== '',
  ).length

// ── Sorting ──────────────────────────────────────────────────────────────────

/** Canonical in-group order: priority (urgent→none), then most-recently-updated. */
export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.updatedAt - a.updatedAt,
  )
}

// ── Grouping ─────────────────────────────────────────────────────────────────

export type GroupBy = 'status' | 'priority' | 'assignee' | 'team' | 'none'
export const GROUP_BY: readonly GroupBy[] = ['status', 'priority', 'assignee', 'team', 'none']
export const GROUP_BY_LABEL: Record<GroupBy, string> = {
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  team: 'Team',
  none: 'No grouping',
}

export type IssueGroup = { key: string; label: string; issues: Issue[] }

/**
 * Group + sort issues for a sectioned List. `status`/`priority` render EVERY column
 * in canonical order (even empty ones — a board shows its empty columns);
 * `assignee`/`team` render only the groups that occur, alphabetically (Unassigned
 * last). `none` is one anonymous group. Each group's issues are `sortIssues`-ordered.
 */
export function groupIssues(issues: Issue[], by: GroupBy): IssueGroup[] {
  if (by === 'none') return [{ key: 'all', label: '', issues: sortIssues(issues) }]

  if (by === 'status') {
    return STATUS_ORDER.map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      issues: sortIssues(issues.filter((i) => i.status === s)),
    }))
  }
  if (by === 'priority') {
    return PRIORITY_ORDER.map((p) => ({
      key: p,
      label: PRIORITY_LABEL[p],
      issues: sortIssues(issues.filter((i) => i.priority === p)),
    }))
  }

  // assignee | team — dynamic buckets, sorted, "Unassigned"/blank team last.
  const keyOf = (i: Issue) => (by === 'assignee' ? i.assignee ?? '' : i.projectKey)
  const buckets = new Map<string, Issue[]>()
  for (const i of issues) {
    const k = keyOf(i)
    ;(buckets.get(k) ?? buckets.set(k, []).get(k)!).push(i)
  }
  const keys = [...buckets.keys()].sort((a, b) => {
    if (a === '' && b !== '') return 1
    if (b === '' && a !== '') return -1
    return a.localeCompare(b)
  })
  return keys.map((k) => ({
    key: k || 'unassigned',
    label: k || (by === 'assignee' ? 'Unassigned' : 'No team'),
    issues: sortIssues(buckets.get(k)!),
  }))
}

/** Board columns — always the five statuses, in order (Board view is status-fixed). */
export function boardColumns(issues: Issue[]): IssueGroup[] {
  return STATUS_ORDER.map((s) => ({
    key: s,
    label: STATUS_LABEL[s],
    issues: sortIssues(issues.filter((i) => i.status === s)),
  }))
}

// ── "My Issues" ──────────────────────────────────────────────────────────────

/**
 * Issues assigned to `me` — matched case-insensitively against the assignee, by
 * either the full value or its local-part (so "ada@hanzo.ai", "ada", and "Ada" all
 * hit). Empty `me` → nothing (honest; the caller shows a sign-in-scoped empty).
 */
export function myIssues(issues: Issue[], me?: string | null): Issue[] {
  const id = (me ?? '').trim().toLowerCase()
  if (!id) return []
  const local = id.split('@')[0]
  return issues.filter((i) => {
    const a = (i.assignee ?? '').trim().toLowerCase()
    return a !== '' && (a === id || a === local || a.split('@')[0] === local)
  })
}

// ── Cycles (derived, honest) ─────────────────────────────────────────────────

export type CycleSummary = {
  /** active work (todo + in_progress) — the current cycle's scope. */
  active: Issue[]
  /** everything touched recently (default 14d) — the cycle window. */
  inWindow: Issue[]
  total: number
  done: number
  /** 0..1 completion of the windowed set. */
  progress: number
}

/**
 * The "current cycle" — a DERIVED iteration view (Linear's default cadence is a
 * rolling 1–2 week cycle). We do not invent a cycle entity the backend lacks: the
 * current cycle is the issues touched inside `windowDays` (default 14), its progress
 * the share already Done, and its scope the still-active work. Honest + real.
 */
export function deriveCurrentCycle(issues: Issue[], windowDays = 14, now: number = Date.now()): CycleSummary {
  const cutoff = now - windowDays * 86400_000
  const inWindow = issues.filter((i) => {
    const ms = i.updatedAt < 1e12 ? i.updatedAt * 1000 : i.updatedAt
    return ms >= cutoff && i.status !== 'canceled'
  })
  const active = issues.filter((i) => (ACTIVE_STATUSES as readonly Status[]).includes(i.status))
  const total = inWindow.length
  const done = inWindow.filter((i) => i.status === 'done').length
  return { active: sortIssues(active), inWindow, total, done, progress: total ? done / total : 0 }
}

// ── Roadmap (epics + children, derived) ──────────────────────────────────────

export type EpicRow = { epic: Issue; children: Issue[]; total: number; done: number; progress: number }

/**
 * Roadmap = every epic (Kind:"epic") with its children — the issues whose ExtRef
 * anchors that epic (per the cloud contract: "an epic's children are issues whose
 * ExtRef is the epic"). We match ExtRef against the epic's identifier OR id, so a
 * child can point at either. Progress is the share of children already Done. Epics
 * with the most open work sort first.
 */
export function deriveRoadmap(issues: Issue[]): EpicRow[] {
  const epics = issues.filter((i) => i.kind === 'epic')
  const rows = epics.map((epic) => {
    const children = issues.filter(
      (i) => i.id !== epic.id && (i.extRef === epic.identifier || i.extRef === epic.id),
    )
    const total = children.length
    const done = children.filter((c) => c.status === 'done').length
    return { epic, children: sortIssues(children), total, done, progress: total ? done / total : 0 }
  })
  return rows.sort((a, b) => b.total - b.done - (a.total - a.done) || b.epic.updatedAt - a.epic.updatedAt)
}

// ── External links (GitHub source + native git.hanzo.ai) ─────────────────────

/**
 * The upstream GitHub URL for a mirrored issue, or null. The App-webhook seam stores
 * ExtRef as "github:owner/repo#123" (or an https URL). Parse the anchor form to the
 * canonical issues URL; pass an already-absolute URL through.
 */
export function githubUrl(i: Issue): string | null {
  const ref = (i.extRef ?? '').trim()
  if (/^https?:\/\//i.test(ref)) return ref
  const m = ref.match(/^github:([^#\s]+)#(\d+)$/i)
  if (m) return `https://github.com/${m[1]}/issues/${m[2]}`
  return null
}

/** The native git.hanzo.ai URL for a repo binding (owner/name), or null. */
export function gitHanzoUrl(repo?: string): string | null {
  const r = (repo ?? '').trim().replace(/^\/+|\/+$/g, '')
  return r ? `https://git.hanzo.ai/${r}` : null
}

/**
 * PRs linked to `issue` within `all`: agent/git pull-request rows (Kind:"pr") that
 * either share the issue's repo binding or anchor this issue by ExtRef (the coding
 * seam sets the PR's ExtRef to its branch and can parent the originating issue). The
 * issue↔branch↔PR chain the detail pane renders. Excludes the issue itself.
 */
export function linkedPRs(issue: Issue, all: Issue[]): Issue[] {
  if (issue.kind === 'pr') return []
  return sortIssues(
    all.filter(
      (i) =>
        i.id !== issue.id &&
        i.kind === 'pr' &&
        ((issue.repo && i.repo === issue.repo) || i.extRef === issue.identifier),
    ),
  )
}

/** True when the DOM target is a text-entry element — suppress single-key shortcuts. */
export function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true
}

/** Distinct assignees present in a set, sorted (for the filter menu). */
export const assigneesOf = (issues: Issue[]): string[] =>
  [...new Set(issues.map((i) => (i.assignee ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))

/** Distinct labels present in a set, sorted (for the filter menu). */
export const labelsOf = (issues: Issue[]): string[] =>
  [...new Set(issues.flatMap((i) => i.labels))].filter(Boolean).sort((a, b) => a.localeCompare(b))

/** Map a team KEY to its display name from the project list (falls back to the key). */
export const teamName = (key: string, projects: Project[]): string =>
  projects.find((p) => p.key === key)?.name || key
