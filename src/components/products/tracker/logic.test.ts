import { describe, it, expect } from 'vitest'
import type { Issue } from '~/lib/api/tracker'
import {
  filterIssues,
  countFilters,
  matchesQuery,
  sortIssues,
  groupIssues,
  boardColumns,
  myIssues,
  deriveCurrentCycle,
  deriveRoadmap,
  githubUrl,
  gitHanzoUrl,
  linkedPRs,
  relTime,
  assigneesOf,
  labelsOf,
  parseLabels,
} from './logic'

// ── fixtures ─────────────────────────────────────────────────────────────────
let seq = 0
function mk(p: Partial<Issue> = {}): Issue {
  seq += 1
  const key = p.projectKey ?? 'ENG'
  const n = p.number ?? seq
  return {
    id: p.id ?? `issue_${seq}`,
    identifier: p.identifier ?? `${key}-${n}`,
    projectKey: key,
    number: n,
    kind: p.kind ?? 'issue',
    source: p.source ?? 'team',
    repo: p.repo,
    extRef: p.extRef,
    title: p.title ?? `Issue ${n}`,
    description: p.description,
    status: p.status ?? 'backlog',
    priority: p.priority ?? 'none',
    assignee: p.assignee,
    labels: p.labels ?? [],
    createdAt: p.createdAt ?? 1_700_000_000,
    updatedAt: p.updatedAt ?? 1_700_000_000,
  }
}

describe('filterIssues', () => {
  const issues = [
    mk({ status: 'todo', priority: 'high', assignee: 'ada@hanzo.ai', labels: ['bug'], source: 'git', repo: 'hanzoai/cloud' }),
    mk({ status: 'done', priority: 'low', assignee: 'bob@hanzo.ai', labels: ['chore'], source: 'team' }),
    mk({ status: 'todo', priority: 'urgent', kind: 'pr', source: 'agent', repo: 'hanzoai/cloud' }),
  ]
  it('constrains only on set fields (empty = pass-through)', () => {
    expect(filterIssues(issues, {})).toHaveLength(3)
    expect(filterIssues(issues, { status: 'todo' })).toHaveLength(2)
    expect(filterIssues(issues, { kind: 'pr' })).toHaveLength(1)
    expect(filterIssues(issues, { source: 'git' })).toHaveLength(1)
    expect(filterIssues(issues, { assignee: 'ada@hanzo.ai' })).toHaveLength(1)
    expect(filterIssues(issues, { label: 'bug' })).toHaveLength(1)
    expect(filterIssues(issues, { team: 'ENG' })).toHaveLength(3)
    expect(filterIssues(issues, { team: 'ZZZ' })).toHaveLength(0)
  })
  it('AND-composes multiple constraints', () => {
    expect(filterIssues(issues, { status: 'todo', priority: 'urgent' })).toHaveLength(1)
  })
  it('counts active constraints', () => {
    expect(countFilters({})).toBe(0)
    expect(countFilters({ status: 'todo', q: 'x' })).toBe(2)
    expect(countFilters({ q: '' })).toBe(0)
  })
})

describe('matchesQuery', () => {
  const i = mk({ identifier: 'GH-42', title: 'Login redirect loops', labels: ['auth'], assignee: 'ada@hanzo.ai', repo: 'hanzoai/iam' })
  it('is a case-insensitive substring over identity/title/labels/assignee/repo', () => {
    expect(matchesQuery(i, 'gh-42')).toBe(true)
    expect(matchesQuery(i, 'redirect')).toBe(true)
    expect(matchesQuery(i, 'AUTH')).toBe(true)
    expect(matchesQuery(i, 'iam')).toBe(true)
    expect(matchesQuery(i, 'nope')).toBe(false)
    expect(matchesQuery(i, '')).toBe(true)
  })
})

describe('sortIssues', () => {
  it('orders by priority (urgent→none) then most-recently-updated', () => {
    const a = mk({ priority: 'low', updatedAt: 100 })
    const b = mk({ priority: 'urgent', updatedAt: 1 })
    const c = mk({ priority: 'urgent', updatedAt: 50 })
    const out = sortIssues([a, b, c])
    expect(out.map((x) => x.id)).toEqual([c.id, b.id, a.id])
  })
  it('does not mutate the input', () => {
    const input = [mk({ priority: 'low' }), mk({ priority: 'urgent' })]
    const snap = input.map((x) => x.id)
    sortIssues(input)
    expect(input.map((x) => x.id)).toEqual(snap)
  })
})

describe('groupIssues', () => {
  const issues = [
    mk({ status: 'todo', priority: 'high', assignee: 'ada', projectKey: 'ENG' }),
    mk({ status: 'done', priority: 'low', projectKey: 'GH' }),
    mk({ status: 'todo', priority: 'urgent', assignee: 'ada', projectKey: 'ENG' }),
  ]
  it('status grouping renders all five columns in order', () => {
    const g = groupIssues(issues, 'status')
    expect(g.map((x) => x.key)).toEqual(['backlog', 'todo', 'in_progress', 'done', 'canceled'])
    expect(g.find((x) => x.key === 'todo')!.issues).toHaveLength(2)
  })
  it('assignee grouping puts Unassigned last', () => {
    const g = groupIssues(issues, 'assignee')
    expect(g[g.length - 1].label).toBe('Unassigned')
    expect(g[0].label).toBe('ada')
  })
  it('team grouping buckets by projectKey', () => {
    const g = groupIssues(issues, 'team')
    expect(g.map((x) => x.key).sort()).toEqual(['ENG', 'GH'])
  })
  it('none is a single group', () => {
    expect(groupIssues(issues, 'none')).toHaveLength(1)
    expect(groupIssues(issues, 'none')[0].issues).toHaveLength(3)
  })
  it('board columns are always the five statuses', () => {
    expect(boardColumns([]).map((x) => x.key)).toEqual(['backlog', 'todo', 'in_progress', 'done', 'canceled'])
  })
})

describe('myIssues', () => {
  const issues = [
    mk({ assignee: 'ada@hanzo.ai' }),
    mk({ assignee: 'Ada' }),
    mk({ assignee: 'bob@hanzo.ai' }),
    mk({ assignee: undefined }),
  ]
  it('matches full email, local-part, and case-insensitively', () => {
    expect(myIssues(issues, 'ada@hanzo.ai')).toHaveLength(2)
    expect(myIssues(issues, 'ADA')).toHaveLength(2)
    expect(myIssues(issues, 'bob')).toHaveLength(1)
  })
  it('empty identity → nothing (honest)', () => {
    expect(myIssues(issues, '')).toHaveLength(0)
    expect(myIssues(issues, null)).toHaveLength(0)
  })
})

describe('deriveCurrentCycle', () => {
  const now = 1_700_000_000_000
  const recent = Math.floor(now / 1000) - 2 * 86400 // 2d ago (seconds)
  const old = Math.floor(now / 1000) - 30 * 86400 // 30d ago
  const issues = [
    mk({ status: 'done', updatedAt: recent }),
    mk({ status: 'in_progress', updatedAt: recent }),
    mk({ status: 'todo', updatedAt: recent }),
    mk({ status: 'done', updatedAt: old }), // outside the window
    mk({ status: 'canceled', updatedAt: recent }), // excluded
  ]
  it('windows recent non-canceled work and computes progress', () => {
    const c = deriveCurrentCycle(issues, 14, now)
    expect(c.total).toBe(3) // recent done + in_progress + todo
    expect(c.done).toBe(1)
    expect(c.progress).toBeCloseTo(1 / 3)
    expect(c.active.map((i) => i.status).sort()).toEqual(['in_progress', 'todo'])
  })
  it('empty set → zero progress, no divide-by-zero', () => {
    expect(deriveCurrentCycle([], 14, now).progress).toBe(0)
  })
})

describe('deriveRoadmap', () => {
  it('links epic children by ExtRef (identifier or id) and computes progress', () => {
    const epic = mk({ id: 'epic_1', identifier: 'ENG-1', kind: 'epic', title: 'Auth revamp' })
    const c1 = mk({ identifier: 'ENG-2', extRef: 'ENG-1', status: 'done' })
    const c2 = mk({ identifier: 'ENG-3', extRef: 'ENG-1', status: 'todo' })
    const c3 = mk({ identifier: 'ENG-4', extRef: 'epic_1', status: 'in_progress' })
    const unrelated = mk({ identifier: 'ENG-5' })
    const rows = deriveRoadmap([epic, c1, c2, c3, unrelated])
    expect(rows).toHaveLength(1)
    expect(rows[0].total).toBe(3)
    expect(rows[0].done).toBe(1)
    expect(rows[0].children.map((x) => x.identifier).sort()).toEqual(['ENG-2', 'ENG-3', 'ENG-4'])
  })
  it('no epics → empty roadmap (honest)', () => {
    expect(deriveRoadmap([mk(), mk()])).toHaveLength(0)
  })
})

describe('external links', () => {
  it('parses the github: anchor form to an issues URL', () => {
    expect(githubUrl(mk({ extRef: 'github:hanzoai/cloud#123' }))).toBe('https://github.com/hanzoai/cloud/issues/123')
  })
  it('passes an absolute URL through', () => {
    expect(githubUrl(mk({ extRef: 'https://github.com/hanzoai/cloud/pull/9' }))).toBe('https://github.com/hanzoai/cloud/pull/9')
  })
  it('is null without a recognizable anchor', () => {
    expect(githubUrl(mk({ extRef: 'some-branch' }))).toBeNull()
    expect(githubUrl(mk({}))).toBeNull()
  })
  it('builds the native git.hanzo.ai URL', () => {
    expect(gitHanzoUrl('hanzoai/cloud')).toBe('https://git.hanzo.ai/hanzoai/cloud')
    expect(gitHanzoUrl('')).toBeNull()
    expect(gitHanzoUrl(undefined)).toBeNull()
  })
})

describe('linkedPRs', () => {
  it('finds agent/git PR rows by shared repo or ExtRef parent', () => {
    const issue = mk({ identifier: 'ENG-10', repo: 'hanzoai/cloud' })
    const prSameRepo = mk({ kind: 'pr', source: 'agent', repo: 'hanzoai/cloud', extRef: 'feat/x' })
    const prParent = mk({ kind: 'pr', source: 'agent', repo: 'other/repo', extRef: 'ENG-10' })
    const otherPr = mk({ kind: 'pr', repo: 'unrelated/repo', extRef: 'feat/y' })
    const links = linkedPRs(issue, [issue, prSameRepo, prParent, otherPr])
    expect(links.map((x) => x.id).sort()).toEqual([prParent.id, prSameRepo.id].sort())
  })
  it('a PR row itself links to nothing', () => {
    expect(linkedPRs(mk({ kind: 'pr' }), [])).toHaveLength(0)
  })
})

describe('relTime', () => {
  const now = 1_700_000_000_000
  it('renders compact buckets', () => {
    expect(relTime(Math.floor(now / 1000), now)).toBe('just now')
    expect(relTime(Math.floor(now / 1000) - 3600, now)).toBe('1h')
    expect(relTime(Math.floor(now / 1000) - 3 * 86400, now)).toBe('3d')
    expect(relTime(undefined, now)).toBe('—')
  })
})

describe('menu helpers', () => {
  const issues = [mk({ assignee: 'ada', labels: ['bug', 'p1'] }), mk({ assignee: 'bob', labels: ['bug'] }), mk({})]
  it('assigneesOf is distinct + sorted', () => {
    expect(assigneesOf(issues)).toEqual(['ada', 'bob'])
  })
  it('labelsOf is distinct + sorted', () => {
    expect(labelsOf(issues)).toEqual(['bug', 'p1'])
  })
  it('parseLabels trims and drops empties', () => {
    expect(parseLabels('bug, , p1 ,')).toEqual(['bug', 'p1'])
  })
})
