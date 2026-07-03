import { describe, it, expect } from 'vitest'

import {
  cpuMemOf,
  clusterCapacity,
  fleetCapacity,
  isClusterRunning,
  fmtVcpu,
  fmtRam,
  normalizeValidators,
  normalizePeers,
  combineInventory,
  normalizeChains,
  parseUptimePct,
  parseHeight,
  fmtUptime,
  fmtHeight,
  fmtWeight,
  type RawValidator,
  type RawPeer,
  type RawBlockchain,
} from './nodes'
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

// ── Blockchain node inventory — luxd RPC response → normalized rows ───────────
// Fixtures are the REAL wire shapes captured live from the luxd RPC on
// 2026-07-01 (api.lux.network platform.getCurrentValidators + info.peers):
//   - validators carry nodeID/weight/uptime/signer, NO version, NO `connected`.
//   - peers carry nodeID/version ("luxd/1.32.4")/lastReceived/benched.

/** One real P-chain validator (trimmed to the fields we normalize). */
const VALIDATOR: RawValidator = {
  txID: '2vVEn6wZ9CTb3wipShe31Dt2KbcPiCcFcGFX5ur2Co5f5xzy7Q',
  startTime: '1765573611',
  endTime: '1797088011',
  weight: '500000000000000000',
  nodeID: 'NodeID-DwsrqSkPoE3pXWrUt9nkJ5yBycwRQ246X',
  uptime: '0.0000',
  delegationFee: '2.0000',
}

/** Two real peers — one of them ALSO the validator above (shared nodeID). */
const PEERS: RawPeer[] = [
  {
    ip: '10.150.20.52:35730',
    publicIP: '129.212.164.46:9631',
    nodeID: 'NodeID-Mf3JfSY91oDwfBqf7rCLmhg4NDtDghw1f',
    version: 'luxd/1.32.4',
    lastSent: '2026-07-01T12:56:07Z',
    lastReceived: '2026-07-01T12:56:09Z',
    observedUptime: '0',
    benched: [],
  },
  {
    ip: '10.150.2.91:55274',
    publicIP: '143.244.210.43:9631',
    nodeID: 'NodeID-DwsrqSkPoE3pXWrUt9nkJ5yBycwRQ246X', // same as VALIDATOR
    version: 'luxd/1.31.0',
    lastSent: '2026-07-01T12:56:07Z',
    lastReceived: '2026-07-01T12:56:07Z',
    observedUptime: '0.9950',
    benched: ['someChain'],
  },
]

describe('parseUptimePct — luxd uptime string → percent', () => {
  it('reads a 0..1 fraction as a percent', () => {
    expect(parseUptimePct('0.9950')).toBe(100) // 99.5 rounds to 100
    expect(parseUptimePct('0.9940')).toBe(99)
    expect(parseUptimePct('0.5000')).toBe(50)
    expect(parseUptimePct('1.0000')).toBe(100)
  })
  it('treats a present 0.0000 as a real 0 (not "unknown")', () => {
    expect(parseUptimePct('0.0000')).toBe(0)
    expect(parseUptimePct('0')).toBe(0)
  })
  it('reads a 0..100 build value directly', () => {
    expect(parseUptimePct('87')).toBe(87)
    expect(parseUptimePct('150')).toBe(100) // clamped
  })
  it('is "unknown" only when absent/blank/unparseable', () => {
    expect(parseUptimePct(undefined)).toBeUndefined()
    expect(parseUptimePct(null)).toBeUndefined()
    expect(parseUptimePct('')).toBeUndefined()
    expect(parseUptimePct('n/a')).toBeUndefined()
  })
})

describe('parseHeight', () => {
  it('parses a height string (0 is a real 0)', () => {
    expect(parseHeight('1083548')).toBe(1083548)
    expect(parseHeight('0')).toBe(0)
  })
  it('is undefined for absent/unparseable', () => {
    expect(parseHeight(undefined)).toBeUndefined()
    expect(parseHeight('')).toBeUndefined()
    expect(parseHeight('abc')).toBeUndefined()
  })
})

describe('normalizeValidators — P-chain validators → rows', () => {
  it('maps the real validator shape onto a uniform row', () => {
    const [row] = normalizeValidators([VALIDATOR], 'lux-mainnet')
    expect(row).toEqual({
      network: 'lux-mainnet',
      chain: 'lux',
      env: 'mainnet',
      role: 'validator',
      nodeID: 'NodeID-DwsrqSkPoE3pXWrUt9nkJ5yBycwRQ246X',
      version: undefined, // P-chain validators carry NO version
      status: 'active', // in the current set, `connected` absent → active
      weight: '500000000000000000',
      uptimePct: 0, // real "0.0000"
    })
  })
  it('enriches version from the peer map when the validator is also a peer', () => {
    const versionByNode = new Map([['NodeID-DwsrqSkPoE3pXWrUt9nkJ5yBycwRQ246X', 'luxd/1.31.0']])
    const [row] = normalizeValidators([VALIDATOR], 'lux-mainnet', versionByNode)
    expect(row.version).toBe('luxd/1.31.0')
  })
  it('flags an explicitly-disconnected validator as offline', () => {
    const [row] = normalizeValidators([{ ...VALIDATOR, connected: false }], 'lux-testnet')
    expect(row.status).toBe('offline')
    expect(row.env).toBe('testnet')
  })
  it('drops entries with no nodeID and tolerates an empty/absent list', () => {
    expect(normalizeValidators([{ weight: '1' }], 'lux-mainnet')).toEqual([])
    expect(normalizeValidators(undefined, 'lux-mainnet')).toEqual([])
  })
})

describe('normalizePeers — node peers → rows', () => {
  it('maps the real peer shape, keeping the full version and last-received', () => {
    const [row] = normalizePeers([PEERS[0]], 'lux-mainnet')
    expect(row).toEqual({
      network: 'lux-mainnet',
      chain: 'lux',
      env: 'mainnet',
      role: 'peer',
      nodeID: 'NodeID-Mf3JfSY91oDwfBqf7rCLmhg4NDtDghw1f',
      version: 'luxd/1.32.4',
      status: 'connected',
      uptimePct: 0, // observedUptime "0" is a real 0
      lastSeen: '2026-07-01T12:56:09Z',
    })
  })
  it('marks a benched peer as benched', () => {
    const [row] = normalizePeers([PEERS[1]], 'lux-mainnet')
    expect(row.status).toBe('benched')
    expect(row.uptimePct).toBe(100) // observedUptime "0.9950"
  })
  it('tolerates an empty/absent list', () => {
    expect(normalizePeers([], 'pars-mainnet')).toEqual([])
    expect(normalizePeers(undefined, 'pars-mainnet')).toEqual([])
  })
})

describe('combineInventory — dedupe validators+peers by nodeID', () => {
  it('a node that is BOTH validator and peer appears once (as validator, version enriched)', () => {
    const rows = combineInventory([VALIDATOR], PEERS, 'lux-mainnet')
    // 1 validator (also a peer) + 1 peer-only = 2 rows, not 3.
    expect(rows).toHaveLength(2)
    const shared = rows.find((r) => r.nodeID === 'NodeID-DwsrqSkPoE3pXWrUt9nkJ5yBycwRQ246X')
    expect(shared?.role).toBe('validator')
    expect(shared?.version).toBe('luxd/1.31.0') // enriched from the peer record
    const peerOnly = rows.find((r) => r.nodeID === 'NodeID-Mf3JfSY91oDwfBqf7rCLmhg4NDtDghw1f')
    expect(peerOnly?.role).toBe('peer')
    // validators come first
    expect(rows[0].role).toBe('validator')
  })
  it('honest empty when a reachable network has zero of everything (pars: 0 peers)', () => {
    expect(combineInventory([], [], 'pars-mainnet')).toEqual([])
  })
})

describe('normalizeChains — platform.getBlockchains → chain list (P prepended)', () => {
  // The real live devnet wire shape (the T-model letter chains).
  const WIRE: RawBlockchain[] = [
    { id: 'LxQUnwVkZWcfsGigw3qC1EmFWiZK4d9HwxYcYazxadw5pTDyX', name: 'K-Chain', netID: '11111111111111111111111111111111LpoYY', vmID: 'pJJCSV7hHYVY6TUZwR8qUPAfuhX8JLb2C1AzNSezrYNbgau8M' },
    { id: '2H16HhzqZHrUqvoGh59u8ReMeLuyTBJrkf61JnRVp4ZxuAtQ1F', name: 'G-Chain', netID: '11111111111111111111111111111111LpoYY', vmID: 'nZQm4Dmg1rjX18rb8maL9gamYyXPf1xCvF7ymWzxp6a1nSQTt' },
    { id: '25kZyebvQGwtRVS7uiRJcECoEbKf53URfFA4P176QptMj9o8Ti', name: 'A-Chain', netID: '11111111111111111111111111111111LpoYY', vmID: 'juFxSrbCM4wszxddKepj1GWwmrn9YgN1g4n3VUWPpRo9JjERA' },
  ]

  it('prepends the P-Chain and preserves the reported chains in order', () => {
    const chains = normalizeChains(WIRE)
    expect(chains).toHaveLength(4) // P + 3
    expect(chains[0].name).toBe('P-Chain')
    expect(chains[0].id).toBe('11111111111111111111111111111111LpoYY')
    expect(chains.map((c) => c.name)).toEqual(['P-Chain', 'K-Chain', 'G-Chain', 'A-Chain'])
    expect(chains[1].vmID).toBe('pJJCSV7hHYVY6TUZwR8qUPAfuhX8JLb2C1AzNSezrYNbgau8M')
  })

  it('undefined/empty input → just the P-Chain (never fabricated chains)', () => {
    expect(normalizeChains(undefined).map((c) => c.name)).toEqual(['P-Chain'])
    expect(normalizeChains([]).map((c) => c.name)).toEqual(['P-Chain'])
  })

  it('drops a chain with no id (can not be addressed); falls back name→id when name absent', () => {
    const chains = normalizeChains([
      { name: 'X-Chain' }, // no id → dropped
      { id: 'abc123' }, // no name → name falls back to id
    ] as RawBlockchain[])
    expect(chains.map((c) => c.name)).toEqual(['P-Chain', 'abc123'])
  })
})

describe('node formatters', () => {
  it('fmtUptime', () => {
    expect(fmtUptime(undefined)).toBe('—')
    expect(fmtUptime(0)).toBe('0%')
    expect(fmtUptime(97)).toBe('97%')
  })
  it('fmtHeight (0 is a real 0, not a dash)', () => {
    expect(fmtHeight(undefined)).toBe('—')
    expect(fmtHeight(0)).toBe('0')
    expect(fmtHeight(1083548)).toBe('1,083,548')
  })
  it('fmtWeight — nLUX → LUX, honest dash', () => {
    expect(fmtWeight(undefined)).toBe('—')
    expect(fmtWeight('500000000000000000')).toBe('500,000,000 LUX')
    expect(fmtWeight('not-a-number')).toBe('—')
  })
})
