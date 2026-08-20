import { describe, expect, it } from 'vitest'

import {
  cloneCommand,
  normalizeBlob,
  normalizeCommit,
  normalizeCommits,
  normalizeMirror,
  normalizeMirrors,
  normalizeReadme,
  normalizeRef,
  normalizeRefList,
  normalizeRepo,
  normalizeRepos,
  normalizeTree,
  normalizeTreeEntry,
  repoKey,
  shortHead,
  withQuery,
} from './git'

describe('normalizeRepo', () => {
  it('maps the full cloud repoView (camelCase)', () => {
    const r = normalizeRepo({
      id: 'repo_abc',
      org: 'maxpower',
      project: 'web',
      name: 'site',
      description: 'the marketing site',
      defaultBranch: 'main',
      branches: ['main', 'dev'],
      head: '9f2c1ab0d4e5f6789abcdef0123456789abcdef0',
      cloneUrl: 'https://git.hanzo.ai/maxpower/site.git',
      sshUrl: 'git@git.hanzo.ai:maxpower/site.git',
      sizeBytes: 4096,
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-10T00:00:00Z',
    })
    expect(r).toEqual({
      id: 'repo_abc',
      org: 'maxpower',
      project: 'web',
      name: 'site',
      description: 'the marketing site',
      defaultBranch: 'main',
      branches: ['main', 'dev'],
      head: '9f2c1ab0d4e5f6789abcdef0123456789abcdef0',
      cloneUrl: 'https://git.hanzo.ai/maxpower/site.git',
      sshUrl: 'git@git.hanzo.ai:maxpower/site.git',
      sizeBytes: 4096,
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-10T00:00:00Z',
    })
  })

  it('tolerates snake_case + a numeric-string size, defaults branch to main', () => {
    const r = normalizeRepo({ name: 'api', clone_url: 'https://git.hanzo.ai/o/api.git', size_bytes: '2048', created_at: 'x' })
    expect(r?.defaultBranch).toBe('main')
    expect(r?.cloneUrl).toBe('https://git.hanzo.ai/o/api.git')
    expect(r?.sizeBytes).toBe(2048)
    expect(r?.branches).toEqual([])
  })

  it('drops a row with no name (the org-unique handle is mandatory)', () => {
    expect(normalizeRepo({ cloneUrl: 'https://x/y.git' })).toBeNull()
    expect(normalizeRepo(null)).toBeNull()
  })

  it('empty repo (no HEAD/branches) → empty branches, undefined head', () => {
    const r = normalizeRepo({ name: 'fresh', defaultBranch: 'main' })
    expect(r?.branches).toEqual([])
    expect(r?.head).toBeUndefined()
    expect(r?.sizeBytes).toBe(0)
  })
})

describe('normalizeRepos', () => {
  it('reads the array from the { data: [...] } envelope', () => {
    const list = normalizeRepos({ data: [{ name: 'a' }, { name: 'b' }, { notARepo: true }] })
    expect(list.map((r) => r.name)).toEqual(['a', 'b'])
  })

  it('accepts a bare array or the repos/items keys, garbage → []', () => {
    expect(normalizeRepos([{ name: 'a' }]).length).toBe(1)
    expect(normalizeRepos({ repos: [{ name: 'a' }] }).length).toBe(1)
    expect(normalizeRepos({ items: [{ name: 'a' }] }).length).toBe(1)
    expect(normalizeRepos('nope')).toEqual([])
    expect(normalizeRepos(null)).toEqual([])
  })
})

describe('derived helpers', () => {
  it('cloneCommand builds `git clone <url>` (empty url → empty)', () => {
    expect(cloneCommand({ cloneUrl: 'https://git.hanzo.ai/o/r.git' })).toBe('git clone https://git.hanzo.ai/o/r.git')
    expect(cloneCommand({ cloneUrl: '' })).toBe('')
  })

  it('shortHead → first 7 chars, em dash when empty', () => {
    expect(shortHead('9f2c1ab0d4e5')).toBe('9f2c1ab')
    expect(shortHead(undefined)).toBe('—')
    expect(shortHead('')).toBe('—')
  })

  it('repoKey is org+project+name qualified (no cross-scope clash)', () => {
    expect(repoKey({ org: 'o', project: 'p', name: 'r' } as never)).toBe('o/p/r')
    expect(repoKey({ org: 'o', name: 'r' } as never)).toBe('o//r')
  })
})

describe('refs', () => {
  it('normalizeRef maps name+sha (snake/camel/alt keys), drops nameless', () => {
    expect(normalizeRef({ name: 'main', sha: 'abc' })).toEqual({ name: 'main', sha: 'abc' })
    expect(normalizeRef({ branch: 'dev', commit: 'def' })).toEqual({ name: 'dev', sha: 'def' })
    expect(normalizeRef({ name: 'v1' })).toEqual({ name: 'v1', sha: '' })
    expect(normalizeRef({ sha: 'x' })).toBeNull()
  })

  it('normalizeRefList splits branches/tags + resolves default (falls back to first branch)', () => {
    const r = normalizeRefList({
      branches: [{ name: 'main', sha: '1' }, { name: 'dev', sha: '2' }],
      tags: [{ name: 'v1.0.0', sha: '3' }],
      default: 'main',
    })
    expect(r.branches.map((b) => b.name)).toEqual(['main', 'dev'])
    expect(r.tags.map((t) => t.name)).toEqual(['v1.0.0'])
    expect(r.default).toBe('main')
  })

  it('normalizeRefList defaults to first branch, then main, when no default given', () => {
    expect(normalizeRefList({ branches: [{ name: 'trunk' }] }).default).toBe('trunk')
    expect(normalizeRefList({}).default).toBe('main')
    expect(normalizeRefList(null)).toEqual({ branches: [], tags: [], default: 'main' })
  })
})

describe('tree', () => {
  it('normalizeTreeEntry coerces type (dir/directory/isDir → tree) + derives name from path', () => {
    expect(normalizeTreeEntry({ name: 'src', type: 'dir', size: 0 })?.type).toBe('tree')
    expect(normalizeTreeEntry({ path: 'src/index.ts', type: 'blob', size: 12 })).toEqual({
      name: 'index.ts',
      path: 'src/index.ts',
      type: 'blob',
      size: 12,
      mode: '',
    })
    expect(normalizeTreeEntry({ name: 'x', isDir: true })?.type).toBe('tree')
    expect(normalizeTreeEntry({ size: 1 })).toBeNull()
  })

  it('normalizeTree reads from entries/tree/data keys, garbage → []', () => {
    expect(normalizeTree({ entries: [{ name: 'a', type: 'blob' }] }).length).toBe(1)
    expect(normalizeTree({ tree: [{ name: 'a' }] }).length).toBe(1)
    expect(normalizeTree([{ name: 'a' }]).length).toBe(1)
    expect(normalizeTree('nope')).toEqual([])
  })
})

describe('blob', () => {
  it('normalizeBlob defaults encoding to utf8, reads binary/truncated flags', () => {
    expect(normalizeBlob({ path: 'a.txt', content: 'hi', size: 2 })).toEqual({
      path: 'a.txt',
      size: 2,
      encoding: 'utf8',
      content: 'hi',
      binary: false,
      truncated: false,
    })
    const b = normalizeBlob({ path: 'logo.png', encoding: 'base64', content: 'AAAA', binary: true, truncated: false, size: 100 })
    expect(b?.encoding).toBe('base64')
    expect(b?.binary).toBe(true)
  })

  it('normalizeBlob → null only for a truly empty payload', () => {
    expect(normalizeBlob({})).toBeNull()
    expect(normalizeBlob(null)).toBeNull()
    expect(normalizeBlob({ size: 0 })).not.toBeNull() // an empty-but-real file
  })
})

describe('commits', () => {
  it('normalizeCommit derives shortSha (first 7) when absent, maps snake_case authors', () => {
    expect(
      normalizeCommit({ sha: '9f2c1ab0d4e5f6', message: 'init', author_name: 'Dev', author_email: 'd@x', date: 'x' }),
    ).toEqual({ sha: '9f2c1ab0d4e5f6', shortSha: '9f2c1ab', message: 'init', authorName: 'Dev', authorEmail: 'd@x', date: 'x' })
    expect(normalizeCommit({ message: 'no sha' })).toBeNull()
  })

  it('normalizeCommits reads from commits/data/log, garbage → []', () => {
    expect(normalizeCommits({ commits: [{ sha: 'a' }, { sha: 'b' }] }).map((c) => c.sha)).toEqual(['a', 'b'])
    expect(normalizeCommits({ log: [{ id: 'z' }] }).length).toBe(1)
    expect(normalizeCommits(null)).toEqual([])
  })
})

describe('readme', () => {
  it('normalizeReadme defaults path + encoding, null on empty', () => {
    expect(normalizeReadme({ path: 'README.md', content: '# hi', encoding: 'utf8' })).toEqual({
      path: 'README.md',
      content: '# hi',
      encoding: 'utf8',
    })
    expect(normalizeReadme({ content: 'x' })?.path).toBe('README.md')
    expect(normalizeReadme({})).toBeNull()
    expect(normalizeReadme(null)).toBeNull()
  })
})

describe('mirrors', () => {
  it('maps the cloud mirrorTargetView', () => {
    expect(
      normalizeMirror({
        id: 'mir_2d90',
        repo: 'widgets',
        host: 'github.com',
        url: 'https://github.com/acme/widgets.git',
        createdAt: '2026-07-01T10:00:00Z',
      }),
    ).toEqual({
      id: 'mir_2d90',
      repo: 'widgets',
      host: 'github.com',
      url: 'https://github.com/acme/widgets.git',
      createdAt: '2026-07-01T10:00:00Z',
    })
  })

  it('derives host from the url when the backend omits it', () => {
    expect(normalizeMirror({ url: 'https://GitLab.com/acme/x.git' })?.host).toBe('gitlab.com')
  })

  it('drops a target with no url — the url IS the target', () => {
    expect(normalizeMirror({ id: 'mir_1', host: 'github.com' })).toBeNull()
  })

  it('reads the list from data/mirrors/items, and from a bare array', () => {
    const one = [{ url: 'https://github.com/a/b.git' }]
    expect(normalizeMirrors({ data: one })).toHaveLength(1)
    expect(normalizeMirrors({ mirrors: one })).toHaveLength(1)
    expect(normalizeMirrors({ items: one })).toHaveLength(1)
    expect(normalizeMirrors(one)).toHaveLength(1)
  })

  it('an empty list is a real answer (no target configured), not a failure', () => {
    expect(normalizeMirrors({ data: [] })).toEqual([])
    expect(normalizeMirrors([])).toEqual([])
  })

  // The distinction the whole face rests on: a payload with no list is NOT "no target".
  // Returning [] for any of these would accuse every repo in the org at once.
  it('returns null — never [] — when the payload carries no list at all', () => {
    for (const p of [undefined, null, {}, 'ok', 7, { data: null }, { error: 'nope' }, { targets: [] }]) {
      expect(normalizeMirrors(p)).toBeNull()
    }
  })

  it('a list of unreadable rows is still a list — it answered, it just named no target', () => {
    expect(normalizeMirrors({ data: [{ nope: 1 }] })).toEqual([])
  })
})

describe('withQuery (url construction)', () => {
  it('appends non-empty ref + path as encoded query params', () => {
    expect(withQuery('/v1/git/repos/site/tree', { ref: 'main', path: 'src/lib' })).toBe(
      '/v1/git/repos/site/tree?ref=main&path=src%2Flib',
    )
  })

  it('percent-encodes a slashed ref so it stays unambiguous from the path', () => {
    expect(withQuery('/v1/git/repos/site/blob', { ref: 'feature/x', path: 'a b.ts' })).toBe(
      '/v1/git/repos/site/blob?ref=feature%2Fx&path=a%20b.ts',
    )
  })

  it('drops empty/undefined values (no dangling params, no ? when all empty)', () => {
    expect(withQuery('/v1/git/repos/site/tree', { ref: 'main', path: '' })).toBe('/v1/git/repos/site/tree?ref=main')
    expect(withQuery('/v1/git/repos/site/tree', { ref: undefined, path: undefined })).toBe('/v1/git/repos/site/tree')
    expect(withQuery('/v1/git/repos/site/commits', { ref: 'main', path: undefined, limit: 50 })).toBe(
      '/v1/git/repos/site/commits?ref=main&limit=50',
    )
  })
})
