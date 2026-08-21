import { describe, it, expect } from 'vitest'

import type { Resource, ResourceKind } from '~/lib/api'
import {
  lifecycle,
  isReady,
  endpoint,
  fleetStats,
  statusSlices,
  recent,
  quickstart,
  provisionSnippet,
  connectSnippet,
  RESOURCE_SPECS,
  specFor,
} from './logic'

const row = (over: Partial<Resource>): Resource => ({
  id: over.name ?? 'id',
  name: 'r',
  kind: 'sql',
  status: 'ready',
  host: 'h.sql.hanzo.ai',
  port: 5432,
  ...over,
})

describe('lifecycle classification', () => {
  it('maps engine + platform statuses to a bucket', () => {
    expect(lifecycle('Ready')).toBe('ready')
    expect(lifecycle('running')).toBe('ready')
    expect(lifecycle('green')).toBe('ready')
    expect(lifecycle('Provisioning')).toBe('provisioning')
    expect(lifecycle('pending')).toBe('provisioning')
    expect(lifecycle('FAILED')).toBe('error')
    expect(lifecycle('degraded')).toBe('error')
    expect(lifecycle('weird')).toBe('other')
    expect(lifecycle(undefined)).toBe('other')
  })
  it('isReady is the ready bucket', () => {
    expect(isReady('active')).toBe(true)
    expect(isReady('creating')).toBe(false)
  })
  it('endpoint joins host:port, honest "—" when no host', () => {
    expect(endpoint(row({ host: 'h.kv.hanzo.ai', port: 6379 }))).toBe('h.kv.hanzo.ai:6379')
    expect(endpoint(row({ host: '', port: 0 }))).toBe('—')
  })
})

describe('fleetStats — derived from the real list only', () => {
  it('counts each bucket and the earliest createdAt', () => {
    const rows = [
      row({ name: 'a', status: 'ready', createdAt: '2026-02-01T00:00:00Z' }),
      row({ name: 'b', status: 'creating', createdAt: '2026-01-01T00:00:00Z' }),
      row({ name: 'c', status: 'error' }),
      row({ name: 'd', status: 'mystery' }),
    ]
    const s = fleetStats(rows)
    expect(s).toMatchObject({ total: 4, ready: 1, provisioning: 1, error: 1 })
    expect(s.since).toBe('2026-01-01T00:00:00Z')
  })
  it('is all-zero (no fabrication) for an empty fleet', () => {
    expect(fleetStats([])).toEqual({ total: 0, ready: 0, provisioning: 0, error: 0, since: undefined })
  })
})

describe('statusSlices — only non-zero buckets, semantic colours', () => {
  it('omits empty buckets and rolls unknowns into Other', () => {
    const slices = statusSlices([
      row({ name: 'a', status: 'ready' }),
      row({ name: 'b', status: 'ready' }),
      row({ name: 'c', status: 'mystery' }),
    ])
    const byLabel = Object.fromEntries(slices.map((s) => [s.label, s.value]))
    expect(byLabel).toEqual({ Ready: 2, Other: 1 })
    expect(slices.every((s) => typeof s.color === 'string')).toBe(true)
  })
  it('renders nothing positive for an empty fleet', () => {
    expect(statusSlices([])).toEqual([])
  })
})

describe('recent — newest first, undated last', () => {
  it('sorts by createdAt desc and caps at n', () => {
    const rows = [
      row({ name: 'old', createdAt: '2026-01-01T00:00:00Z' }),
      row({ name: 'new', createdAt: '2026-03-01T00:00:00Z' }),
      row({ name: 'undated' }),
    ]
    expect(recent(rows, 2).map((r) => r.name)).toEqual(['new', 'old'])
  })
  it('does not mutate the input', () => {
    const rows = [row({ name: 'a' }), row({ name: 'b' })]
    const copy = [...rows]
    recent(rows, 1)
    expect(rows).toEqual(copy)
  })
})

describe('specs cover every wire kind', () => {
  const kinds: ResourceKind[] = ['sql', 'kv', 'datastore', 's3', 'vector', 'docdb', 'search']
  it('has a spec for each kind with a non-empty noun + usage tiles', () => {
    for (const k of kinds) {
      const spec = specFor(k)
      expect(spec).toBeDefined()
      expect(spec.listNoun.length).toBeGreaterThan(0)
      expect(spec.instanceNoun.length).toBeGreaterThan(0)
      expect(spec.usageTiles.length).toBeGreaterThanOrEqual(3)
    }
  })
  it('RESOURCE_SPECS and specFor agree', () => {
    expect(specFor('kv')).toBe(RESOURCE_SPECS.kv)
  })
})

describe('snippets are real contract text, never fabricated metrics', () => {
  it('provision hits POST /v1/provisioning/<kind> with the given name', () => {
    const s = provisionSnippet('kv', 'my-cache')
    expect(s.code).toContain('POST https://api.hanzo.ai/v1/provisioning/kv')
    expect(s.code).toContain('"name":"my-cache"')
  })
  it('connect uses the kind client command + the hint', () => {
    const s = connectSnippet(RESOURCE_SPECS.sql, 'host:5432')
    expect(s.code).toContain('psql')
    expect(s.code).toContain('host:5432')
    expect(s.code).toContain(RESOURCE_SPECS.sql.connectHint)
  })
  it('quickstart personalises to the first instance when present', () => {
    const out = quickstart('vector', RESOURCE_SPECS.vector, { firstName: 'docs', firstHost: 'docs.vector.hanzo.ai:6333' })
    expect(out).toHaveLength(2)
    expect(out[0].code).toContain('"name":"docs"')
    expect(out[1].code).toContain('docs.vector.hanzo.ai')
  })
  it('quickstart falls back to a placeholder for an empty fleet', () => {
    const out = quickstart('sql', RESOURCE_SPECS.sql, {})
    expect(out[0].code).toContain('"name":"my-sql"')
  })
})
