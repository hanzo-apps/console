/**
 * Cluster capacity derivation — REAL provisioned compute from a cluster's node
 * pools, PURE (no I/O).
 *
 * The PaaS control plane exposes a cluster's node POOLS (a DigitalOcean size slug
 * + a count), not live per-node telemetry. So "CPU" / "Memory" on the Kubernetes
 * page are the PROVISIONED capacity we can derive deterministically from the slug
 * (`s-4vcpu-8gb` → 4 vCPU / 8 GB) × node count — never a fabricated live
 * utilization %. A slug we can't parse (or a GPU droplet, whose slug encodes GPU
 * memory not system RAM) contributes its NODES but leaves vCPU/RAM unknown, so
 * the total is honest: a real lower bound, with `allKnown=false` when partial.
 */
import type { Cluster, NodePool } from './platform'

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
