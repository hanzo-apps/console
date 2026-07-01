import { describe, it, expect } from 'vitest'

import { cpuMemOf, clusterCapacity, fleetCapacity, isClusterRunning, fmtVcpu, fmtRam } from './nodes'
import type { Cluster } from './platform'

describe('cpuMemOf — DO size slug → provisioned vCPU/RAM', () => {
  it('parses the standard `<class>-<n>vcpu-<n>gb` shape', () => {
    expect(cpuMemOf('s-4vcpu-8gb')).toEqual({ vcpu: 4, ramGb: 8 })
    expect(cpuMemOf('s-8vcpu-16gb')).toEqual({ vcpu: 8, ramGb: 16 })
    expect(cpuMemOf('g-2vcpu-8gb')).toEqual({ vcpu: 2, ramGb: 8 })
  })

  it('parses the compact CPU-optimized `c-<n>-<n>gb` shape', () => {
    expect(cpuMemOf('c-2-4gb')).toEqual({ vcpu: 2, ramGb: 4 })
    expect(cpuMemOf('c-4-8gb')).toEqual({ vcpu: 4, ramGb: 8 })
  })

  it('returns null for a GPU droplet slug (slug encodes GPU mem, not system RAM)', () => {
    expect(cpuMemOf('gpu-h100x8-640gb')).toBeNull()
    expect(cpuMemOf('gpu-l40sx1-48gb')).toBeNull()
  })

  it('returns null for empty / unparseable slugs', () => {
    expect(cpuMemOf('')).toBeNull()
    expect(cpuMemOf(null)).toBeNull()
    expect(cpuMemOf('mystery-box')).toBeNull()
  })
})

const cluster = (over: Partial<Cluster>): Cluster => ({ name: 'c', status: 'running', ...over })

describe('clusterCapacity — real provisioned capacity from node pools', () => {
  it('sums vCPU/RAM across parseable pools, counting all nodes', () => {
    const c = cluster({
      nodePools: [
        { size: 's-4vcpu-8gb', count: 3 },
        { size: 's-2vcpu-4gb', count: 2 },
      ],
    })
    expect(clusterCapacity(c)).toEqual({ nodes: 5, vcpu: 4 * 3 + 2 * 2, ramGb: 8 * 3 + 4 * 2, allKnown: true })
  })

  it('counts nodes of an unparseable pool but leaves vCPU/RAM partial (allKnown=false)', () => {
    const c = cluster({
      nodePools: [
        { size: 's-4vcpu-8gb', count: 2 },
        { size: 'gpu-h100x8-640gb', count: 1 },
      ],
    })
    expect(clusterCapacity(c)).toEqual({ nodes: 3, vcpu: 8, ramGb: 16, allKnown: false })
  })

  it('falls back to the legacy single nodeSize/nodeCount', () => {
    expect(clusterCapacity(cluster({ nodeSize: 's-2vcpu-2gb', nodeCount: 4 }))).toEqual({
      nodes: 4,
      vcpu: 8,
      ramGb: 8,
      allKnown: true,
    })
  })

  it('is honest-zero when no pool info is exposed', () => {
    expect(clusterCapacity(cluster({}))).toEqual({ nodes: 0, vcpu: 0, ramGb: 0, allKnown: false })
  })
})

describe('fleetCapacity', () => {
  it('sums capacity across clusters and ANDs allKnown', () => {
    const a = cluster({ nodePools: [{ size: 's-4vcpu-8gb', count: 1 }] })
    const b = cluster({ nodePools: [{ size: 'gpu-h100x8-640gb', count: 1 }] })
    expect(fleetCapacity([a, b])).toEqual({ nodes: 2, vcpu: 4, ramGb: 8, allKnown: false })
    expect(fleetCapacity([a, a])).toEqual({ nodes: 2, vcpu: 8, ramGb: 16, allKnown: true })
    expect(fleetCapacity([])).toEqual({ nodes: 0, vcpu: 0, ramGb: 0, allKnown: true })
  })
})

describe('isClusterRunning', () => {
  it('reads phase first, then status', () => {
    expect(isClusterRunning(cluster({ phase: 'ready', status: 'error' }))).toBe(true)
    expect(isClusterRunning(cluster({ status: 'running' }))).toBe(true)
    expect(isClusterRunning(cluster({ phase: 'provisioning', status: 'pending' }))).toBe(false)
  })
})

describe('formatters', () => {
  it('fmtVcpu', () => {
    expect(fmtVcpu(0)).toBe('—')
    expect(fmtVcpu(16)).toBe('16 vCPU')
  })
  it('fmtRam', () => {
    expect(fmtRam(0)).toBe('—')
    expect(fmtRam(512)).toBe('512 GB')
    expect(fmtRam(2048)).toBe('2.0 TB')
  })
})
