import { describe, expect, it } from 'vitest'

import { haystack, rank, rankGrouped, scoreItem, scoreMatch } from './match'

describe('scoreMatch', () => {
  it('ranks prefix > word-start > substring > subsequence', () => {
    const prefix = scoreMatch('vol', 'Volumes')
    const wordStart = scoreMatch('prod', 'Delete prod-db')
    const substring = scoreMatch('ume', 'Volumes')
    const subsequence = scoreMatch('vlm', 'Volumes')

    expect(prefix).toBeGreaterThan(wordStart)
    expect(wordStart).toBeGreaterThan(substring)
    expect(substring).toBeGreaterThan(subsequence)
    expect(subsequence).toBeGreaterThan(0)
  })

  it('scores a prefix hit at the ceiling and is case-insensitive', () => {
    expect(scoreMatch('VOL', 'volumes')).toBe(1000)
    expect(scoreMatch('vol', 'VOLUMES')).toBe(1000)
  })

  it('treats every word-break character as a word start', () => {
    for (const text of ['a db', 'a-db', 'a_db', 'a.db', 'a/db', 'a:db', 'a(db', 'a[db', 'a,db']) {
      expect(scoreMatch('db', text)).toBeGreaterThan(600)
    }
    // Mid-word is a plain substring, ranked strictly below any word start.
    expect(scoreMatch('db', 'axdb')).toBeLessThan(600)
    expect(scoreMatch('db', 'axdb')).toBeGreaterThan(0)
  })

  it('prefers an earlier hit over a later one', () => {
    expect(scoreMatch('db', 'a db')).toBeGreaterThan(scoreMatch('db', 'aaaaaaaaaa db'))
  })

  it('returns 0 when the characters are not present in order', () => {
    expect(scoreMatch('zzz', 'Volumes')).toBe(0)
    expect(scoreMatch('smulov', 'Volumes')).toBe(0)
  })

  it('matches an empty query with a floor score, never 0', () => {
    expect(scoreMatch('', 'anything')).toBe(1)
    expect(scoreMatch('   ', 'anything')).toBe(1)
  })

  it('never compiles the query as a regex — special chars are literal', () => {
    // A RegExp-based matcher would let '.*' match everything.
    expect(scoreMatch('.*', 'volumes')).toBe(0)
    expect(scoreMatch('[a-z]+', 'volumes')).toBe(0)
    expect(scoreMatch('(', 'volumes')).toBe(0)
    // …and the literal text still matches.
    expect(scoreMatch('.*', 'glob .* pattern')).toBeGreaterThan(0)
  })
})

describe('haystack / scoreItem', () => {
  it('matches on label, sublabel and keywords alike', () => {
    const item = { label: 'prod-db', sublabel: 'us-west-2', keywords: 'postgres database' }
    expect(haystack(item)).toBe('prod-db us-west-2 postgres database')
    expect(scoreItem('prod', item)).toBe(1000)
    expect(scoreItem('us-west', item)).toBeGreaterThan(0)
    expect(scoreItem('postgres', item)).toBeGreaterThan(0)
    expect(scoreItem('mysql', item)).toBe(0)
  })

  it('tolerates missing sublabel/keywords', () => {
    expect(haystack({ label: 'solo' })).toBe('solo')
    expect(scoreItem('solo', { label: 'solo' })).toBe(1000)
  })
})

describe('rank', () => {
  const items = [
    { label: 'Volumes' },
    { label: 'Vaults' },
    { label: 'Delete volume' },
    { label: 'Unrelated' },
  ]

  it('drops non-matches and orders best first', () => {
    expect(rank('vol', items).map((i) => i.label)).toEqual(['Volumes', 'Delete volume'])
  })

  it('is stable — equal scores keep input order', () => {
    const tied = [{ label: 'aa x' }, { label: 'aa y' }, { label: 'aa z' }]
    expect(rank('aa', tied).map((i) => i.label)).toEqual(['aa x', 'aa y', 'aa z'])
    expect(rank('aa', [...tied].reverse()).map((i) => i.label)).toEqual(['aa z', 'aa y', 'aa x'])
  })

  it('returns everything, in input order, for an empty query', () => {
    expect(rank('', items)).toEqual(items)
  })
})

describe('rankGrouped', () => {
  it('keeps each group contiguous, ordered by its best member', () => {
    const items = [
      { label: 'vault-1', group: 'Vaults' },
      { label: 'volume-a', group: 'Volumes' },
      { label: 'vault-2', group: 'Vaults' },
      { label: 'volume-b', group: 'Volumes' },
    ]
    // 'volume' prefix-hits the Volumes rows, so that group leads and stays whole.
    expect(rankGrouped('volume', items).map((i) => i.label)).toEqual(['volume-a', 'volume-b'])

    const all = rankGrouped('v', items)
    expect(all.map((i) => i.group)).toEqual(['Vaults', 'Vaults', 'Volumes', 'Volumes'])
  })

  it('drops non-matching groups entirely', () => {
    const items = [
      { label: 'volume-a', group: 'Volumes' },
      { label: 'zebra', group: 'Zoo' },
    ]
    expect(rankGrouped('vol', items).map((i) => i.group)).toEqual(['Volumes'])
  })
})
