/**
 * Customer GPU derivations — PURE, testable functions that turn a customer's REAL
 * per-org resources (their visor GPU catalog + machines, their own DOKS clusters)
 * into the per-tab view models. NOTHING here fabricates a GPU, pool, price, or alert:
 * every row is derived from a real backend value, and an org with no clusters /
 * machines / faults yields an empty array (the tab then renders an honest empty state).
 *
 *  - `gpuPoolsFromClusters` → the org's GPU NODE POOLS, read straight from its real
 *    clusters' `nodePools` (or the legacy `nodeSize`), GPU-detected by the size slug.
 *  - `gpuAlertsFromMachines` → alerts for the org's OWN GPU machines that are actually
 *    in a fault state (error/offline/…); a healthy or intentionally-stopped machine is
 *    NOT an alert. Real conditions only.
 *  - catalog helpers (`launchableGpus`, `distinctModelCount`, `cheapestHourly`,
 *    `sortByHourly`) — the pricing/overview stats, all off the one live visor catalog.
 */
import type { Cluster } from '~/lib/api'
import { gpuSpecOf, type GpuPool, type GpuAlert } from '~/lib/api/compute'
import { statusVerdict, type VisorGpuSize, type VisorMachine } from '~/lib/api/visor'

// ── Pools (derived from the org's real clusters) ─────────────────────────────

/**
 * The org's GPU node pools, derived from its REAL clusters. A cluster exposes node
 * POOLS (`nodePools`: size slug + count); a pool is a GPU pool when its size slug is a
 * GPU Droplet/instance (`gpuSpecOf`). We report the real per-pool GPU total
 * (`perNode × count`) and the cluster's real lifecycle state. Falls back to the legacy
 * single `nodeSize`/`nodeCount` when a cluster predates `nodePools`. PURE — no I/O; an
 * org with no GPU pools yields `[]` (the tab shows an honest empty state).
 */
export function gpuPoolsFromClusters(clusters: Cluster[]): GpuPool[] {
  const out: GpuPool[] = []
  for (const c of clusters) {
    const state = c.phase || c.status || undefined
    const pools = c.nodePools && c.nodePools.length ? c.nodePools : null
    if (pools) {
      for (const p of pools) {
        const spec = gpuSpecOf(p.size)
        if (!spec) continue
        const count = p.count && p.count > 0 ? p.count : 1
        out.push({
          id: `${c.doksClusterId || c.id || c.name}/${p.poolId || p.name || p.size || 'pool'}`,
          name: p.name || `${spec.model} pool · ${c.name}`,
          model: spec.model,
          size: spec.perNode * count,
          available: undefined, // no live per-GPU availability stream → honest "—"
          status: state,
        })
      }
      continue
    }
    // Legacy single-size cluster (no nodePools): derive one pool from nodeSize.
    const spec = gpuSpecOf(c.nodeSize)
    if (!spec) continue
    const count = c.nodeCount && c.nodeCount > 0 ? c.nodeCount : 1
    out.push({
      id: `${c.doksClusterId || c.id || c.name}/pool`,
      name: `${spec.model} pool · ${c.name}`,
      model: spec.model,
      size: spec.perNode * count,
      available: undefined,
      status: state,
    })
  }
  return out
}

// ── Alerts (derived from the org's own GPU machines' real health) ────────────

/** Statuses that are a GENUINE fault worth alerting on — NOT an intentional
 *  stop/off/terminate (a user turning a machine off is not an alert). */
const FAULT_STATUSES = new Set(['error', 'failed', 'offline', 'down', 'degraded', 'unreachable', 'crashed', 'unhealthy'])
const CRITICAL_STATUSES = new Set(['error', 'failed', 'offline', 'down', 'unreachable', 'crashed'])

/**
 * Real GPU alerts for the org, derived from its OWN GPU machines that are actually in a
 * fault state. Each alert names the real machine + its real reported status; severity
 * is critical for hard faults (offline/error/failed), warning for degraded. A machine
 * that is healthy — or intentionally stopped/off — is NOT an alert. PURE; a healthy (or
 * empty) fleet yields `[]` → the tab shows the honest "No alerts" state, never a fake.
 */
export function gpuAlertsFromMachines(machines: VisorMachine[]): GpuAlert[] {
  const out: GpuAlert[] = []
  for (const m of machines) {
    const status = (m.status ?? '').toLowerCase()
    if (!FAULT_STATUSES.has(status)) continue
    const name = m.name || m.id
    out.push({
      id: `machine-${m.id}`,
      severity: CRITICAL_STATUSES.has(status) ? 'critical' : 'warning',
      kind: 'machine-health',
      message: `GPU machine ${name} is ${m.status}`,
      gpu: m.gpu,
      cluster: m.region,
      at: undefined, // visor reports status, not a transition timestamp → honest "—"
    })
  }
  return out
}

// ── Catalog helpers (the one live visor GPU catalog) ─────────────────────────

/** The launchable accelerators (visor marks a size `available`). PURE. */
export const launchableGpus = (catalog: VisorGpuSize[]): VisorGpuSize[] => catalog.filter((c) => c.available)

/** Count of distinct GPU MODELS in a catalog slice (drops blanks). PURE. */
export const distinctModelCount = (sizes: VisorGpuSize[]): number =>
  new Set(sizes.map((c) => c.model).filter((m): m is string => !!m)).size

/** The lowest hourly price across a catalog slice, or `undefined` if none priced. PURE. */
export const cheapestHourly = (sizes: VisorGpuSize[]): number | undefined =>
  sizes.map((c) => c.priceHourly).filter((n): n is number => n != null).sort((a, b) => a - b)[0]

/**
 * Catalog sorted cheapest-first for the Pricing table (unpriced rows sink to the end).
 * A stable, real ordering — never a fabricated rate. PURE (returns a new array).
 */
export function sortByHourly(sizes: VisorGpuSize[]): VisorGpuSize[] {
  return [...sizes].sort((a, b) => {
    const pa = a.priceHourly ?? Number.POSITIVE_INFINITY
    const pb = b.priceHourly ?? Number.POSITIVE_INFINITY
    if (pa !== pb) return pa - pb
    return (a.model || a.slug).localeCompare(b.model || b.slug)
  })
}
