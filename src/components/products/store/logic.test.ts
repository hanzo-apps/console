import { describe, it, expect } from 'vitest'

import type { OssApp } from '~/lib/api/oss-apps'
import {
  PAGE_SIZE,
  filterApps,
  paginate,
  remaining,
  availableTags,
  featuredQuickTags,
  featuredApps,
  hasDeploySource,
  slugify,
} from './logic'

const app = (over: Partial<OssApp> & Pick<OssApp, 'id'>): OssApp => ({
  name: over.id,
  description: '',
  version: 'latest',
  logo: 'logo.svg',
  tags: [],
  links: {},
  ...over,
})

const CATALOG: OssApp[] = [
  app({ id: 'n8n', name: 'n8n', description: 'Workflow automation', tags: ['automation', 'self-hosted'], links: { github: 'https://github.com/n8n-io/n8n' } }),
  app({ id: 'postgres', name: 'Postgres', description: 'The database', tags: ['database'], links: { github: 'https://github.com/postgres/postgres' } }),
  app({ id: 'grafana', name: 'Grafana', description: 'Dashboards + monitoring', tags: ['monitoring', 'self-hosted'] }),
  app({ id: 'ghost', name: 'Ghost', description: 'Publishing', tags: ['cms', 'caprover'], links: { github: 'https://github.com/TryGhost/Ghost' } }),
]

describe('filterApps', () => {
  it('empty query + no tags → the full list, order preserved', () => {
    expect(filterApps(CATALOG).map((a) => a.id)).toEqual(['n8n', 'postgres', 'grafana', 'ghost'])
  })

  it('query matches name, id, description, and tags (case-insensitive substring)', () => {
    expect(filterApps(CATALOG, { query: 'DATA' }).map((a) => a.id)).toEqual(['postgres']) // description "The database"
    expect(filterApps(CATALOG, { query: 'monitor' }).map((a) => a.id)).toEqual(['grafana']) // tag + description
    expect(filterApps(CATALOG, { query: 'n8N' }).map((a) => a.id)).toEqual(['n8n']) // name/id
  })

  it('tag filter is OR across selected tags', () => {
    expect(filterApps(CATALOG, { tags: ['self-hosted'] }).map((a) => a.id)).toEqual(['n8n', 'grafana'])
    expect(filterApps(CATALOG, { tags: ['database', 'monitoring'] }).map((a) => a.id)).toEqual(['postgres', 'grafana'])
  })

  it('query AND tags both apply', () => {
    expect(filterApps(CATALOG, { query: 'workflow', tags: ['automation'] }).map((a) => a.id)).toEqual(['n8n'])
    expect(filterApps(CATALOG, { query: 'workflow', tags: ['database'] })).toEqual([])
  })

  it('treats the query as a literal substring, not a regex (ReDoS-safe)', () => {
    expect(filterApps(CATALOG, { query: '.*' })).toEqual([]) // no app literally contains ".*"
    expect(filterApps(CATALOG, { query: '(' })).toEqual([]) // an invalid regex would throw; a substring is safe
  })
})

describe('paginate + remaining', () => {
  it('slices to the visible count and reports the remainder', () => {
    expect(paginate(CATALOG, 2).map((a) => a.id)).toEqual(['n8n', 'postgres'])
    expect(remaining(CATALOG.length, 2)).toBe(2)
    expect(remaining(CATALOG.length, 99)).toBe(0)
    expect(paginate(CATALOG, 0)).toEqual([])
  })

  it('PAGE_SIZE caps the initial DOM at 48', () => {
    expect(PAGE_SIZE).toBe(48)
  })
})

describe('tags', () => {
  it('availableTags is the distinct, sorted set, without provenance tags', () => {
    // 'caprover' (the upstream marketplace an entry came from) is never a browsable chip.
    expect(availableTags(CATALOG)).toEqual(['automation', 'cms', 'database', 'monitoring', 'self-hosted'])
  })

  it('featuredQuickTags keeps present FEATURED_TAGS and hides provenance tags', () => {
    const chips = featuredQuickTags(CATALOG)
    expect(chips).toContain('self-hosted')
    expect(chips).toContain('database')
    expect(chips).toContain('monitoring')
    expect(chips).toContain('automation')
    expect(chips).not.toContain('caprover') // provenance — hidden from quick chips
    expect(chips).not.toContain('cms') // not a FEATURED tag
  })
})

describe('featuredApps + hasDeploySource', () => {
  it('picks well-known apps present in the catalog, in curated order', () => {
    // FEATURED_IDS order is n8n, postgres, grafana, … → matches the present ones
    expect(featuredApps(CATALOG, 3).map((a) => a.id)).toEqual(['n8n', 'postgres', 'grafana'])
  })

  it('falls back to the first N when no curated id is present (never fabricated)', () => {
    const other = [app({ id: 'zzz', name: 'Zzz' }), app({ id: 'yyy', name: 'Yyy' })]
    expect(featuredApps(other, 5).map((a) => a.id)).toEqual(['zzz', 'yyy'])
  })

  it('hasDeploySource is true only with a GitHub repo (the buildable source)', () => {
    expect(hasDeploySource(CATALOG[0])).toBe(true) // n8n has github
    expect(hasDeploySource(CATALOG[2])).toBe(false) // grafana has no github link in this fixture
  })
})

describe('slugify', () => {
  it('produces a DNS/PaaS-safe slug', () => {
    expect(slugify('My App')).toBe('my-app')
    expect(slugify('Ackee 2.0!')).toBe('ackee-2-0')
    expect(slugify('  --Trim__me--  ')).toBe('trim-me')
    expect(slugify('n8n')).toBe('n8n')
  })

  it('never returns empty (garbage → "app") and caps length', () => {
    expect(slugify('!!!')).toBe('app')
    expect(slugify('')).toBe('app')
    expect(slugify('a'.repeat(80)).length).toBeLessThanOrEqual(40)
  })
})
