import { describe, it, expect } from 'vitest'

import type { Cluster } from '~/lib/api'
import { ApiError } from '~/lib/api'
import type { VisorMachine } from '~/lib/api/visor'
import {
  clusterKind,
  isByoCluster,
  clusterGpuTotal,
  clusterNodeTotal,
  isClusterOnline,
  byoBoxes,
  summarizeFleet,
  describeAttachError,
  CONNECT_SNIPPET,
} from './logic'

/** A managed (Visor-provisioned) cluster projected from node pools. */
const managed = (over: Partial<Cluster> = {}): Cluster => ({
  name: 'do-sfo3-hanzo',
  status: 'running',
  nodePools: [{ size: 's-4vcpu-8gb', count: 3 }],
  nodeCount: 3,
  ...over,
})

/** An attached BYO cluster as `byoToClusterView` emits it (kind byo, status attached). */
const byo = (over: Partial<Cluster> = {}): Cluster => ({
  name: 'lab-rig',
  region: 'byo',
  status: 'attached',
  kind: 'byo',
  nodeCount: 2,
  nvidiaGpu: 8,
  amdGpu: 0,
  nodePools: [],
  ...over,
})

/** A machine row (`GET /v1/visor/machines`). BYO boxes carry provider "byo". */
const machine = (over: Partial<VisorMachine> = {}): VisorMachine => ({ id: 'm1', ...over })

describe('clusterKind / isByoCluster', () => {
  it('reports byo only when the cluster declares kind="byo" (case-insensitive)', () => {
    expect(clusterKind(byo())).toBe('byo')
    expect(clusterKind(byo({ kind: 'BYO' }))).toBe('byo')
    expect(isByoCluster(byo())).toBe(true)
  })
  it('treats a missing/other kind as managed (a pools-derived cluster has no kind)', () => {
    expect(clusterKind(managed())).toBe('managed')
    expect(clusterKind(managed({ kind: undefined }))).toBe('managed')
    expect(isByoCluster(managed())).toBe(false)
  })
})

describe('clusterGpuTotal', () => {
  it('sums nvidia + amd, honest 0 when a managed cluster reports none', () => {
    expect(clusterGpuTotal(byo({ nvidiaGpu: 8, amdGpu: 4 }))).toBe(12)
    expect(clusterGpuTotal(byo({ nvidiaGpu: 8 }))).toBe(8)
    expect(clusterGpuTotal(managed())).toBe(0)
  })
})

describe('clusterNodeTotal', () => {
  it('sums node-pool counts for a managed cluster', () => {
    expect(
      clusterNodeTotal(managed({ nodePools: [{ count: 3 }, { count: 2 }], nodeCount: undefined })),
    ).toBe(5)
  })
  it('uses nodeCount for a BYO cluster (no pools)', () => {
    expect(clusterNodeTotal(byo({ nodeCount: 2 }))).toBe(2)
  })
  it('is 0 when neither pools nor nodeCount are known (never guessed)', () => {
    expect(clusterNodeTotal({ name: 'x', status: 'pending' })).toBe(0)
  })
})

describe('isClusterOnline', () => {
  it('counts running AND attached (BYO) clusters as online', () => {
    expect(isClusterOnline(managed({ status: 'running' }))).toBe(true)
    expect(isClusterOnline(byo({ status: 'attached' }))).toBe(true)
    expect(isClusterOnline(managed({ phase: 'ready', status: 'provisioning' }))).toBe(true)
  })
  it('is false for a provisioning / errored cluster', () => {
    expect(isClusterOnline(managed({ status: 'provisioning', phase: undefined }))).toBe(false)
    expect(isClusterOnline(managed({ status: 'error', phase: undefined }))).toBe(false)
  })
})

describe('byoBoxes', () => {
  it('keeps only provider="byo" machines (dialed-in boxes), dropping Visor ones', () => {
    const rows = [machine({ id: 'a', provider: 'byo' }), machine({ id: 'b', provider: 'digitalocean' }), machine({ id: 'c' })]
    expect(byoBoxes(rows).map((m) => m.id)).toEqual(['a'])
  })
})

describe('summarizeFleet', () => {
  it('aggregates managed + BYO clusters and BYO boxes into one honest summary', () => {
    const clusters = [managed(), byo({ nvidiaGpu: 8, amdGpu: 2, nodeCount: 2 })]
    const machines = [machine({ id: 'a', provider: 'byo' }), machine({ id: 'b', provider: 'byo' }), machine({ id: 'c', provider: 'digitalocean' })]
    const s = summarizeFleet(clusters, machines)
    expect(s.clusters).toBe(2)
    expect(s.byoClusters).toBe(1)
    expect(s.managedClusters).toBe(1)
    expect(s.online).toBe(2) // running + attached
    expect(s.nodes).toBe(5) // 3 managed pool nodes + 2 BYO nodes
    expect(s.nvidia).toBe(8)
    expect(s.amd).toBe(2)
    expect(s.gpus).toBe(10)
    expect(s.boxes).toBe(2)
  })
  it('is all-zero for an empty fleet (never fabricates rows)', () => {
    const s = summarizeFleet([], [])
    expect(s).toMatchObject({ clusters: 0, byoClusters: 0, online: 0, nodes: 0, gpus: 0, boxes: 0 })
  })
})

describe('describeAttachError', () => {
  it('maps 503 → not-configured (KMS required)', () => {
    const d = describeAttachError(new ApiError('BYO cluster attach not configured on this deployment (KMS required)', 503))
    expect(d.kind).toBe('not-configured')
    expect(d.detail).toContain('KMS')
  })
  it('maps 422 → unreachable, carrying the backend message', () => {
    const d = describeAttachError(new ApiError('cluster unreachable with this kubeconfig: timeout', 422))
    expect(d.kind).toBe('unreachable')
    expect(d.detail).toContain('unreachable')
  })
  it('maps 400 → invalid and 402 → billing', () => {
    expect(describeAttachError(new ApiError("'name' is required", 400)).kind).toBe('invalid')
    expect(describeAttachError(new ApiError('Insufficient balance', 402)).kind).toBe('billing')
  })
  it('falls back to a generic honest error for a non-ApiError / unknown status', () => {
    expect(describeAttachError(new Error('boom')).kind).toBe('error')
    expect(describeAttachError('nope').detail).toBeTruthy()
  })
})

describe('CONNECT_SNIPPET', () => {
  it('is the real hanzo gpu connect CLI verb (no fabricated flags)', () => {
    expect(CONNECT_SNIPPET).toBe('hanzo gpu connect')
  })
})
