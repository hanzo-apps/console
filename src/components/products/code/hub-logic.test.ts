import { describe, it, expect } from 'vitest'
import type { Repo } from '~/lib/api/git'
import {
  canonicalTab,
  filterRepos,
  groupReposByOrg,
  repoHref,
  repoFileHref,
  boundedCode,
  askRepoPrompt,
  askFilePrompt,
  HUB_TABS,
} from './hub-logic'

const repo = (over: Partial<Repo>): Repo => ({
  id: over.name ?? 'r',
  org: 'hanzo',
  name: 'repo',
  description: undefined,
  defaultBranch: 'main',
  branches: [],
  cloneUrl: '',
  sshUrl: '',
  sizeBytes: 0,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
})

describe('canonicalTab', () => {
  it('folds valid tabs and defaults unknown/empty to repos', () => {
    expect(canonicalTab('search')).toBe('search')
    expect(canonicalTab('ASK')).toBe('ask')
    expect(canonicalTab('')).toBe('repos')
    expect(canonicalTab(undefined)).toBe('repos')
    expect(canonicalTab('bogus')).toBe('repos')
    for (const t of HUB_TABS) expect(canonicalTab(t)).toBe(t)
  })
})

describe('filterRepos', () => {
  const repos = [
    repo({ name: 'cloud', description: 'the backend' }),
    repo({ name: 'console', description: 'the admin UI', org: 'hanzo' }),
    repo({ name: 'node', description: 'lux node', org: 'lux' }),
  ]
  it('returns the full list for an empty query', () => {
    expect(filterRepos(repos, '')).toHaveLength(3)
    expect(filterRepos(repos, '   ')).toHaveLength(3)
  })
  it('matches name, description, and org (case-insensitive)', () => {
    expect(filterRepos(repos, 'CLOUD').map((r) => r.name)).toEqual(['cloud'])
    expect(filterRepos(repos, 'admin').map((r) => r.name)).toEqual(['console'])
    expect(filterRepos(repos, 'lux').map((r) => r.name)).toEqual(['node'])
  })
  it('is a LITERAL substring match — a regex-special query never throws or over-matches (ReDoS-safe)', () => {
    // A catastrophic-backtracking pattern as a literal string must simply not match.
    expect(() => filterRepos(repos, '(a+)+$')).not.toThrow()
    expect(filterRepos(repos, '(a+)+$')).toEqual([])
    expect(filterRepos(repos, '.*')).toEqual([]) // literal ".*" matches no name
  })
})

describe('groupReposByOrg', () => {
  it('groups by org, sorts groups by name, preserves in-group order', () => {
    const repos = [
      repo({ name: 'node', org: 'lux' }),
      repo({ name: 'cloud', org: 'hanzo' }),
      repo({ name: 'console', org: 'hanzo' }),
    ]
    const groups = groupReposByOrg(repos)
    expect(groups.map((g) => g.org)).toEqual(['hanzo', 'lux'])
    expect(groups[0].repos.map((r) => r.name)).toEqual(['cloud', 'console']) // input order kept
  })
  it('buckets an empty org under a dash, never dropping a row', () => {
    const groups = groupReposByOrg([repo({ name: 'x', org: '' })])
    expect(groups).toEqual([{ org: '—', repos: [expect.objectContaining({ name: 'x' })] }])
  })
})

describe('deep links', () => {
  it('repoHref encodes the name', () => {
    expect(repoHref('go-ethereum')).toBe('/code/repos/go-ethereum')
    expect(repoHref('a b')).toBe('/code/repos/a%20b')
  })
  it('repoFileHref carries path + view=blob, and ref when present', () => {
    expect(repoFileHref('cloud', 'clients/git/browse.go')).toBe(
      '/code/repos/cloud?path=clients%2Fgit%2Fbrowse.go&view=blob',
    )
    expect(repoFileHref('cloud', 'a.go', 'feature/x')).toBe(
      '/code/repos/cloud?ref=feature%2Fx&path=a.go&view=blob',
    )
  })
})

describe('boundedCode', () => {
  it('returns content unchanged when within bounds', () => {
    const b = boundedCode('a\nb\nc')
    expect(b).toEqual({ text: 'a\nb\nc', truncated: false, shownLines: 3 })
  })
  it('truncates by line count', () => {
    const b = boundedCode(Array.from({ length: 500 }, (_, i) => `l${i}`).join('\n'), 10)
    expect(b.truncated).toBe(true)
    expect(b.shownLines).toBe(10)
    expect(b.text.split('\n')).toHaveLength(10)
  })
  it('truncates by char count', () => {
    const b = boundedCode('x'.repeat(20000), 1000, 100)
    expect(b.truncated).toBe(true)
    expect(b.text.length).toBe(100)
  })
})

describe('assistant seed prompts', () => {
  it('askRepoPrompt names the repo and folds in the description', () => {
    expect(askRepoPrompt({ name: 'cloud' })).toContain('`cloud`')
    const p = askRepoPrompt({ name: 'cloud', description: 'the backend' })
    expect(p).toContain('`cloud`')
    expect(p).toContain('the backend')
  })
  it('askFilePrompt includes the locator and a fenced (bounded) code block', () => {
    const p = askFilePrompt('cloud', 'main.go', 'Go', 'package main\n\nfunc main() {}')
    expect(p).toContain('`cloud`')
    expect(p).toContain('Path: main.go')
    expect(p).toContain('```go') // language lowercased into the fence
    expect(p).toContain('func main()')
  })
  it('askFilePrompt marks truncation for a large file', () => {
    const big = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n')
    const p = askFilePrompt('cloud', 'big.txt', '', big)
    expect(p).toContain('Truncated')
  })
})
