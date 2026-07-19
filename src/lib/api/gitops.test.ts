/**
 * GitopsApi — the /v1/deploy DTO → console view-model mapping (the path fix + the
 * field remap). These pin the console against cloud's REAL `clients/deploy` shapes
 * (repository/version/runningVersion/healthMessage/parentRefs/liveManifest-object/
 * logs-blob), which the prior `/v1/gitops` normalizers did NOT read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const restGet = vi.fn()
const restPost = vi.fn()
vi.mock('./client', () => ({
  restGet: (...a: unknown[]) => restGet(...a),
  restPost: (...a: unknown[]) => restPost(...a),
  // identity so a test can assert the exact `/v1/deploy/*` path the client builds.
  cloudProxyV1Url: (p: string) => p,
}))

import { GitopsApi } from './gitops'

beforeEach(() => {
  restGet.mockReset()
  restPost.mockReset()
})

describe('applications() maps the /v1/deploy Application DTO', () => {
  it('hits deploy/applications and remaps repository/version/runningVersion/healthMessage/env', async () => {
    restGet.mockResolvedValueOnce({
      applications: [
        {
          name: 'iam',
          namespace: 'hanzo',
          env: 'main',
          role: 'api',
          repository: 'ghcr.io/hanzoai/iam',
          version: 'v1.4.11',
          runningVersion: 'v1.4.10',
          health: 'progressing',
          healthMessage: 'rolling update in progress',
          sync: 'out-of-sync',
          phase: 'Running',
          endpoints: ['https://iam.hanzo.ai'],
        },
      ],
      summary: { total: 1 },
    })
    const apps = await GitopsApi.applications()
    expect(restGet).toHaveBeenCalledWith('deploy/applications') // the #1 path fix
    expect(apps).toHaveLength(1)
    const a = apps[0]
    expect(a.image).toEqual({ repository: 'ghcr.io/hanzoai/iam', tag: 'v1.4.11' })
    expect(a.liveTag).toBe('v1.4.10') // runningVersion → liveTag (was unmapped)
    expect(a.health).toBe('Progressing') // lowercase wire → capitalized vocab
    expect(a.sync).toBe('OutOfSync') // 'out-of-sync' → OutOfSync
    expect(a.message).toBe('rolling update in progress') // healthMessage → message
    expect(a.env).toBe('main')
    expect(a.role).toBe('api')
    expect(a.endpoints).toEqual(['https://iam.hanzo.ai'])
  })

  it('tolerates a bare array and drops nameless rows', async () => {
    restGet.mockResolvedValueOnce([{ name: 'cloud', repository: 'ghcr.io/hanzoai/cloud', version: 'v1.800.1' }, { name: '' }])
    const apps = await GitopsApi.applications()
    expect(apps.map((a) => a.name)).toEqual(['cloud'])
  })
})

describe('tree() derives owner edges from parentRefs', () => {
  it('reads parentRefs[].ref into ownerRefs (the tree edge source)', async () => {
    restGet.mockResolvedValueOnce({
      application: { name: 'iam' },
      nodes: [
        { group: 'hanzo.ai', version: 'v1', kind: 'App', namespace: 'hanzo', name: 'iam', ref: 'hanzo.ai:App:hanzo:iam', uid: 'u1', health: 'healthy', parentRefs: [] },
        {
          group: 'apps',
          version: 'v1',
          kind: 'Deployment',
          namespace: 'hanzo',
          name: 'iam',
          ref: 'apps:Deployment:hanzo:iam',
          uid: 'u2',
          health: 'healthy',
          parentRefs: [{ group: 'hanzo.ai', version: 'v1', kind: 'App', namespace: 'hanzo', name: 'iam', ref: 'hanzo.ai:App:hanzo:iam' }],
        },
      ],
    })
    const tree = await GitopsApi.tree('iam')
    expect(restGet).toHaveBeenCalledWith('deploy/iam/tree')
    expect(tree.nodes).toHaveLength(2)
    const dep = tree.nodes.find((n) => n.kind === 'Deployment')!
    expect(dep.ref).toBe('apps:Deployment:hanzo:iam')
    expect(dep.ownerRefs).toEqual(['hanzo.ai:App:hanzo:iam']) // from parentRefs, not the missing ownerRefs
  })
})

describe('resource() maps object manifests + the nested diff verdict', () => {
  it('stringifies liveManifest/desiredManifest and reads modified + desiredSource', async () => {
    restGet.mockResolvedValueOnce({
      ref: { group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'hanzo', name: 'iam', ref: 'apps:Deployment:hanzo:iam' },
      health: 'healthy',
      healthMessage: '',
      liveManifest: { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'iam' }, spec: { replicas: 1 } },
      desiredSource: 'last-applied',
      diff: { modified: true, desiredManifest: { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'iam' }, spec: { replicas: 2 } } },
    })
    const d = await GitopsApi.resource('iam', 'apps:Deployment:hanzo:iam')
    expect(restGet).toHaveBeenCalledWith('deploy/iam/resource/apps%3ADeployment%3Ahanzo%3Aiam')
    expect(d.ref).toBe('apps:Deployment:hanzo:iam') // extracted from the ResourceRef object
    expect(d.live).toContain('"kind": "Deployment"') // object → pretty JSON
    expect(d.live).toContain('"replicas": 1')
    expect(d.desired).toContain('"replicas": 2') // from diff.desiredManifest
    expect(d.modified).toBe(true)
    expect(d.desiredSource).toBe('last-applied')
    expect(d.events).toEqual([])
  })

  it('reports in-sync when the plane says not modified', async () => {
    restGet.mockResolvedValueOnce({ ref: 'x:Pod:hanzo:p1', liveManifest: { kind: 'Pod' }, desiredSource: 'none', diff: { modified: false } })
    const d = await GitopsApi.resource('iam', 'x:Pod:hanzo:p1')
    expect(d.modified).toBe(false)
    expect(d.ref).toBe('x:Pod:hanzo:p1') // a plain-string ref still works
  })
})

describe('logs() splits the /v1/deploy logs blob', () => {
  it('reads the `logs` string field and tags each line with the pod', async () => {
    restGet.mockResolvedValueOnce({ application: 'hanzo/iam', pod: 'iam-6d8f-abc', container: '', logs: 'first line\nsecond line\n' })
    const lines = await GitopsApi.logs('iam', { tail: 300 })
    expect(restGet).toHaveBeenCalledWith('deploy/iam/logs?tail=300')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ message: 'first line', pod: 'iam-6d8f-abc' })
    expect(lines[1].message).toBe('second line')
  })

  it('honest empty when the pod is not scheduled (no logs)', async () => {
    restGet.mockResolvedValueOnce({ application: 'hanzo/iam', pod: '', logs: '', note: 'no running pod logs available yet' })
    expect(await GitopsApi.logs('iam')).toEqual([])
  })
})

describe('rollback() + sync() map the action responses to deploy/*', () => {
  it('rollback posts { tag } to deploy/:name/rollback', async () => {
    restPost.mockResolvedValueOnce({ rolledBack: true, target: 'hanzo/iam', tag: 'v1.4.10', application: {} })
    const r = await GitopsApi.rollback('iam', 'v1.4.10')
    expect(restPost).toHaveBeenCalledWith('deploy/iam/rollback', { tag: 'v1.4.10' })
    expect(r).toMatchObject({ name: 'iam', tag: 'v1.4.10' })
  })
  it('sync posts to deploy/:name/sync', async () => {
    restPost.mockResolvedValueOnce({ synced: true, target: 'hanzo/iam', requestedAt: '2026-07-19T00:00:00Z' })
    const r = await GitopsApi.sync('iam')
    expect(restPost).toHaveBeenCalledWith('deploy/iam/sync', {})
    expect(r.name).toBe('iam')
  })
})
