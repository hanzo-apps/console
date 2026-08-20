import { describe, it, expect } from 'vitest'

import { repoStatusLabel, pendingRepoNames } from './logic'
import type { GitHubRepo } from '~/lib/api'

const repo = (o: Partial<GitHubRepo>): GitHubRepo => ({
  name: 'r', fullName: 'o/r', private: false, defaultBranch: 'main',
  imported: false, syncStatus: '', lastSyncedAt: '', htmlUrl: '', ...o,
})

describe('repoStatusLabel', () => {
  it('shows Importing only while not yet imported', () => {
    expect(repoStatusLabel(repo({ imported: false }), true)).toBe('Importing')
    // Once native exists, the real status wins even if the optimistic flag lingers.
    expect(repoStatusLabel(repo({ imported: true, syncStatus: 'synced' }), true)).toBe('Synced')
  })
  it('reports Not imported / Synced / Conflict', () => {
    expect(repoStatusLabel(repo({ imported: false }), false)).toBe('Not imported')
    expect(repoStatusLabel(repo({ imported: true, syncStatus: 'synced' }), false)).toBe('Synced')
    expect(repoStatusLabel(repo({ imported: true, syncStatus: 'conflict' }), false)).toBe('Conflict')
    // Imported with an empty status still reads Synced (a repo with no conflict).
    expect(repoStatusLabel(repo({ imported: true, syncStatus: '' }), false)).toBe('Synced')
  })
})

describe('pendingRepoNames', () => {
  it('returns only the not-yet-imported repo names', () => {
    const repos = [repo({ name: 'a', imported: true }), repo({ name: 'b' }), repo({ name: 'c' })]
    expect(pendingRepoNames(repos)).toEqual(['b', 'c'])
    expect(pendingRepoNames([])).toEqual([])
  })
})
