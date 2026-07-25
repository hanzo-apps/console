import { describe, expect, it } from 'vitest'

import type { Application, AppTree, ResourceNode } from '~/lib/api/gitops'
import { FIXTURE_APPS, FIXTURE_TREE } from './fixtures'
import {
  compareSemverDesc,
  fleetNodeId,
  foldFleet,
  foldHealth,
  foldSync,
  gridPositions,
  healthColor,
  healthPulses,
  healthToServiceStatus,
  isReleaseTag,
  kindToServiceKind,
  releaseTargets,
  repoBaseName,
  resolveApp,
  resourceHealth,
  rollbackTargets,
  summarize,
  syncColor,
  treeHealth,
  treeToGraph,
} from './logic'

function app(over: Partial<Application> = {}): Application {
  return {
    name: 'cloud',
    namespace: 'hanzo',
    image: { repository: 'ghcr.io/hanzoai/cloud', tag: 'v1.800.1' },
    phase: 'Running',
    health: 'Unknown',
    sync: 'Unknown',
    replicas: 2,
    readyReplicas: 2,
    liveTag: 'v1.800.1',
    org: 'hanzo',
    message: '',
    revisions: [],
    updatedAt: 0,
    ...over,
  }
}

function node(over: Partial<ResourceNode> = {}): ResourceNode {
  return {
    ref: 'u1',
    group: '',
    version: 'v1',
    kind: 'Pod',
    name: 'pod-1',
    namespace: 'hanzo',
    health: 'Unknown',
    sync: 'Unknown',
    phase: 'Running',
    replicas: 0,
    readyReplicas: 0,
    images: [],
    ownerRefs: [],
    createdAt: 0,
    ...over,
  }
}

describe('foldHealth', () => {
  it('trusts a real server health over the derivation', () => {
    expect(foldHealth({ health: 'Degraded', phase: 'Running', replicas: 2, readyReplicas: 2 })).toBe('Degraded')
  })
  it('ignores a server Unknown and derives from phase + replicas', () => {
    expect(foldHealth({ health: 'Unknown', phase: 'Running', replicas: 2, readyReplicas: 2 })).toBe('Healthy')
  })
  it('Running fully-ready → Healthy', () => {
    expect(foldHealth({ phase: 'Running', replicas: 3, readyReplicas: 3 })).toBe('Healthy')
  })
  it('Running partially-ready → Progressing', () => {
    expect(foldHealth({ phase: 'Running', replicas: 3, readyReplicas: 1 })).toBe('Progressing')
  })
  it('Running with zero ready but replicas desired → Degraded', () => {
    expect(foldHealth({ phase: 'Running', replicas: 2, readyReplicas: 0 })).toBe('Degraded')
  })
  it('explicit Degraded phase → Degraded', () => {
    expect(foldHealth({ phase: 'Degraded', replicas: 2, readyReplicas: 2 })).toBe('Degraded')
  })
  it('Pending / Creating / Deleting → Progressing', () => {
    expect(foldHealth({ phase: 'Pending' })).toBe('Progressing')
    expect(foldHealth({ phase: 'Creating' })).toBe('Progressing')
    expect(foldHealth({ phase: 'Deleting' })).toBe('Progressing')
  })
  it('suspended → Suspended', () => {
    expect(foldHealth({ phase: 'Suspended' })).toBe('Suspended')
  })
  it('empty phase with no replicas → Unknown (never guessed up)', () => {
    expect(foldHealth({ phase: '', replicas: 0, readyReplicas: 0 })).toBe('Unknown')
  })
  it('no phase but replica data → inferred', () => {
    expect(foldHealth({ replicas: 2, readyReplicas: 2 })).toBe('Healthy')
    expect(foldHealth({ replicas: 2, readyReplicas: 0 })).toBe('Degraded')
    expect(foldHealth({ replicas: 2, readyReplicas: 1 })).toBe('Progressing')
  })
})

describe('foldSync', () => {
  it('trusts a real server sync over the derivation', () => {
    expect(foldSync({ sync: 'OutOfSync', desiredTag: 'v1', liveTag: 'v1' })).toBe('OutOfSync')
  })
  it('equal desired/live → Synced', () => {
    expect(foldSync({ desiredTag: 'v1.800.1', liveTag: 'v1.800.1' })).toBe('Synced')
  })
  it('different tags, settled → OutOfSync', () => {
    expect(foldSync({ desiredTag: 'v1.800.2', liveTag: 'v1.800.1', health: 'Healthy' })).toBe('OutOfSync')
  })
  it('different tags while reconciling → Syncing', () => {
    expect(foldSync({ desiredTag: 'v1.800.2', liveTag: 'v1.800.1', health: 'Progressing' })).toBe('Syncing')
  })
  it('missing live tag → Unknown', () => {
    expect(foldSync({ desiredTag: 'v1', liveTag: '' })).toBe('Unknown')
  })
})

describe('resolveApp', () => {
  it('folds health and sync together (a partial rollout to a new tag reads Progressing + Syncing)', () => {
    const a = app({ health: 'Unknown', sync: 'Unknown', phase: 'Running', replicas: 3, readyReplicas: 1, image: { repository: 'r', tag: 'v2' }, liveTag: 'v1' })
    expect(resolveApp(a)).toEqual({ health: 'Progressing', sync: 'Syncing' })
  })
  it('a healthy in-sync app resolves Healthy + Synced', () => {
    expect(resolveApp(app())).toEqual({ health: 'Healthy', sync: 'Synced' })
  })
})

describe('summarize', () => {
  it('counts health + sync across the fleet from the folds', () => {
    const s = summarize([
      app({ name: 'a' }), // Healthy + Synced
      app({ name: 'b', phase: 'Running', replicas: 2, readyReplicas: 1 }), // Progressing, tag matches → Synced
      app({ name: 'c', phase: 'Degraded' }), // Degraded, tag matches → Synced
      app({ name: 'd', image: { repository: 'r', tag: 'v2' }, liveTag: 'v1', phase: 'Running' }), // Healthy but OutOfSync
    ])
    expect(s.total).toBe(4)
    expect(s.healthy).toBe(2)
    expect(s.progressing).toBe(1)
    expect(s.degraded).toBe(1)
    // a, b, c all keep the default matching tag → Synced; only d drifted.
    expect(s.synced).toBe(3)
    expect(s.outOfSync).toBe(1)
  })
})

describe('kindToServiceKind', () => {
  it('maps the operator/workload kinds to app', () => {
    expect(kindToServiceKind('Service')).toBe('app')
    expect(kindToServiceKind('Deployment')).toBe('app')
    expect(kindToServiceKind('StatefulSet')).toBe('app')
  })
  it('maps pods/replicasets to worker, ingress to domain, PVC to database', () => {
    expect(kindToServiceKind('Pod')).toBe('worker')
    expect(kindToServiceKind('ReplicaSet')).toBe('worker')
    expect(kindToServiceKind('Ingress')).toBe('domain')
    expect(kindToServiceKind('PersistentVolumeClaim')).toBe('database')
    expect(kindToServiceKind('ConfigMap')).toBe('storage')
    expect(kindToServiceKind('Anything')).toBe('service')
  })
})

describe('healthToServiceStatus', () => {
  it('maps every health onto the canvas vocabulary', () => {
    expect(healthToServiceStatus('Healthy')).toBe('active')
    expect(healthToServiceStatus('Progressing')).toBe('deploying')
    expect(healthToServiceStatus('Degraded')).toBe('crashed')
    expect(healthToServiceStatus('Suspended')).toBe('sleeping')
    expect(healthToServiceStatus('Missing')).toBe('removed')
    expect(healthToServiceStatus('Unknown')).toBe('unknown')
  })
})

describe('treeToGraph', () => {
  const tree: AppTree = {
    nodes: [
      node({ ref: 'cr', kind: 'Service', name: 'cloud', ownerRefs: [] }),
      node({ ref: 'dep', kind: 'Deployment', name: 'cloud', ownerRefs: ['cr'], replicas: 2, readyReplicas: 2 }),
      node({ ref: 'rs', kind: 'ReplicaSet', name: 'cloud-abc', ownerRefs: ['dep'] }),
      node({ ref: 'p1', kind: 'Pod', name: 'cloud-abc-1', ownerRefs: ['rs'], phase: 'Running' }),
      node({ ref: 'p2', kind: 'Pod', name: 'cloud-abc-2', ownerRefs: ['rs'], phase: 'Running' }),
    ],
    edges: [],
  }

  it('maps nodes and derives owner→child edges from ownerRefs', () => {
    const { nodes, edges } = treeToGraph(tree)
    expect(nodes).toHaveLength(5)
    expect(edges.map((e) => e.id).sort()).toEqual(['cr->dep', 'dep->rs', 'rs->p1', 'rs->p2'])
    expect(edges.every((e) => e.reason === 'dependency')).toBe(true)
  })
  it('never draws an edge to a resource outside the tree', () => {
    const orphan: AppTree = { nodes: [node({ ref: 'p1', ownerRefs: ['missing-rs'] })], edges: [] }
    expect(treeToGraph(orphan).edges).toHaveLength(0)
  })
  it('de-duplicates edges from ownerRefs and explicit edges', () => {
    const dup: AppTree = {
      nodes: [node({ ref: 'a', kind: 'Service' }), node({ ref: 'b', ownerRefs: ['a'] })],
      edges: [{ from: 'a', to: 'b' }],
    }
    expect(treeToGraph(dup).edges).toHaveLength(1)
  })
  it('carries the exact k8s kind as the node type label (icon key)', () => {
    const n = treeToGraph(tree).nodes.find((x) => x.id === 'dep')!
    expect(n.typeLabel).toBe('Deployment')
    expect(n.status).toBe('active') // 2/2 ready
  })
})

describe('treeHealth', () => {
  it('tallies resource health across the tree', () => {
    const t: AppTree = {
      nodes: [
        node({ ref: 'a', phase: 'Running', replicas: 2, readyReplicas: 2 }), // Healthy
        node({ ref: 'b', phase: 'Running', replicas: 2, readyReplicas: 0 }), // Degraded
        node({ ref: 'c', phase: 'Pending' }), // Progressing
      ],
      edges: [],
    }
    const tally = treeHealth(t)
    expect(tally.Healthy).toBe(1)
    expect(tally.Degraded).toBe(1)
    expect(tally.Progressing).toBe(1)
  })
})

describe('resourceHealth', () => {
  it('folds a single resource node', () => {
    expect(resourceHealth(node({ phase: 'Running', replicas: 1, readyReplicas: 1 }))).toBe('Healthy')
  })
})

describe('rollbackTargets', () => {
  it('excludes the current tag and de-duplicates, newest first', () => {
    const a = app({ image: { repository: 'r', tag: 'v3' }, revisions: ['v2', 'v1', 'v2', 'v3'] })
    expect(rollbackTargets(a)).toEqual(['v2', 'v1'])
  })
  it('empty when no prior revisions exist', () => {
    expect(rollbackTargets(app({ revisions: [] }))).toEqual([])
  })
})

describe('palette', () => {
  it('draws every verdict from the greyscale ramp — weight, never hue', () => {
    for (const h of ['Healthy', 'Progressing', 'Degraded', 'Suspended', 'Missing', 'Unknown'] as const)
      expect(healthColor(h)).toMatch(/^var\(--color(9|10|11|12)\)$/)
    for (const s of ['Synced', 'Syncing', 'OutOfSync', 'Unknown'] as const)
      expect(syncColor(s)).toMatch(/^var\(--color(9|10|11|12)\)$/)
  })
  it('emphasises a degraded app over a healthy one, and de-emphasises the unknown', () => {
    expect(healthColor('Degraded')).toBe('var(--color12)')
    expect(healthColor('Healthy')).toBe('var(--color11)')
    expect(healthColor('Unknown')).toBe('var(--color9)')
    expect(syncColor('OutOfSync')).not.toBe(syncColor('Unknown'))
  })
  it('only a progressing app pulses', () => {
    expect(healthPulses('Progressing')).toBe(true)
    expect(healthPulses('Healthy')).toBe(false)
  })
})

describe('repoBaseName', () => {
  it('takes the image-repository basename, lowercased, tag-stripped', () => {
    expect(repoBaseName('ghcr.io/hanzoai/iam')).toBe('iam')
    expect(repoBaseName('ghcr.io/hanzoai/IAM:v1.2.3')).toBe('iam')
    expect(repoBaseName('cloud')).toBe('cloud')
    expect(repoBaseName('')).toBe('')
  })
})

describe('release targets (rollback offers only clean-semver git tags)', () => {
  it('isReleaseTag accepts vX.Y.Z (+suffix), rejects everything else', () => {
    expect(isReleaseTag('v1.800.1')).toBe(true)
    expect(isReleaseTag('v2.16.4-rc1')).toBe(true)
    expect(isReleaseTag('latest')).toBe(false)
    expect(isReleaseTag('main')).toBe(false)
    expect(isReleaseTag('v1.2')).toBe(false)
    expect(isReleaseTag('1.2.3')).toBe(false)
  })
  it('releaseTargets drops the current tag + non-semver, newest first', () => {
    expect(
      releaseTargets('v1.800.1', ['v1.800.0', 'latest', 'v1.799.15', 'v1.800.1', 'main', 'v1.800.0']),
    ).toEqual(['v1.800.0', 'v1.799.15'])
  })
  it('compareSemverDesc orders by numeric semver descending', () => {
    expect(['v1.2.0', 'v1.10.0', 'v1.2.3'].sort(compareSemverDesc)).toEqual(['v1.10.0', 'v1.2.3', 'v1.2.0'])
  })
})

describe('foldFleet (Application[] → canvas nodes, no invented edges)', () => {
  const iam = app({ name: 'iam', env: 'main', image: { repository: 'ghcr.io/hanzoai/iam', tag: 'v1.4.11' }, liveTag: 'v1.4.10', phase: 'Running', replicas: 2, readyReplicas: 1, health: 'Unknown' })
  const cloud = app({ name: 'cloud', env: 'main', image: { repository: 'ghcr.io/hanzoai/cloud', tag: 'v1.800.1' } })

  it('produces one node per app, sorted by (env,name), status from the CD health fold', () => {
    const nodes = foldFleet([iam, cloud])
    expect(nodes.map((n) => n.name)).toEqual(['cloud', 'iam']) // sorted
    const n = nodes.find((x) => x.name === 'iam')!
    expect(n.id).toBe(fleetNodeId(iam))
    expect(n.status).toBe('deploying') // 1/2 ready → Progressing → deploying tone
    expect(n.region).toBe('main')
    expect(n.kind).toBe('app')
    expect(n.capability).toBeTruthy()
  })
  it('source is the declared image ref when no git enrichment is present', () => {
    const n = foldFleet([cloud])[0]
    expect(n.source).toEqual({ kind: 'image', ref: 'ghcr.io/hanzoai/cloud:v1.800.1' })
  })
  it('source becomes the real git repo+branch when enriched by repo basename', () => {
    const gitByRepo = new Map([['cloud', { ref: 'hanzoai/cloud', branch: 'main', head: 'abc1234' }]])
    const n = foldFleet([cloud], { gitByRepo })[0]
    expect(n.source).toEqual({ kind: 'repo', ref: 'hanzoai/cloud', branch: 'main' })
  })
  it('deployedAt degrades from the CR change time to the latest build start', () => {
    const noTime = app({ name: 'gw', image: { repository: 'ghcr.io/hanzoai/gateway', tag: 'v2' }, updatedAt: 0 })
    const buildByRepo = new Map([['gateway', { status: 'success', startedAt: 1_700_000_000_000 }]])
    expect(foldFleet([noTime], { buildByRepo })[0].deployedAt).toBe(1_700_000_000_000)
  })
})

describe('gridPositions (edge-free fleet → a deterministic squarish board)', () => {
  it('lays ids into a grid with ceil(sqrt(n)) columns', () => {
    const pos = gridPositions(['a', 'b', 'c', 'd'], { colGap: 320, rowGap: 152 })
    // 4 ids → 2 columns → 2 rows
    expect(pos.a).toEqual({ x: 0, y: 0 })
    expect(pos.b).toEqual({ x: 320, y: 0 })
    expect(pos.c).toEqual({ x: 0, y: 152 })
    expect(pos.d).toEqual({ x: 320, y: 152 })
  })
  it('is byte-identical for the same ids (stable board)', () => {
    expect(gridPositions(['x', 'y', 'z'])).toEqual(gridPositions(['x', 'y', 'z']))
  })
})

// The typed contract fixture (the shape cloud's /v1/deploy serves) folds cleanly.
describe('contract fixture', () => {
  it('summarizes the sample applications (iam is mid-rollout)', () => {
    const s = summarize(FIXTURE_APPS)
    expect(s.total).toBe(4)
    // iam is 1/2 ready → Progressing + its live tag lags the desired → OutOfSync.
    const iam = FIXTURE_APPS.find((a) => a.name === 'iam')!
    expect(resolveApp(iam)).toEqual({ health: 'Progressing', sync: 'Syncing' })
    expect(s.progressing).toBe(1)
    expect(s.healthy).toBe(3)
  })
  it('folds the sample tree into a connected owner→child graph', () => {
    const { nodes, edges } = treeToGraph(FIXTURE_TREE)
    expect(nodes.length).toBe(FIXTURE_TREE.nodes.length)
    // Every owned resource (all but the root CR) has an incoming owner edge.
    const withOwner = new Set(edges.map((e) => e.target))
    for (const n of FIXTURE_TREE.nodes) if (n.ownerRefs.length) expect(withOwner.has(n.ref)).toBe(true)
  })
})
