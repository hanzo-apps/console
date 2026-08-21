import { describe, expect, it } from 'vitest'
import type { ServiceMetric } from '@hanzo/canvas/pure'

import type { PlatformApp } from '~/lib/api/platform-apps'
import { buildProjectCanvas, summarizeCanvas, type CanvasResource, type ServiceDepEdge } from './canvas'

function app(over: Partial<PlatformApp>): PlatformApp {
  return {
    id: over.id ?? 'a1',
    org: 'o',
    projectId: 'p1',
    slug: over.slug ?? 'api',
    name: over.name ?? 'API',
    environment: over.environment ?? 'production',
    source: 'image',
    repo: {},
    image: { repository: 'hanzoai/api', tag: 'v1' },
    env: [],
    port: 8080,
    replicas: 2,
    domains: [],
    status: 'live',
    createdAt: 0,
    updatedAt: 1_700_000_000,
    projectSlug: 'acme',
    ...over,
  }
}

const res = (over: Partial<CanvasResource>): CanvasResource => ({ kind: 'vector', name: 'vec', status: 'ready', host: 'vector.internal', ...over })

describe('buildProjectCanvas', () => {
  it('maps an app to a service node with real status/source/replicas/capability', () => {
    const { nodes } = buildProjectCanvas({ apps: [app({})], resources: [] })
    const n = nodes.find((x) => x.kind === 'app')!
    expect(n.name).toBe('API')
    expect(n.status).toBe('active')
    expect(n.replicas).toBe(2)
    expect(n.source).toEqual({ kind: 'image', ref: 'hanzoai/api:v1' })
    expect(n.deployedAt).toBe(1_700_000_000_000) // seconds → ms
    expect(n.capability?.path).toBe('/v1/platform')
  })

  it('infers a known /v1 capability from an exact image/slug match', () => {
    const { nodes } = buildProjectCanvas({ apps: [app({ slug: 'vector', image: { repository: 'hanzoai/vector', tag: 'v2' } })], resources: [] })
    expect(nodes[0].capability?.path).toBe('/v1/provisioning/vector')
  })

  it('draws a domain→app route edge from the app own domains', () => {
    const { nodes, edges } = buildProjectCanvas({ apps: [app({ domains: ['api.acme.dev'] })], resources: [] })
    expect(nodes.some((n) => n.kind === 'domain' && n.name === 'api.acme.dev')).toBe(true)
    expect(edges.some((e) => e.reason === 'route' && e.source === 'dom:api.acme.dev')).toBe(true)
  })

  it('draws app→resource reference edge ONLY when an unmasked env value names it', () => {
    const linked = app({ env: [{ key: 'VECTOR_URL', value: 'vector.internal:6333', secret: false }] })
    const model = buildProjectCanvas({ apps: [linked], resources: [res({})] })
    expect(model.nodes.some((n) => n.kind === 'vector')).toBe(true)
    expect(model.edges.some((e) => e.reason === 'reference' && e.target === 'res:vector:vec')).toBe(true)
  })

  it('never links via a secret (masked) env value — honest, no fabricated edge', () => {
    const secretLinked = app({ env: [{ key: 'VECTOR_URL', value: '', secret: true }] })
    const model = buildProjectCanvas({ apps: [secretLinked], resources: [res({})] })
    expect(model.nodes.some((n) => n.kind === 'vector')).toBe(false)
    expect(model.edges.length).toBe(0)
  })

  it('computes project + env switch options over ALL apps, filters nodes by scope', () => {
    const apps = [
      app({ id: 'a', projectSlug: 'acme', environment: 'production' }),
      app({ id: 'b', projectSlug: 'acme', environment: 'preview' }),
      app({ id: 'c', projectSlug: 'other', environment: 'production' }),
    ]
    const all = buildProjectCanvas({ apps, resources: [] })
    expect(all.projects.map((p) => p.id).sort()).toEqual(['acme', 'other'])
    expect(all.envs.map((e) => e.id).sort()).toEqual(['preview', 'production'])
    const scoped = buildProjectCanvas({ apps, resources: [] }, { project: 'acme', env: 'production' })
    expect(scoped.nodes.filter((n) => n.kind === 'app')).toHaveLength(1)
  })
})

describe('buildProjectCanvas — live o11y signals (extras)', () => {
  const metric: ServiceMetric = { label: 'req', points: [1, 2, 3], value: '1.2K' }

  it('sets the app node card metric from metricByApp, keyed by app id', () => {
    const a = app({ id: 'a1' })
    const model = buildProjectCanvas({ apps: [a], resources: [] }, {}, { metricByApp: new Map([['a1', metric]]) })
    expect(model.nodes.find((n) => n.id === 'app:a1')?.metric).toEqual(metric)
  })

  it('leaves the metric undefined (honest empty) when no telemetry is provided for the app', () => {
    const model = buildProjectCanvas({ apps: [app({ id: 'a1' })], resources: [] }, {}, { metricByApp: new Map() })
    expect(model.nodes.find((n) => n.id === 'app:a1')?.metric).toBeUndefined()
  })

  it('draws an OBSERVED dependency edge between two app nodes matched by service name', () => {
    const apps = [app({ id: 'a', slug: 'api', name: 'API' }), app({ id: 'b', slug: 'vector', name: 'Vector' })]
    const deps: ServiceDepEdge[] = [{ parent: 'api', child: 'vector', callCount: 10 }]
    const model = buildProjectCanvas({ apps, resources: [] }, {}, { serviceDeps: deps })
    const dep = model.edges.find((e) => e.reason === 'dependency')
    expect(dep).toMatchObject({ source: 'app:a', target: 'app:b', reason: 'dependency' })
  })

  it('never draws a dependency edge to a service outside the canvas (honest scoping)', () => {
    const apps = [app({ id: 'a', slug: 'api' })]
    const deps: ServiceDepEdge[] = [{ parent: 'api', child: 'some-other-org-service' }]
    const model = buildProjectCanvas({ apps, resources: [] }, {}, { serviceDeps: deps })
    expect(model.edges.some((e) => e.reason === 'dependency')).toBe(false)
  })

  it('an observed dependency supersedes the env-derived reference edge for the same pair', () => {
    // api references vector via an env value AND o11y observed api→vector calls.
    const apps = [
      app({ id: 'a', slug: 'api', name: 'API', env: [{ key: 'V', value: 'vector', secret: false }] }),
      app({ id: 'b', slug: 'vector', name: 'Vector' }),
    ]
    const deps: ServiceDepEdge[] = [{ parent: 'api', child: 'vector' }]
    const model = buildProjectCanvas({ apps, resources: [] }, {}, { serviceDeps: deps })
    const appApp = model.edges.filter((e) => e.source === 'app:a' && e.target === 'app:b')
    expect(appApp).toHaveLength(1)
    expect(appApp[0].reason).toBe('dependency')
  })

  it('keeps env-derived reference edges when no observed dependency covers them', () => {
    const apps = [
      app({ id: 'a', slug: 'api', name: 'API', env: [{ key: 'V', value: 'vector', secret: false }] }),
      app({ id: 'b', slug: 'vector', name: 'Vector' }),
    ]
    const model = buildProjectCanvas({ apps, resources: [] }, {}, { serviceDeps: [] })
    expect(model.edges.some((e) => e.source === 'app:a' && e.target === 'app:b' && e.reason === 'reference')).toBe(true)
  })
})

describe('summarizeCanvas', () => {
  it('counts services (not domains) by status', () => {
    const { nodes } = buildProjectCanvas({ apps: [app({ status: 'live', domains: ['x.dev'] }), app({ id: 'b', status: 'error' })], resources: [] })
    const s = summarizeCanvas(nodes)
    expect(s.services).toBe(2)
    expect(s.active).toBe(1)
    expect(s.crashed).toBe(1)
  })
})
