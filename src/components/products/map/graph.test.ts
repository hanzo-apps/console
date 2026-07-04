import { describe, expect, it } from 'vitest'

import {
  buildGraph,
  layout,
  normalizeStatus,
  summarize,
  TIER_X,
  type MapApp,
  type MapInput,
  type ResourceWithKind,
} from './graph'

// ── Fixtures ────────────────────────────────────────────────────────────────

const app = (over: Partial<MapApp> = {}): MapApp => ({
  id: 'a1',
  org: 'acme',
  projectId: 'p1',
  slug: 'web',
  name: 'web',
  ...over,
})

const resource = (over: Partial<ResourceWithKind> = {}): ResourceWithKind => ({
  id: 'r1',
  name: 'primary',
  kind: 'sql',
  status: 'running',
  host: 'primary.sql.acme.hanzo.internal',
  port: 5432,
  ...over,
})

const graphOf = (input: Partial<MapInput> = {}) =>
  buildGraph({ apps: input.apps ?? [], resources: input.resources ?? [] })

// ── normalizeStatus ───────────────────────────────────────────────────────────

describe('normalizeStatus', () => {
  it('maps live/running/ready to ok', () => {
    for (const s of ['live', 'RUNNING', 'ready', 'green', 'healthy']) {
      expect(normalizeStatus(s)).toBe('ok')
    }
  })
  it('maps build/deploy lifecycle to building', () => {
    for (const s of ['building', 'deploying', 'Provisioning', 'pending', 'queued']) {
      expect(normalizeStatus(s)).toBe('building')
    }
  })
  it('maps failure states to error', () => {
    for (const s of ['error', 'failed', 'degraded', 'red', 'CrashLoopBackOff']) {
      expect(normalizeStatus(s)).toBe('error')
    }
  })
  it('treats empty/unknown as idle — never guesses ok', () => {
    expect(normalizeStatus('')).toBe('idle')
    expect(normalizeStatus(undefined)).toBe('idle')
    expect(normalizeStatus('stopped')).toBe('idle')
    expect(normalizeStatus('mystery')).toBe('idle')
  })
})

// ── buildGraph: nodes ─────────────────────────────────────────────────────────

describe('buildGraph — nodes', () => {
  it('is empty for an empty landscape', () => {
    const g = graphOf()
    expect(g.nodes).toEqual([])
    expect(g.edges).toEqual([])
  })

  it('creates one app node per app, using operator phase over status', () => {
    const g = graphOf({ apps: [app({ id: 'a1', name: 'web', phase: 'live', status: 'building', replicas: 3, source: 'git' })] })
    const node = g.nodes.find((n) => n.id === 'app:a1')
    expect(node).toBeDefined()
    expect(node!.data.kind).toBe('app')
    expect(node!.data.label).toBe('web')
    expect(node!.data.status).toBe('ok') // phase 'live' wins over status 'building'
    expect(node!.data.productId).toBe('app-platform')
    expect(node!.data.fact).toBe('3× · git')
  })

  it('creates a resource node per resource with a kind-scoped id + deep-link product', () => {
    const g = graphOf({ resources: [resource({ kind: 'vector', name: 'emb', status: 'creating' })] })
    const node = g.nodes.find((n) => n.id === 'resource:vector:emb')
    expect(node).toBeDefined()
    expect(node!.data.kind).toBe('resource')
    expect(node!.data.resourceKind).toBe('vector')
    expect(node!.data.productId).toBe('vector')
    expect(node!.data.status).toBe('building') // 'creating' → building
  })

  it('derives a domain (entry) node per app host and inherits the app status', () => {
    const g = graphOf({ apps: [app({ id: 'a1', status: 'live', domains: ['web.acme.hanzo.app', 'acme.com'] })] })
    const domains = g.nodes.filter((n) => n.data.kind === 'domain')
    expect(domains.map((n) => n.id).sort()).toEqual(['domain:acme.com', 'domain:web.acme.hanzo.app'])
    expect(domains.every((n) => n.data.status === 'ok')).toBe(true)
    expect(domains.every((n) => n.data.href?.startsWith('https://'))).toBe(true)
  })

  it('does not duplicate a domain shared across apps', () => {
    const g = graphOf({
      apps: [
        app({ id: 'a1', name: 'blue', domains: ['acme.com'] }),
        app({ id: 'a2', name: 'green', domains: ['acme.com'] }),
      ],
    })
    expect(g.nodes.filter((n) => n.id === 'domain:acme.com')).toHaveLength(1)
  })
})

// ── buildGraph: edges (honesty) ───────────────────────────────────────────────

describe('buildGraph — edges', () => {
  it('draws a route edge from each domain to its app', () => {
    const g = graphOf({ apps: [app({ id: 'a1', domains: ['acme.com'] })] })
    const route = g.edges.find((e) => e.reason === 'route')
    expect(route).toMatchObject({ source: 'domain:acme.com', target: 'app:a1' })
  })

  it('NEVER fabricates an app→resource edge when no reference is exposed', () => {
    const g = graphOf({
      apps: [app({ id: 'a1', env: [{ key: 'PORT', value: '8080' }] })],
      resources: [resource({ name: 'primary' })],
    })
    expect(g.edges.filter((e) => e.reason === 'reference')).toHaveLength(0)
  })

  it('draws an app→resource edge when an unmasked env value names the resource host', () => {
    const g = graphOf({
      apps: [app({ id: 'a1', env: [{ key: 'DATABASE_URL', value: 'postgres://u@primary.sql.acme.hanzo.internal:5432/db' }] })],
      resources: [resource({ name: 'primary', host: 'primary.sql.acme.hanzo.internal' })],
    })
    const ref = g.edges.find((e) => e.reason === 'reference')
    expect(ref).toMatchObject({ source: 'app:a1', target: 'resource:sql:primary' })
  })

  it('ignores masked (empty) secret values — a masked secret is not a link', () => {
    const g = graphOf({
      apps: [app({ id: 'a1', env: [{ key: 'DATABASE_URL', value: '', secret: true }] })],
      resources: [resource({ name: 'primary' })],
    })
    expect(g.edges.filter((e) => e.reason === 'reference')).toHaveLength(0)
  })

  it('does not match on a too-short resource name', () => {
    const g = graphOf({
      apps: [app({ id: 'a1', env: [{ key: 'NOTE', value: 'the db is fine' }] })],
      resources: [resource({ name: 'db', host: '' })],
    })
    expect(g.edges.filter((e) => e.reason === 'reference')).toHaveLength(0)
  })
})

// ── layout (deterministic) ────────────────────────────────────────────────────

describe('layout', () => {
  const sample = () =>
    graphOf({
      apps: [app({ id: 'a1', name: 'web', domains: ['acme.com'] }), app({ id: 'a2', name: 'api' })],
      resources: [resource({ name: 'primary', kind: 'sql' }), resource({ id: 'r2', name: 'cache', kind: 'kv' })],
    })

  it('places each tier at its column x-offset', () => {
    const positioned = layout(sample())
    for (const n of positioned) {
      expect(n.position.x).toBe(TIER_X[n.data.kind])
    }
  })

  it('is deterministic — identical positions on repeat runs', () => {
    expect(layout(sample())).toEqual(layout(sample()))
  })

  it('orders nodes within a tier by id (no random placement)', () => {
    const resources = layout(sample())
      .filter((n) => n.data.kind === 'resource')
      .map((n) => n.id)
    expect(resources).toEqual([...resources].sort())
  })
})

// ── summarize ─────────────────────────────────────────────────────────────────

describe('summarize', () => {
  it('counts tiers and folds health', () => {
    const g = graphOf({
      apps: [app({ id: 'a1', status: 'live', domains: ['acme.com'] }), app({ id: 'a2', status: 'error' })],
      resources: [resource({ name: 'primary', status: 'running' })],
    })
    const s = summarize(g)
    expect(s).toEqual({ apps: 2, resources: 1, domains: 1, running: 3, issues: 1 })
  })
})
