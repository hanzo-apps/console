/**
 * Cluster capacity derivation — REAL provisioned compute from a cluster's node
 * pools, PURE (no I/O).
 *
 * The clusters surface exposes a cluster's node POOLS (a DigitalOcean size slug
 * + a count), not live per-node telemetry. So "CPU" / "Memory" on the Kubernetes
 * page are the PROVISIONED capacity we can derive deterministically from the slug
 * (`s-4vcpu-8gb` → 4 vCPU / 8 GB) × node count — never a fabricated live
 * utilization %. A slug we can't parse (or a GPU droplet, whose slug encodes GPU
 * memory not system RAM) contributes its NODES but leaves vCPU/RAM unknown, so
 * the total is honest: a real lower bound, with `allKnown=false` when partial.
 */
import type { Cluster, NodePool } from './platform'
import { ApiError } from './client'
import type { NodeNetworkId } from '~/lib/products/brand-scope'

export type { NodeNetworkId }

/** Provisioned vCPU + system RAM (GB) of one node of a DO size slug, or null. */
export function cpuMemOf(slug?: string | null): { vcpu: number; ramGb: number } | null {
  const s = (slug ?? '').trim().toLowerCase()
  if (!s) return null
  // GPU droplet slugs (gpu-h100x8-640gb) encode GPU memory, not system RAM/vCPU.
  if (s.startsWith('gpu-')) return null
  const ramM = /(\d+)\s*gb/.exec(s)
  const ramGb = ramM ? Number(ramM[1]) : NaN
  // Two slug shapes: `<class>-<n>vcpu-<n>gb` and the CPU-optimized `c-<n>-<n>gb`.
  let vcpu = NaN
  const vcpuM = /(\d+)\s*vcpu/.exec(s)
  if (vcpuM) vcpu = Number(vcpuM[1])
  else {
    const compact = /^[a-z]+-(\d+)-(\d+)gb$/.exec(s)
    if (compact) vcpu = Number(compact[1])
  }
  if (!Number.isFinite(vcpu) || !Number.isFinite(ramGb) || vcpu <= 0 || ramGb <= 0) return null
  return { vcpu, ramGb }
}

/** The node pools of a cluster (real `nodePools`, falling back to the legacy single size). */
export function poolsOf(c: Cluster): NodePool[] {
  if (c.nodePools && c.nodePools.length) return c.nodePools
  if (c.nodeSize) return [{ size: c.nodeSize, count: c.nodeCount ?? 1 }]
  return []
}

export type Capacity = {
  /** Total nodes (sum of pool counts) — counts every pool, parseable or not. */
  nodes: number
  /** Provisioned vCPU summed over pools whose slug we could parse. */
  vcpu: number
  /** Provisioned RAM (GB) summed over pools whose slug we could parse. */
  ramGb: number
  /** True iff every pool's slug parsed — so vCPU/RAM is the full total, not a floor. */
  allKnown: boolean
}

/** Provisioned capacity of one cluster from its node pools (REAL, PURE). */
export function clusterCapacity(c: Cluster): Capacity {
  const pools = poolsOf(c)
  let nodes = 0
  let vcpu = 0
  let ramGb = 0
  let allKnown = pools.length > 0
  for (const p of pools) {
    const count = p.count && p.count > 0 ? p.count : 1
    nodes += count
    const spec = cpuMemOf(p.size)
    if (spec) {
      vcpu += spec.vcpu * count
      ramGb += spec.ramGb * count
    } else {
      allKnown = false
    }
  }
  return { nodes, vcpu, ramGb, allKnown }
}

/** Provisioned capacity summed across a fleet of clusters (REAL, PURE). */
export function fleetCapacity(clusters: Cluster[]): Capacity {
  return clusters.reduce<Capacity>(
    (acc, c) => {
      const cap = clusterCapacity(c)
      return {
        nodes: acc.nodes + cap.nodes,
        vcpu: acc.vcpu + cap.vcpu,
        ramGb: acc.ramGb + cap.ramGb,
        allKnown: acc.allKnown && cap.allKnown,
      }
    },
    { nodes: 0, vcpu: 0, ramGb: 0, allKnown: true },
  )
}

/** Lifecycle strings the platform reports for a healthy/running cluster. */
const RUNNING = new Set(['running', 'ready', 'active', 'provisioned'])

/** Whether a cluster's status/phase reads as running (REAL, PURE). */
export function isClusterRunning(c: Cluster): boolean {
  return RUNNING.has((c.phase || c.status || '').toLowerCase())
}

/** "16 vCPU" / "—" — provisioned vCPU, honest dash when none parsed. */
export const fmtVcpu = (n: number): string => (n > 0 ? `${n.toLocaleString()} vCPU` : '—')

/** "512 GB" / "2.0 TB" / "—" — provisioned RAM, honest dash when none parsed. */
export function fmtRam(gb: number): string {
  if (gb <= 0) return '—'
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`
  return `${gb.toLocaleString()} GB`
}

// ── Blockchain node inventory (validators + peers) ───────────────────────────
// A SECOND, independent concern in this file: the per-node inventory of the REAL
// luxd primary networks (validators via P-chain `platform.getCurrentValidators`,
// peers via the node `info.peers` API), normalized to uniform rows. The transport
// is console2's own same-origin `/nodes` proxy (server-side, method-allowlisted);
// everything below `NodesApi` is PURE (no I/O) so the luxd-response → row mapping
// is unit-tested directly against the real wire shapes.

/** Static, public metadata for a configured node network (chain/env/label). The
 *  RPC HOST is server-only (the `/nodes` proxy) — this identity is safe to share. */
export const NODE_NETWORK_META: Record<NodeNetworkId, { chain: string; env: string; label: string }> = {
  'lux-mainnet': { chain: 'lux', env: 'mainnet', label: 'Lux Mainnet' },
  'lux-testnet': { chain: 'lux', env: 'testnet', label: 'Lux Testnet' },
  'lux-devnet': { chain: 'lux', env: 'devnet', label: 'Lux Devnet' },
  'pars-mainnet': { chain: 'pars', env: 'mainnet', label: 'Pars Mainnet' },
  'zoo-mainnet': { chain: 'zoo', env: 'mainnet', label: 'Zoo Mainnet' },
}

/** A node's role on a network. */
export type NodeRole = 'validator' | 'peer'

/**
 * Normalized status of a single node. `active` = a current validator (in the set);
 * `connected` = a peer the queried node is connected to; `benched` = a peer the
 * node has benched; `offline` = a validator reported not connected.
 */
export type NodeStatus = 'active' | 'connected' | 'benched' | 'offline' | 'unknown'

/** One normalized node row — the uniform shape every network's nodes render as. */
export interface NodeRow {
  /** Network id (e.g. 'lux-mainnet'). */
  network: NodeNetworkId
  /** Chain family ('lux' | 'pars' | 'zoo'). */
  chain: string
  /** Environment ('mainnet' | 'testnet' | 'devnet'). */
  env: string
  role: NodeRole
  /** luxd NodeID-… identifier. */
  nodeID: string
  /** luxd/<semver> version, when known (peers report it; validators inherit it
   *  when they are also a peer of the queried node). */
  version?: string
  status: NodeStatus
  /** Raw stake weight in nLUX (kept as a string — exceeds JS safe-integer range). */
  weight?: string
  /** Uptime as an integer percent, when the node reports it. */
  uptimePct?: number
  /** Block height (network P-chain height, attached client-side), when known. */
  height?: number
  /** Last time the queried node received from a peer (ISO-8601), when known. */
  lastSeen?: string
}

/** Raw P-chain validator as `platform.getCurrentValidators` returns it. */
export interface RawValidator {
  nodeID?: string
  weight?: string
  startTime?: string
  endTime?: string
  uptime?: string
  connected?: boolean
  [k: string]: unknown
}

/** Raw peer as the node `info.peers` API returns it. */
export interface RawPeer {
  nodeID?: string
  ip?: string
  publicIP?: string
  version?: string
  lastSent?: string
  lastReceived?: string
  observedUptime?: string
  benched?: unknown[]
  [k: string]: unknown
}

/** Raw blockchain as `platform.getBlockchains` returns it. */
export interface RawBlockchain {
  id?: string
  name?: string
  /** The network (subnet) the chain belongs to — the primary network for all our chains. */
  netID?: string
  subnetID?: string
  vmID?: string
  [k: string]: unknown
}

/** One primary-network chain — the identity a chains table renders. PURE view-model. */
export interface ChainInfo {
  /** blockchainID (base58check). */
  id: string
  /** Human name as luxd reports it (e.g. "X-Chain", "T-Chain"). */
  name: string
  /** The VM the chain runs (vmID), when known. */
  vmID?: string
}

/**
 * Normalize `platform.getBlockchains` → the chain list for a network. PURE.
 *
 * The P-Chain (the platform chain the call itself runs against) is NOT returned by
 * getBlockchains, so it is prepended as the first, always-present chain — the
 * primary network's coordinating chain. Everything else is exactly what luxd
 * reports (no fabrication): the letter chains (X C D Q A B T Z G K …) in the order
 * the node returns them. A chain with no id is dropped (can't be addressed).
 */
export function normalizeChains(blockchains: RawBlockchain[] | undefined): ChainInfo[] {
  const P: ChainInfo = { id: '11111111111111111111111111111111LpoYY', name: 'P-Chain' }
  const rest = (blockchains ?? [])
    .filter((b): b is RawBlockchain & { id: string } => typeof b.id === 'string' && b.id.length > 0)
    .map((b) => ({
      id: b.id,
      name: typeof b.name === 'string' && b.name ? b.name : b.id,
      vmID: typeof b.vmID === 'string' ? b.vmID : undefined,
    }))
  return [P, ...rest]
}

/**
 * luxd uptime string → integer percent, or undefined when absent/unparseable.
 * luxd reports uptime as a 0..1 fraction ("0.9950"); some builds report 0..100.
 * A present "0.0000" is a real zero (the queried node has no uptime measurement),
 * NOT fabricated — so it maps to 0, and only a missing/blank field is "unknown".
 */
export function parseUptimePct(raw?: string | null): number | undefined {
  if (raw == null || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) return undefined
  const pct = n <= 1 ? n * 100 : n
  return Math.max(0, Math.min(100, Math.round(pct)))
}

/** A luxd height string → number, or undefined when absent/unparseable. */
export function parseHeight(raw?: string | null): number | undefined {
  if (raw == null || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

/** Normalize P-chain validators → rows (version enriched from the peer map). PURE. */
export function normalizeValidators(
  validators: RawValidator[] | undefined,
  net: NodeNetworkId,
  versionByNode?: Map<string, string>,
): NodeRow[] {
  const meta = NODE_NETWORK_META[net]
  return (validators ?? [])
    .filter((v): v is RawValidator & { nodeID: string } => typeof v.nodeID === 'string' && v.nodeID.length > 0)
    .map((v) => ({
      network: net,
      chain: meta.chain,
      env: meta.env,
      role: 'validator' as const,
      nodeID: v.nodeID,
      version: versionByNode?.get(v.nodeID),
      status: v.connected === false ? ('offline' as const) : ('active' as const),
      weight: typeof v.weight === 'string' ? v.weight : undefined,
      uptimePct: parseUptimePct(v.uptime),
    }))
}

/** Normalize node peers → rows. PURE. */
export function normalizePeers(peers: RawPeer[] | undefined, net: NodeNetworkId): NodeRow[] {
  const meta = NODE_NETWORK_META[net]
  return (peers ?? [])
    .filter((p): p is RawPeer & { nodeID: string } => typeof p.nodeID === 'string' && p.nodeID.length > 0)
    .map((p) => ({
      network: net,
      chain: meta.chain,
      env: meta.env,
      role: 'peer' as const,
      nodeID: p.nodeID,
      version: typeof p.version === 'string' ? p.version : undefined,
      status: Array.isArray(p.benched) && p.benched.length > 0 ? ('benched' as const) : ('connected' as const),
      uptimePct: parseUptimePct(p.observedUptime),
      lastSeen: typeof p.lastReceived === 'string' ? p.lastReceived : undefined,
    }))
}

/**
 * Combine a network's validators + peers into a deduped node list. PURE.
 *
 * A nodeID that is BOTH a validator and a peer of the queried node appears ONCE,
 * as a validator, with its version enriched from the peer record. Peers that are
 * not validators follow as `peer` rows. Order: validators, then peers.
 */
export function combineInventory(
  validators: RawValidator[] | undefined,
  peers: RawPeer[] | undefined,
  net: NodeNetworkId,
): NodeRow[] {
  const versionByNode = new Map<string, string>()
  for (const p of peers ?? []) {
    if (typeof p.nodeID === 'string' && typeof p.version === 'string') versionByNode.set(p.nodeID, p.version)
  }
  const valRows = normalizeValidators(validators, net, versionByNode)
  const valIds = new Set(valRows.map((r) => r.nodeID))
  const peerRows = normalizePeers(peers, net).filter((r) => !valIds.has(r.nodeID))
  return [...valRows, ...peerRows]
}

/** "97%" / "—" — uptime percent, honest dash when the node reports none. */
export const fmtUptime = (pct?: number): string => (pct == null ? '—' : `${pct}%`)

/** "1,083,548" / "—" — block height, honest dash when unknown (0 is a real 0). */
export const fmtHeight = (h?: number): string => (h == null ? '—' : h.toLocaleString())

/** "500,000,000 LUX" / "—" — stake weight (nLUX → LUX, 9-decimal denom). PURE. */
export function fmtWeight(nlux?: string): string {
  if (!nlux) return '—'
  let n: bigint
  try {
    n = BigInt(nlux)
  } catch {
    return '—'
  }
  const lux = n / 1_000_000_000n
  return `${lux.toLocaleString()} LUX`
}

/** One network's inventory, as the `/nodes` proxy returns it (already normalized). */
export interface NetworkInventory {
  id: NodeNetworkId
  chain: string
  env: string
  label: string
  /** `reporting` = the luxd endpoint answered; `not-reporting` = unreachable/errored. */
  status: 'reporting' | 'not-reporting'
  /** Present when `not-reporting` — the real upstream error (never fabricated data). */
  error?: string
  /** Network P-chain height (`platform.getHeight`), when known. */
  height?: number
  /** Version of the queried endpoint (`info.getNodeVersion`), when known. */
  version?: string
  validators: number
  peers: number
  nodes: NodeRow[]
  /**
   * The network's primary-network chains (`platform.getBlockchains`, P-Chain
   * prepended). Present only when `reporting`; empty when the network's RPC did
   * not answer the getBlockchains call (honest — never a fabricated chain set).
   */
  chains: ChainInfo[]
}

/**
 * Browser client for the node inventory — hits console2's OWN `/nodes` proxy with
 * just the session cookie; the server resolves the brand from the host, calls the
 * allowlisted luxd RPC methods per brand-scoped network, and returns normalized
 * inventory. No RPC host or method is ever chosen by the browser.
 */
export const NodesApi = {
  /** Inventory for every network the current brand may see (optionally one). */
  async inventory(network?: NodeNetworkId): Promise<NetworkInventory[]> {
    const qs = network ? `?network=${encodeURIComponent(network)}` : ''
    const res = await fetch(`/v1/nodes/inventory${qs}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) {
      let msg = `Nodes ${res.status}`
      try {
        const body = await res.json()
        if (body?.error) msg = String(body.error)
      } catch {
        /* not JSON */
      }
      throw new ApiError(msg, res.status)
    }
    const json = await res.json().catch(() => null)
    const nets = Array.isArray(json?.networks) ? json.networks : []
    return nets as NetworkInventory[]
  },
}
