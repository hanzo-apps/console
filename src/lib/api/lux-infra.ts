/**
 * Lux Network infrastructure telemetry — the data layer for the console.lux.cloud
 * SuperAdmin investor board (LuxNetworkModule). Reads the REAL lux-k8s series
 * federated into the Hanzo VictoriaMetrics hub, through the SAME SuperAdmin-gated,
 * allowlisted cloud VM proxy the platform-health board uses (`/v1/o11y/vm/query`,
 * cloud clients/o11y/vmproxy.go). Every value is a fold over what VictoriaMetrics
 * returns — an empty result rolls up to honest zeros / em-dashes, never a fabricated
 * validator, node, or service.
 *
 * ONE contract, two languages: `LUX_QUERIES` are the EXACT fixed PromQL the board
 * sends, byte-for-byte twins of the cloud allowlist (`vmProxyQueries`). The proxy
 * admits ONLY these; the query string the board sends must equal an allowlist key
 * after TrimSpace or it is a 400. A Go test (vmproxy_test.go) and this module's test
 * both pin the set, so a drift on EITHER side is a caught regression — the client
 * never supplies a raw query (scope.go's security contract).
 *
 * White-label: the `lux_*` series are emitted only by the Lux validator exporter
 * (brand=lux, cluster=lux-k8s), and every k8s selector is pinned to cluster="lux-k8s",
 * so this is intrinsically Lux data. The service grid keys on the Lux-branded SERVICE
 * name (a pod-name prefix), never the namespace — so no foreign namespace string
 * (e.g. an infra namespace name) reaches the Lux surface. Multi-network readiness is
 * data-driven: the validators view groups by the `network` label the metrics carry,
 * so additional sovereign L1/L2 networks light up automatically as their exporters
 * publish — on their OWN brand consoles, never leaked here.
 */
import { TelemetryApi, type Sample } from './telemetry'

// ── The allowlisted query set (byte-for-byte twin of cloud vmProxyQueries) ───────

export const LUX_QUERIES = {
  /** Per-node memory used % — the OOM pressure view (10 lux-k8s nodes). */
  nodeMemPct: `100*(1 - sum by (node)(node_memory_MemAvailable_bytes{cluster="lux-k8s"}) / sum by (node)(node_memory_MemTotal_bytes{cluster="lux-k8s"}))`,
  /** Top 12 pods by working-set memory. */
  topPodMem: `topk(12, sum by (namespace,pod)(container_memory_working_set_bytes{cluster="lux-k8s",pod!=""}))`,
  /** Named-service AVAILABLE replicas (Deployments). The regex is fully anchored in
   *  PromQL, so `lux-safe` never over-matches `lux-safe-cgw`. The board dedupes
   *  multi-namespace deployments (explorer, lux-market) to a canonical namespace. */
  deployAvailable: `kube_deployment_status_replicas_available{cluster="lux-k8s",deployment=~"lux-admin|lux-safe|lux-safe-cgw|lux-bitcoin|lux-coin|lux-finance|lux-invest|lux-market|lux-industries|lux-blog|iam|bootnode-web|bridge-server|bridge-ui|explorer"}`,
  /** Named-service DESIRED replicas (Deployment spec). */
  deployDesired: `kube_deployment_spec_replicas{cluster="lux-k8s",deployment=~"lux-admin|lux-safe|lux-safe-cgw|lux-bitcoin|lux-coin|lux-finance|lux-invest|lux-market|lux-industries|lux-blog|iam|bootnode-web|bridge-server|bridge-ui|explorer"}`,
  /** KMS is a StatefulSet, not a Deployment — its ready + desired replicas. */
  kmsReady: `kube_statefulset_status_replicas_ready{cluster="lux-k8s",namespace="lux-kms-go",statefulset="kms"}`,
  kmsDesired: `kube_statefulset_replicas{cluster="lux-k8s",namespace="lux-kms-go",statefulset="kms"}`,
  /** Per-validator: exporter can reach it (1) / cannot (0). */
  validatorUp: 'lux_validator_up',
  /** Per-validator C-Chain block height. */
  validatorHeight: 'lux_validator_c_block_height',
  /** Per-validator connected peer count. */
  validatorPeers: 'lux_validator_peers',
  /** Per-validator fully-bootstrapped (1) / still syncing (0). */
  validatorBootstrapped: 'lux_validator_bootstrapped',
  /** Per-network count of validators up. */
  networkValidatorsUp: 'lux_network_validators_up',
  /** Per-network validator-set size. */
  networkValidatorsTotal: 'lux_network_validators_total',
} as const

// ── The named Lux services the status grid tracks (pod-name prefixes) ────────────

/**
 * A named Lux service, its workload kind, and its CANONICAL namespace (the one row to
 * keep when a workload name exists in several namespaces — explorer and lux-market
 * both do). `ns` is used ONLY to dedupe the match; it is NEVER rendered, so no infra
 * namespace string reaches the Lux surface (white-label). Display order = grid order.
 * Every service name is Lux-branded or brand-neutral shared infra (iam/kms/bridge/
 * explorer) — no foreign brand string.
 */
export type LuxService = { id: string; ns: string; kind: 'deployment' | 'statefulset' }
export const LUX_SERVICES: LuxService[] = [
  { id: 'lux-admin', ns: 'hanzo', kind: 'deployment' },
  { id: 'lux-safe', ns: 'hanzo', kind: 'deployment' },
  { id: 'lux-safe-cgw', ns: 'hanzo', kind: 'deployment' },
  { id: 'lux-bitcoin', ns: 'hanzo', kind: 'deployment' },
  { id: 'lux-coin', ns: 'hanzo', kind: 'deployment' },
  { id: 'lux-finance', ns: 'hanzo', kind: 'deployment' },
  { id: 'lux-invest', ns: 'hanzo', kind: 'deployment' },
  { id: 'lux-market', ns: 'hanzo', kind: 'deployment' },
  { id: 'lux-industries', ns: 'hanzo', kind: 'deployment' },
  { id: 'lux-blog', ns: 'hanzo', kind: 'deployment' },
  { id: 'iam', ns: 'hanzo', kind: 'deployment' },
  { id: 'bootnode-web', ns: 'bootnode', kind: 'deployment' },
  { id: 'bridge-server', ns: 'lux-bridge', kind: 'deployment' },
  { id: 'bridge-ui', ns: 'lux-bridge', kind: 'deployment' },
  { id: 'explorer', ns: 'lux-mainnet', kind: 'deployment' },
  { id: 'kms', ns: 'lux-kms-go', kind: 'statefulset' },
]

// ── View models ──────────────────────────────────────────────────────────────

/** Honest liveness verdict from REAL signals — never a fabricated uptime %. */
export type Liveness = 'live' | 'bootstrapping' | 'down'

/** One validator instance (luxd-N) within a network. */
export type ValidatorRow = {
  network: string
  instance: string
  up: boolean
  bootstrapped: boolean
  height: number | null
  peers: number | null
  liveness: Liveness
}

/** One network's validator set + rollup. */
export type NetworkSummary = {
  /** The raw `network` label value (mainnet/testnet/devnet/…). */
  id: string
  /** Lux-neutral display label (derived from `id`; no foreign brand). */
  label: string
  /** The Lux primary network (mainnet) — highlighted, staking-backed. */
  primary: boolean
  validators: ValidatorRow[]
  /** lux_network_validators_up (authoritative rollup), or null if absent. */
  up: number | null
  /** lux_network_validators_total (the validator-set size), or null. */
  total: number | null
}

export type NodeMem = { node: string; pct: number }
export type PodMem = { pod: string; namespace: string; bytes: number }
export type ServiceStatus = { service: string; running: number; total: number; deployed: boolean; healthy: boolean }

/**
 * A sovereign L1/L2 network in the Lux stack whose validator exporter is not yet
 * publishing into the hub — rendered as an honest COMING-SOON slot so the board is
 * visibly multi-network-ready. When an exporter starts emitting
 * `lux_network_validators_*{network="<id>"}` / `lux_validator_*{network="<id>"}`, that
 * network appears in the LIVE data-driven list (toNetworks) automatically and drops
 * out of here — no code change.
 *
 * White-label: labels here NEVER carry a foreign brand wordmark on the Lux surface.
 * The Lux-ecosystem L1s (Pars, Osage) are named; the L2 slots are keyed by their
 * neutral EVM chainId (a network fact, not a brand), never by company name.
 */
export type ComingSoonNetwork = { id: string; label: string; kind: 'L1' | 'L2' }
export const COMING_SOON_NETWORKS: ComingSoonNetwork[] = [
  { id: 'pars', label: 'Pars L1', kind: 'L1' },
  { id: 'osage', label: 'Osage L1', kind: 'L1' },
  { id: 'l2-a', label: 'Sovereign L2 · 36963', kind: 'L2' },
  { id: 'l2-b', label: 'Sovereign L2 · 200200', kind: 'L2' },
]

// ── Pure shapers (JSON-in → view-model-out; unit-tested without a live TSDB) ─────

const byLabel = (samples: Sample[], label: string): Map<string, number> => {
  const m = new Map<string, number>()
  for (const s of samples) {
    const k = s.metric[label]
    if (k !== undefined) m.set(k, s.value)
  }
  return m
}

/** A validator's honest liveness from up / bootstrapped / height (no uptime metric). */
export function livenessOf(up: boolean, bootstrapped: boolean, height: number | null): Liveness {
  if (!up) return 'down'
  if (!bootstrapped || !height || height <= 0) return 'bootstrapping'
  return 'live'
}

/** Order networks: the Lux primary (mainnet) first, then testnet, devnet, then the
 *  rest alphabetically — a stable, data-driven order as new networks appear. */
const NETWORK_ORDER: Record<string, number> = { mainnet: 0, testnet: 1, devnet: 2 }
const networkRank = (id: string): number => (id in NETWORK_ORDER ? NETWORK_ORDER[id] : 100)

/** Lux-neutral display label for a network id (no foreign brand ever rendered). */
export function networkLabel(id: string): string {
  if (id === 'mainnet') return 'Primary · Mainnet'
  if (id === 'testnet') return 'Testnet'
  if (id === 'devnet') return 'Devnet'
  return id.charAt(0).toUpperCase() + id.slice(1)
}

/** luxd-0 < luxd-1 < … numerically; unknown ids fall back to string order. */
const instanceRank = (id: string): number => {
  const m = /(\d+)$/.exec(id)
  return m ? Number(m[1]) : 1e9
}

/**
 * Fold the four per-instance validator series + the two per-network rollups into
 * ordered NetworkSummary[]. Networks and instances are DATA-DRIVEN from the labels
 * the metrics carry (so additional networks appear with no code change); the mainnet
 * primary sorts first. A metric absent for an instance is null (honest), never 0.
 */
export function toNetworks(
  up: Sample[],
  height: Sample[],
  peers: Sample[],
  bootstrapped: Sample[],
  netUp: Sample[],
  netTotal: Sample[],
): NetworkSummary[] {
  // network → instance → partial row.
  const nets = new Map<string, Map<string, ValidatorRow>>()
  const ensure = (network: string, instance: string): ValidatorRow => {
    let insts = nets.get(network)
    if (!insts) nets.set(network, (insts = new Map()))
    let row = insts.get(instance)
    if (!row) {
      row = { network, instance, up: false, bootstrapped: false, height: null, peers: null, liveness: 'down' }
      insts.set(instance, row)
    }
    return row
  }
  const walk = (samples: Sample[], apply: (row: ValidatorRow, v: number) => void) => {
    for (const s of samples) {
      const network = s.metric.network
      const instance = s.metric.instance
      if (!network || !instance) continue
      apply(ensure(network, instance), s.value)
    }
  }
  walk(up, (r, v) => (r.up = v === 1))
  walk(bootstrapped, (r, v) => (r.bootstrapped = v === 1))
  walk(height, (r, v) => (r.height = v))
  walk(peers, (r, v) => (r.peers = v))

  const upByNet = byLabel(netUp, 'network')
  const totalByNet = byLabel(netTotal, 'network')

  return Array.from(nets.entries())
    .map(([id, insts]) => {
      const validators = Array.from(insts.values())
        .map((r) => ({ ...r, liveness: livenessOf(r.up, r.bootstrapped, r.height) }))
        .sort((a, b) => instanceRank(a.instance) - instanceRank(b.instance) || a.instance.localeCompare(b.instance))
      return {
        id,
        label: networkLabel(id),
        primary: id === 'mainnet',
        validators,
        up: upByNet.has(id) ? (upByNet.get(id) as number) : null,
        total: totalByNet.has(id) ? (totalByNet.get(id) as number) : null,
      }
    })
    .sort((a, b) => networkRank(a.id) - networkRank(b.id) || a.id.localeCompare(b.id))
}

/** Node memory %, highest pressure first (the OOM view). */
export function toNodeMemory(samples: Sample[]): NodeMem[] {
  return samples
    .filter((s) => s.metric.node)
    .map((s) => ({ node: s.metric.node, pct: s.value }))
    .sort((a, b) => b.pct - a.pct)
}

/** Top pods by working-set memory, largest first. */
export function toTopPods(samples: Sample[]): PodMem[] {
  return samples
    .filter((s) => s.metric.pod)
    .map((s) => ({ pod: s.metric.pod, namespace: s.metric.namespace ?? '', bytes: s.value }))
    .sort((a, b) => b.bytes - a.bytes)
}

/**
 * Roll the workload replica series up to the named Lux services: AVAILABLE
 * (kube_deployment_status_replicas_available) over DESIRED (kube_deployment_spec_replicas)
 * for Deployments, and the ready/desired StatefulSet replicas for kms. Each service is
 * matched at its CANONICAL namespace, so a workload present in several namespaces
 * (explorer, lux-market) is counted ONCE. A service with no desired series is
 * `deployed:false` (honest 0/0), never a fabricated up. healthy ⟺ available ≥ desired > 0.
 */
export function toServices(
  deployAvailable: Sample[],
  deployDesired: Sample[],
  kmsReady: Sample[],
  kmsDesired: Sample[],
  services: readonly LuxService[] = LUX_SERVICES,
): ServiceStatus[] {
  const pick = (samples: Sample[], kind: LuxService['kind'], id: string, ns: string): number | undefined => {
    const nameLabel = kind === 'statefulset' ? 'statefulset' : 'deployment'
    const hit = samples.find((s) => s.metric.namespace === ns && s.metric[nameLabel] === id)
    return hit?.value
  }
  return services.map((svc) => {
    const availSamples = svc.kind === 'statefulset' ? kmsReady : deployAvailable
    const wantSamples = svc.kind === 'statefulset' ? kmsDesired : deployDesired
    const want = pick(wantSamples, svc.kind, svc.id, svc.ns)
    const avail = pick(availSamples, svc.kind, svc.id, svc.ns)
    const deployed = want !== undefined
    const total = want ?? 0
    const running = avail ?? 0
    return { service: svc.id, running, total, deployed, healthy: deployed && total > 0 && running >= total }
  })
}

// ── The board's data fetch (one round-trip fan-out, all instant queries) ─────────

export type LuxInfra = {
  networks: NetworkSummary[]
  nodes: NodeMem[]
  pods: PodMem[]
  services: ServiceStatus[]
}

export const LuxInfraApi = {
  /** Fetch the whole board in one fan-out. Any single miss rolls up to honest-empty. */
  load: async (): Promise<LuxInfra> => {
    const [up, height, peers, bootstrapped, netUp, netTotal, nodeMem, topPods, depAvail, depDesired, kmsReady, kmsDesired] =
      await Promise.all([
        TelemetryApi.instant(LUX_QUERIES.validatorUp),
        TelemetryApi.instant(LUX_QUERIES.validatorHeight),
        TelemetryApi.instant(LUX_QUERIES.validatorPeers),
        TelemetryApi.instant(LUX_QUERIES.validatorBootstrapped),
        TelemetryApi.instant(LUX_QUERIES.networkValidatorsUp),
        TelemetryApi.instant(LUX_QUERIES.networkValidatorsTotal),
        TelemetryApi.instant(LUX_QUERIES.nodeMemPct),
        TelemetryApi.instant(LUX_QUERIES.topPodMem),
        TelemetryApi.instant(LUX_QUERIES.deployAvailable),
        TelemetryApi.instant(LUX_QUERIES.deployDesired),
        TelemetryApi.instant(LUX_QUERIES.kmsReady),
        TelemetryApi.instant(LUX_QUERIES.kmsDesired),
      ])
    return {
      networks: toNetworks(up, height, peers, bootstrapped, netUp, netTotal),
      nodes: toNodeMemory(nodeMem),
      pods: toTopPods(topPods),
      services: toServices(depAvail, depDesired, kmsReady, kmsDesired),
    }
  },
}
