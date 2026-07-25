import { describe, expect, it } from 'vitest'

import {
  LUX_QUERIES,
  LUX_SERVICES,
  livenessOf,
  networkLabel,
  toNetworks,
  toNodeMemory,
  toServices,
  toTopPods,
} from './lux-infra'
import type { Sample } from './telemetry'

// A local Sample builder (the shaper input is telemetry's Sample: labels + value).
const s = (metric: Record<string, string>, value: number): Sample => ({ metric, value, ts: 1 })

// ── the query set is EXACTLY the cloud allowlist twin (drift guard) ─────────────

describe('LUX_QUERIES', () => {
  it('are the byte-for-byte twins the cloud vmProxyQueries allowlist admits', () => {
    // These literals MUST equal the keys in cloud/clients/o11y/vmproxy.go. A change
    // here without the matching Go change is a 400 at runtime — this pins the string.
    expect(LUX_QUERIES.nodeMemPct).toBe(
      '100*(1 - sum by (node)(node_memory_MemAvailable_bytes{cluster="lux-k8s"}) / sum by (node)(node_memory_MemTotal_bytes{cluster="lux-k8s"}))',
    )
    expect(LUX_QUERIES.topPodMem).toBe(
      'topk(12, sum by (namespace,pod)(container_memory_working_set_bytes{cluster="lux-k8s",pod!=""}))',
    )
    expect(LUX_QUERIES.deployAvailable).toBe(
      'kube_deployment_status_replicas_available{cluster="lux-k8s",deployment=~"lux-admin|lux-safe|lux-safe-cgw|lux-bitcoin|lux-coin|lux-finance|lux-invest|lux-market|lux-industries|lux-blog|iam|bootnode-web|bridge-server|bridge-ui|explorer"}',
    )
    expect(LUX_QUERIES.kmsReady).toBe('kube_statefulset_status_replicas_ready{cluster="lux-k8s",namespace="lux-kms-go",statefulset="kms"}')
    expect(LUX_QUERIES.validatorUp).toBe('lux_validator_up')
    expect(LUX_QUERIES.networkValidatorsTotal).toBe('lux_network_validators_total')
  })
})

// ── liveness is honest: derived from real up/bootstrapped/height, never uptime ──

describe('livenessOf', () => {
  it('down when the exporter cannot reach it (up=0) — luxd-2 mainnet', () => {
    expect(livenessOf(false, false, null)).toBe('down')
  })
  it('bootstrapping when up but not fully synced / height 0 — luxd-3 mainnet @0', () => {
    expect(livenessOf(true, false, 0)).toBe('bootstrapping')
    expect(livenessOf(true, false, null)).toBe('bootstrapping')
  })
  it('live when up + bootstrapped + advancing height — luxd-0/1/4 @1098191', () => {
    expect(livenessOf(true, true, 1098191)).toBe('live')
  })
})

// ── validators fold: the REAL mainnet snapshot (luxd-2 down, luxd-3 bootstrapping) ─

describe('toNetworks', () => {
  it('groups by network, orders mainnet-primary first, and joins the four series', () => {
    // The exact mainnet snapshot verified against the hub.
    const up = [
      s({ network: 'mainnet', instance: 'luxd-0' }, 1),
      s({ network: 'mainnet', instance: 'luxd-1' }, 1),
      s({ network: 'mainnet', instance: 'luxd-2' }, 0),
      s({ network: 'mainnet', instance: 'luxd-3' }, 1),
      s({ network: 'mainnet', instance: 'luxd-4' }, 1),
      s({ network: 'testnet', instance: 'luxd-0' }, 1),
    ]
    const height = [
      s({ network: 'mainnet', instance: 'luxd-0' }, 1098191),
      s({ network: 'mainnet', instance: 'luxd-1' }, 1098191),
      s({ network: 'mainnet', instance: 'luxd-3' }, 0),
      s({ network: 'mainnet', instance: 'luxd-4' }, 1098191),
    ]
    const peers = [
      s({ network: 'mainnet', instance: 'luxd-0' }, 4),
      s({ network: 'mainnet', instance: 'luxd-1' }, 4),
      s({ network: 'mainnet', instance: 'luxd-3' }, 4),
      s({ network: 'mainnet', instance: 'luxd-4' }, 4),
    ]
    const bootstrapped = [
      s({ network: 'mainnet', instance: 'luxd-0' }, 1),
      s({ network: 'mainnet', instance: 'luxd-1' }, 1),
      s({ network: 'mainnet', instance: 'luxd-2' }, 0),
      s({ network: 'mainnet', instance: 'luxd-3' }, 0),
      s({ network: 'mainnet', instance: 'luxd-4' }, 1),
    ]
    const netUp = [s({ network: 'mainnet' }, 4), s({ network: 'testnet' }, 3)]
    const netTotal = [s({ network: 'mainnet' }, 5), s({ network: 'testnet' }, 5)]

    const nets = toNetworks(up, height, peers, bootstrapped, netUp, netTotal)
    // mainnet is first (primary) and testnet second.
    expect(nets.map((n) => n.id)).toEqual(['mainnet', 'testnet'])
    const main = nets[0]
    expect(main.primary).toBe(true)
    expect(main.label).toBe('Primary · Mainnet')
    expect(main.up).toBe(4)
    expect(main.total).toBe(5)
    // 5 validators, ordered luxd-0..4.
    expect(main.validators.map((v) => v.instance)).toEqual(['luxd-0', 'luxd-1', 'luxd-2', 'luxd-3', 'luxd-4'])
    // luxd-2 down, luxd-3 bootstrapping @0, the rest live @1098191.
    const by = Object.fromEntries(main.validators.map((v) => [v.instance, v]))
    expect(by['luxd-2'].liveness).toBe('down')
    expect(by['luxd-2'].up).toBe(false)
    expect(by['luxd-3'].liveness).toBe('bootstrapping')
    expect(by['luxd-3'].height).toBe(0)
    expect(by['luxd-0'].liveness).toBe('live')
    expect(by['luxd-0'].height).toBe(1098191)
    expect(by['luxd-0'].peers).toBe(4)
    // luxd-2 is down → no height/peers series → honest null, never 0.
    expect(by['luxd-2'].height).toBeNull()
    expect(by['luxd-2'].peers).toBeNull()
  })

  it('is honest-empty on no data', () => {
    expect(toNetworks([], [], [], [], [], [])).toEqual([])
  })
})

// ── node memory %: highest pressure first (the OOM view) ────────────────────────

describe('toNodeMemory', () => {
  it('sorts nodes by used % descending', () => {
    const rows = toNodeMemory([
      s({ node: 'lux-nodes-a' }, 29.83),
      s({ node: 'lux-nodes-b' }, 52.05),
      s({ node: 'lux-nodes-c' }, 4.76),
    ])
    expect(rows.map((r) => r.node)).toEqual(['lux-nodes-b', 'lux-nodes-a', 'lux-nodes-c'])
    expect(rows[0].pct).toBeCloseTo(52.05)
  })
})

// ── top pods by memory, largest first ───────────────────────────────────────────

describe('toTopPods', () => {
  it('sorts pods by bytes descending and carries the namespace', () => {
    const rows = toTopPods([
      s({ namespace: 'lux-mainnet', pod: 'luxd-1' }, 5827 * 1048576),
      s({ namespace: 'lux-mainnet', pod: 'luxd-4' }, 6480 * 1048576),
    ])
    expect(rows[0].pod).toBe('luxd-4')
    expect(rows[0].namespace).toBe('lux-mainnet')
    expect(rows[1].pod).toBe('luxd-1')
  })
})

// ── services grid: prefix roll-up, longest-match wins, honest not-deployed ──────

describe('toServices', () => {
  it('rolls deployment/statefulset replicas up per service, deduping multi-namespace workloads', () => {
    // available (kube_deployment_status_replicas_available) — with the REAL dupes:
    // explorer in lux-devnet/lux-mainnet/lux-testnet, lux-market in hanzo/lux-mainnet/lux-ns.
    const avail = [
      s({ namespace: 'hanzo', deployment: 'lux-admin' }, 2),
      s({ namespace: 'hanzo', deployment: 'lux-safe' }, 2),
      s({ namespace: 'hanzo', deployment: 'lux-safe-cgw' }, 2),
      s({ namespace: 'hanzo', deployment: 'iam' }, 1),
      s({ namespace: 'hanzo', deployment: 'lux-market' }, 2), // canonical
      s({ namespace: 'lux-mainnet', deployment: 'lux-market' }, 1), // dupe → dropped
      s({ namespace: 'lux-ns', deployment: 'lux-market' }, 1), // dupe → dropped
      s({ namespace: 'lux-bridge', deployment: 'bridge-server' }, 2),
      s({ namespace: 'lux-mainnet', deployment: 'explorer' }, 1), // canonical
      s({ namespace: 'lux-devnet', deployment: 'explorer' }, 1), // dupe → dropped
      s({ namespace: 'lux-testnet', deployment: 'explorer' }, 0), // dupe → dropped
    ]
    const desired = [
      s({ namespace: 'hanzo', deployment: 'lux-admin' }, 2),
      s({ namespace: 'hanzo', deployment: 'lux-safe' }, 2),
      s({ namespace: 'hanzo', deployment: 'lux-safe-cgw' }, 2),
      s({ namespace: 'hanzo', deployment: 'iam' }, 1),
      s({ namespace: 'hanzo', deployment: 'lux-market' }, 2),
      s({ namespace: 'lux-bridge', deployment: 'bridge-server' }, 2),
      s({ namespace: 'lux-mainnet', deployment: 'explorer' }, 1),
    ]
    const kmsReady = [s({ namespace: 'lux-kms-go', statefulset: 'kms' }, 1)]
    const kmsDesired = [s({ namespace: 'lux-kms-go', statefulset: 'kms' }, 1)]

    const grid = Object.fromEntries(toServices(avail, desired, kmsReady, kmsDesired).map((r) => [r.service, r]))
    expect(grid['lux-admin']).toMatchObject({ running: 2, total: 2, deployed: true, healthy: true })
    expect(grid['lux-safe']).toMatchObject({ running: 2, total: 2, healthy: true })
    expect(grid['lux-safe-cgw']).toMatchObject({ running: 2, total: 2, healthy: true })
    expect(grid['iam']).toMatchObject({ running: 1, total: 1, healthy: true })
    // lux-market deduped to the canonical hanzo namespace (2/2), NOT summed across 3 ns.
    expect(grid['lux-market']).toMatchObject({ running: 2, total: 2, healthy: true })
    // explorer deduped to lux-mainnet (1/1), never the lux-testnet 0 or a triple-count.
    expect(grid['explorer']).toMatchObject({ running: 1, total: 1, healthy: true })
    expect(grid['bridge-server']).toMatchObject({ running: 2, total: 2, healthy: true })
    // kms StatefulSet ready/desired.
    expect(grid['kms']).toMatchObject({ running: 1, total: 1, deployed: true, healthy: true })
    // A named service with no series is honest 0/0 not-deployed (never fabricated up).
    expect(grid['lux-blog']).toMatchObject({ running: 0, total: 0, deployed: false, healthy: false })
    // Every named service is present, in the stable display order.
    expect(toServices(avail, desired, kmsReady, kmsDesired).map((r) => r.service)).toEqual(LUX_SERVICES.map((x) => x.id))
  })
})

describe('networkLabel', () => {
  it('renders Lux-neutral labels (no foreign brand string)', () => {
    expect(networkLabel('mainnet')).toBe('Primary · Mainnet')
    expect(networkLabel('testnet')).toBe('Testnet')
    expect(networkLabel('devnet')).toBe('Devnet')
    // An unknown network id is capitalized verbatim — data-driven, still Lux-scoped.
    expect(networkLabel('canary')).toBe('Canary')
  })
})
