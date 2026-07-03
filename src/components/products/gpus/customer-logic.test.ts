import { describe, it, expect } from 'vitest'

import type { Cluster } from '~/lib/api'
import type { VisorGpuSize, VisorMachine } from '~/lib/api/visor'
import {
  gpuPoolsFromClusters,
  gpuAlertsFromMachines,
  launchableGpus,
  distinctModelCount,
  cheapestHourly,
  sortByHourly,
} from './customer-logic'

/**
 * The whole point of these tests: the customer GPU tabs render ONLY real, per-org
 * data. Pools come from the org's real clusters (GPU-detected by size slug, real
 * counts). Alerts come from the org's OWN machines that are ACTUALLY in a fault state —
 * a healthy or intentionally-stopped machine is never an alert. Catalog stats come off
 * the one live visor catalog. Nothing is fabricated; empty inputs yield empty outputs.
 */

const cluster = (over: Partial<Cluster>): Cluster => ({ name: 'demo', status: 'running', phase: 'ready', region: 'sfo3', ...over })
const machine = (over: Partial<VisorMachine>): VisorMachine => ({ id: 'm1', name: 'gpu-1', ...over })
const size = (over: Partial<VisorGpuSize>): VisorGpuSize => ({ slug: 's', available: true, regions: [], ...over })

describe('gpuPoolsFromClusters — real GPU node pools from the org clusters', () => {
  it('extracts a GPU pool per GPU node pool, with the real GPU total (perNode × count)', () => {
    const pools = gpuPoolsFromClusters([
      cluster({
        name: 'ml',
        nodePools: [
          { poolId: 'p1', name: 'h100', size: 'gpu-h100x8-640gb', count: 2 }, // 8×2 = 16 H100
          { poolId: 'p2', name: 'cpu', size: 's-4vcpu-8gb', count: 3 }, // not a GPU pool
        ],
      }),
    ])
    expect(pools).toHaveLength(1)
    expect(pools[0]).toMatchObject({ model: 'H100', size: 16, status: 'ready' })
    expect(pools[0].available).toBeUndefined() // no live availability → honest "—"
  })

  it('falls back to the legacy single nodeSize when a cluster has no nodePools', () => {
    const pools = gpuPoolsFromClusters([cluster({ name: 'legacy', nodeSize: 'gpu-l40sx1-48gb', nodeCount: 4 })])
    expect(pools).toHaveLength(1)
    expect(pools[0]).toMatchObject({ model: 'L40S', size: 4 })
  })

  it('returns [] for a cluster with only CPU pools (no fabricated pool)', () => {
    expect(gpuPoolsFromClusters([cluster({ nodePools: [{ size: 's-4vcpu-8gb', count: 3 }] })])).toEqual([])
    expect(gpuPoolsFromClusters([])).toEqual([])
  })
})

describe('gpuAlertsFromMachines — real alerts from the org machines only', () => {
  it('alerts on a machine in a hard fault (critical), naming the real machine + status', () => {
    const alerts = gpuAlertsFromMachines([machine({ id: 'x', name: 'trainer', status: 'offline', gpu: 'H100' })])
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ severity: 'critical', gpu: 'H100' })
    expect(alerts[0].message).toContain('trainer')
    expect(alerts[0].message).toContain('offline')
  })

  it('marks a degraded machine as a warning', () => {
    expect(gpuAlertsFromMachines([machine({ status: 'degraded' })])[0]).toMatchObject({ severity: 'warning' })
  })

  it('does NOT alert on healthy or intentionally-stopped machines (no fake alerts)', () => {
    expect(gpuAlertsFromMachines([
      machine({ id: 'a', status: 'active' }),
      machine({ id: 'b', status: 'running' }),
      machine({ id: 'c', status: 'off' }),
      machine({ id: 'd', status: 'stopped' }),
    ])).toEqual([])
    expect(gpuAlertsFromMachines([])).toEqual([])
  })
})

describe('catalog helpers — real stats off the one live visor catalog', () => {
  const catalog = [
    size({ slug: 'h100', model: 'H100', priceHourly: 3.5, available: true }),
    size({ slug: 'a100', model: 'A100', priceHourly: 2.0, available: true }),
    size({ slug: 'l40s', model: 'L40S', priceHourly: undefined, available: true }),
    size({ slug: 'old', model: 'V100', priceHourly: 1.0, available: false }),
  ]

  it('launchableGpus keeps only available sizes', () => {
    expect(launchableGpus(catalog).map((c) => c.slug)).toEqual(['h100', 'a100', 'l40s'])
  })

  it('distinctModelCount counts unique models (blanks dropped)', () => {
    expect(distinctModelCount(launchableGpus(catalog))).toBe(3)
    expect(distinctModelCount([size({ model: undefined })])).toBe(0)
  })

  it('cheapestHourly is the lowest real price among the given sizes', () => {
    expect(cheapestHourly(launchableGpus(catalog))).toBe(2.0)
    expect(cheapestHourly([size({ priceHourly: undefined })])).toBeUndefined()
  })

  it('sortByHourly sorts cheapest-first and sinks unpriced rows to the end (stable, real order)', () => {
    expect(sortByHourly(launchableGpus(catalog)).map((c) => c.slug)).toEqual(['a100', 'h100', 'l40s'])
  })
})
