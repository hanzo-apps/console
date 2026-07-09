import { describe, it, expect } from 'vitest'

import { fromFleet, nodeStatusVerdict } from './adapters'
import type { NetworkInventory } from '~/lib/api/nodes'
import type { Cluster } from '~/lib/api/platform'

/**
 * Fleet adapter tests — `fromFleet` is the PURE map from the two REAL fleet sources
 * (luxd node inventory + the org's DOKS clusters) onto `OverviewData`, so the Fleet
 * board's validator + cluster tables, KPI counts, and health rows are pinned directly
 * against the real wire shapes. Fabricates nothing: an unreachable network drops out
 * of the table + shows a red health row; an org with no clusters yields an empty table.
 */

const luxMainnet = (): NetworkInventory => ({
  id: 'lux-mainnet',
  chain: 'lux',
  env: 'mainnet',
  label: 'Lux Mainnet',
  status: 'reporting',
  height: 1_083_548,
  version: 'luxd/1.13.0',
  validators: 2,
  peers: 1,
  nodes: [
    { network: 'lux-mainnet', chain: 'lux', env: 'mainnet', role: 'validator', nodeID: 'NodeID-AAA', status: 'active', weight: '2000000000000000000', uptimePct: 99 },
    { network: 'lux-mainnet', chain: 'lux', env: 'mainnet', role: 'validator', nodeID: 'NodeID-BBB', status: 'offline' },
    { network: 'lux-mainnet', chain: 'lux', env: 'mainnet', role: 'peer', nodeID: 'NodeID-CCC', status: 'connected' },
  ],
  chains: [],
})

const luxTestnetDown = (): NetworkInventory => ({
  id: 'lux-testnet',
  chain: 'lux',
  env: 'testnet',
  label: 'Lux Testnet',
  status: 'not-reporting',
  error: 'dial tcp: i/o timeout',
  validators: 0,
  peers: 0,
  nodes: [],
  chains: [],
})

const dedicatedCluster = (): Cluster => ({
  doksClusterId: 'ck_1',
  name: 'hanzo-lux',
  region: 'sfo3',
  status: 'running',
  phase: 'ready',
  nodePools: [
    { size: 's-4vcpu-8gb', count: 3 },
    { size: 'gpu-h100x1-80gb', count: 1 }, // unparseable RAM, but its NODE still counts
  ],
})

describe('nodeStatusVerdict', () => {
  it('maps a validator status to a health verdict', () => {
    expect(nodeStatusVerdict('active')).toBe('green')
    expect(nodeStatusVerdict('connected')).toBe('green')
    expect(nodeStatusVerdict('offline')).toBe('red')
    expect(nodeStatusVerdict('benched')).toBe('yellow')
    expect(nodeStatusVerdict('unknown')).toBe('yellow')
  })
})

describe('fromFleet — validator table', () => {
  const d = fromFleet([luxMainnet(), luxTestnetDown()], [])
  const nodes = d.tables!.nodes

  it('shows VALIDATORS only (peers excluded), one row per validator', () => {
    expect(nodes.rows).toHaveLength(2)
    expect(nodes.rows.map((r) => r.cells.nodeID)).toEqual(['NodeID-AAA', 'NodeID-BBB'])
  })

  it('renders net / nodeID / height / health per row, height = the network P-chain height', () => {
    const aaa = nodes.rows[0]
    expect(aaa.cells.network).toBe('Lux Mainnet')
    expect(aaa.cells.height).toBe('1,083,548') // the network's getHeight, formatted
    expect(aaa.cells.status).toBe('active')
    expect(aaa.status).toBe('green')
    expect(nodes.rows[1].status).toBe('red') // NodeID-BBB is offline
  })

  it('declares the four columns the owner asked for', () => {
    expect(nodes.columns.map((c) => c.key)).toEqual(['network', 'nodeID', 'height', 'status'])
    expect(nodes.columns.find((c) => c.key === 'nodeID')?.kind).toBe('mono')
    expect(nodes.columns.find((c) => c.key === 'status')?.kind).toBe('status')
  })
})

describe('fromFleet — cluster table', () => {
  const d = fromFleet([], [dedicatedCluster()])
  const clusters = d.tables!.clusters

  it('renders name / region / nodes / status per cluster; nodes = summed pool counts', () => {
    expect(clusters.rows).toHaveLength(1)
    const c = clusters.rows[0]
    expect(c.cells.name).toBe('hanzo-lux')
    expect(c.cells.region).toBe('sfo3')
    expect(c.cells.nodes).toBe('4') // 3 + 1 across the two pools
    expect(c.cells.status).toBe('ready')
    expect(c.status).toBe('green') // running → green verdict
  })
})

describe('fromFleet — KPI counts + health rows', () => {
  const d = fromFleet([luxMainnet(), luxTestnetDown()], [dedicatedCluster()])

  it('counts only REPORTING networks, all validators, all clusters, and cluster nodes', () => {
    expect(d.kpi.networks.value).toBe(1) // mainnet reporting, testnet down
    expect(d.kpi.validators.value).toBe(2)
    expect(d.kpi.clusters.value).toBe(1)
    expect(d.kpi.clusterNodes?.value).toBe(4)
  })

  it('one health row per network (down → red + its real error) + per cluster', () => {
    const byService = Object.fromEntries(d.health.map((h) => [h.service, h]))
    expect(byService['Lux Mainnet'].health).toBe('green')
    expect(byService['Lux Testnet'].health).toBe('red')
    expect(byService['Lux Testnet'].detail).toContain('i/o timeout') // real upstream error, not fabricated
    expect(byService['hanzo-lux'].health).toBe('green')
  })
})

describe('fromFleet — honest empty', () => {
  const d = fromFleet([], [])
  it('empty sources → empty tables, zero counts, no fabricated rows', () => {
    expect(d.tables!.nodes.rows).toEqual([])
    expect(d.tables!.clusters.rows).toEqual([])
    expect(d.kpi.networks.value).toBe(0)
    expect(d.kpi.validators.value).toBe(0)
    expect(d.kpi.clusters.value).toBe(0)
    expect(d.kpi.clusterNodes).toBeUndefined() // no clusters → the tile reads em-dash, not 0
    expect(d.health).toEqual([])
  })
})
