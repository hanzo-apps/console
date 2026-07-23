/**
 * Machines — pure domain logic (no React, fully unit-tested).
 *
 * HONEST DATA CONTRACT. The control plane (platform.hanzo.ai) exposes NO
 * per-machine / per-droplet / per-node REST route — the full `/v1` surface is
 * `apps`, `org/{org}/cluster`, and `org/{org}/.../container`. The real compute
 * inventory reachable by the console is therefore the org's DOKS clusters
 * (`GET /v1/org/{org}/cluster`), each carrying its `nodePools` (a pool = `count`
 * identical droplets of `size`).
 *
 * So a MACHINE here is one node of a real cluster pool. EVERY field on a
 * projected machine is either:
 *   - a real value from the cluster/pool the backend returned (region, type,
 *     status, group, created-at, k8s version, endpoint, tags), or
 *   - a deterministic function of a real value (vCPU/RAM parsed from the DO size
 *     slug; the monthly cost ESTIMATE from the same price table the platform
 *     bills from), or
 *   - explicitly `undefined` for facts the control plane does not expose
 *     (per-node live CPU%/MEM%/GPU/uptime/IP) — the UI renders those as "—".
 *
 * Nothing is fabricated: the row COUNT equals the real `nodeCount`, and per-node
 * metrics that don't exist are omitted, never invented.
 */
import type { Cluster, NodePool } from '~/lib/api'

/** Honest, derivable power-state of a node (from its cluster's status + phase). */
export type MachineStatus = 'online' | 'busy' | 'offline'

/** A single compute machine = one node of a real cluster pool. */
export type Machine = {
  /** Stable client id: `{clusterId}:{poolId}:{ordinal}`. */
  id: string
  /** Derived node label `{cluster}-{pool}-{ordinal}` (honest — not a DO hostname). */
  name: string
  /** The real cluster id (the only real identifier the control plane exposes). */
  instanceId: string
  clusterId: string
  poolId?: string
  poolName?: string
  /** The cluster this node belongs to — the natural group. */
  group: string
  /** Real region (DO region slug, e.g. `sfo3`). */
  region: string
  /** Real DO size slug (e.g. `s-4vcpu-8gb`). */
  type: string
  /** Parsed from the size slug; undefined when the slug is unrecognized. */
  vcpu?: number
  memGb?: number
  family: string
  status: MachineStatus
  /** Monthly USD ESTIMATE from the DO list price for `type`; undefined if unknown. */
  costMonthlyUsd?: number
  /** Cluster creation time (real ISO string); a lower bound, NOT node uptime. */
  createdAt?: string
  endpoint?: string
  k8sVersion?: string
  ha?: boolean
  active?: boolean
  tags: string[]
}

// ── Instance type (DO size slug) → vCPU / RAM ────────────────────────────────
// DO encodes vCPU and RAM in the slug (`s-4vcpu-8gb` = 4 vCPU / 8 GB). The
// CPU-Optimized `c-N` family has no in-slug RAM, so map those few explicitly
// (DO spec: 2 GB RAM per vCPU). Unrecognized slugs yield undefined (→ "—").
const EXPLICIT_SPEC: Record<string, { vcpu: number; memGb: number }> = {
  'c-2': { vcpu: 2, memGb: 4 },
  'c-4': { vcpu: 4, memGb: 8 },
  'c-8': { vcpu: 8, memGb: 16 },
  'c-16': { vcpu: 16, memGb: 32 },
  'c-2-4gb': { vcpu: 2, memGb: 4 },
  'c-4-8gb': { vcpu: 4, memGb: 8 },
  'c-8-16gb': { vcpu: 8, memGb: 16 },
}

const familyOf = (slug: string): string => {
  if (slug.startsWith('c-')) return 'CPU-Optimized'
  if (slug.startsWith('g-')) return 'General Purpose'
  if (slug.startsWith('m-')) return 'Memory-Optimized'
  if (slug.startsWith('so-')) return 'Storage-Optimized'
  if (slug.startsWith('s-')) return 'Basic'
  return slug ? 'Custom' : '—'
}

export type InstanceSpec = { vcpu?: number; memGb?: number; family: string; label: string }

/** Parse a DigitalOcean size slug into vCPU / RAM (pure; undefined when unknown). */
export function parseInstanceType(size: string | undefined): InstanceSpec {
  const slug = (size ?? '').toLowerCase()
  const family = familyOf(slug)
  let vcpu: number | undefined
  let memGb: number | undefined
  const m = slug.match(/(\d+)vcpu-(\d+)gb/)
  if (m) {
    vcpu = Number(m[1])
    memGb = Number(m[2])
  } else if (EXPLICIT_SPEC[slug]) {
    vcpu = EXPLICIT_SPEC[slug].vcpu
    memGb = EXPLICIT_SPEC[slug].memGb
  }
  const label = vcpu != null && memGb != null ? `${vcpu} vCPU · ${memGb} GB` : size || '—'
  return { vcpu, memGb, family, label }
}

// ── Cost estimate ────────────────────────────────────────────────────────────
// Mirrors the platform's OWN bill-from table
// (pkg/platform/src/services/doks-provisioner.ts `DO_NODE_SIZE_CENTS_PER_HOUR`).
// This is the real per-size hourly rate the control plane charges — not an
// invented number. We extrapolate to a MONTHLY ESTIMATE (730 h); the UI always
// labels it "est." and actuals live in Cost. Unknown size → undefined (→ "—").
const DO_NODE_SIZE_CENTS_PER_HOUR: Record<string, number> = {
  's-1vcpu-2gb': 3,
  's-2vcpu-2gb': 4,
  's-2vcpu-4gb': 5,
  's-4vcpu-8gb': 9,
  's-8vcpu-16gb': 17,
  's-2vcpu-8gb-amd': 7,
  's-4vcpu-16gb-amd': 14,
  's-8vcpu-32gb-amd': 28,
  'c-2': 9,
  'c-4': 18,
  'c-8': 36,
  'g-2vcpu-8gb': 8,
  'g-4vcpu-16gb': 16,
  'g-8vcpu-32gb': 32,
  'm-2vcpu-16gb': 16,
  'm-4vcpu-32gb': 32,
}

const HOURS_PER_MONTH = 730

/** Monthly USD estimate for one node of `size`, or undefined when unpriced. */
export function monthlyCostUsd(size: string | undefined): number | undefined {
  const cents = DO_NODE_SIZE_CENTS_PER_HOUR[(size ?? '').toLowerCase()]
  if (cents == null) return undefined
  return (cents * HOURS_PER_MONTH) / 100
}

// ── Status derivation ────────────────────────────────────────────────────────
/**
 * Derive a node's power-state from its cluster's REAL DO status + platform phase.
 * Only states we can honestly determine: online / busy (coming up) / offline.
 * "Idle" needs per-node workload telemetry the control plane does not expose, so
 * we never claim it.
 */
export function deriveMachineStatus(c: Pick<Cluster, 'status' | 'phase' | 'baselineError'>): MachineStatus {
  const s = (c.status ?? '').toLowerCase()
  const ph = (c.phase ?? '').toLowerCase()
  if (s === 'error' || ph === 'error' || c.baselineError) return 'offline'
  if (s === 'deleting' || s === 'deleted') return 'offline'
  if (s === 'running' && (ph === 'ready' || ph === '')) return 'online'
  return 'busy'
}

export const MACHINE_STATUS_LABEL: Record<MachineStatus, string> = {
  online: 'Online',
  busy: 'Busy',
  offline: 'Offline',
}

// ── Projection: clusters → machines ──────────────────────────────────────────
const poolsOf = (c: Cluster): NodePool[] => {
  if (c.nodePools && c.nodePools.length) return c.nodePools
  // Fallback for a flat shape (top-level nodeSize/nodeCount) — still real data.
  if (c.nodeSize) return [{ name: 'default', size: c.nodeSize, count: c.nodeCount ?? 1 }]
  return []
}

/** Project the org's real clusters into their constituent machine nodes. */
export function machinesFromClusters(clusters: Cluster[]): Machine[] {
  const out: Machine[] = []
  for (const c of clusters) {
    const clusterId = c.doksClusterId ?? c.id ?? c.name
    const status = deriveMachineStatus(c)
    const k8sVersion = c.k8sVersion ?? c.version ?? undefined
    for (const p of poolsOf(c)) {
      const size = p.size ?? c.nodeSize ?? ''
      const count = Math.max(0, Math.trunc(p.count ?? 0))
      const spec = parseInstanceType(size)
      const cost = monthlyCostUsd(size)
      const poolKey = p.poolId ?? p.name ?? 'pool'
      for (let i = 1; i <= count; i++) {
        out.push({
          id: `${clusterId}:${poolKey}:${i}`,
          name: `${c.name}-${p.name ?? 'pool'}-${i}`,
          instanceId: clusterId,
          clusterId,
          poolId: p.poolId,
          poolName: p.name,
          group: c.name,
          region: c.region ?? '',
          type: size,
          vcpu: spec.vcpu,
          memGb: spec.memGb,
          family: spec.family,
          status,
          costMonthlyUsd: cost,
          createdAt: c.createdAt,
          endpoint: c.endpoint ?? undefined,
          k8sVersion,
          ha: c.ha,
          active: c.active,
          tags: c.tags ?? [],
        })
      }
    }
  }
  return out
}

// ── Aggregates (Overview metric cards + donut) ───────────────────────────────
export type MachineSummary = {
  total: number
  online: number
  totalCores: number
  totalMemGb: number
  monthlyCostUsd: number
  /** False when some node's cost is unknown — UI shows the total as a lower bound. */
  costComplete: boolean
  byStatus: Record<MachineStatus, number>
}

export function summarize(machines: Machine[]): MachineSummary {
  let totalCores = 0
  let totalMemGb = 0
  let monthlyCostUsd = 0
  let online = 0
  let costComplete = true
  const byStatus: Record<MachineStatus, number> = { online: 0, busy: 0, offline: 0 }
  for (const m of machines) {
    byStatus[m.status] += 1
    if (m.status === 'online') online += 1
    if (m.vcpu != null) totalCores += m.vcpu
    if (m.memGb != null) totalMemGb += m.memGb
    if (m.costMonthlyUsd != null) monthlyCostUsd += m.costMonthlyUsd
    else costComplete = false
  }
  return { total: machines.length, online, totalCores, totalMemGb, monthlyCostUsd, costComplete, byStatus }
}

// ── Search + filters ─────────────────────────────────────────────────────────
export type MachineFilter = {
  q?: string
  group?: string
  region?: string
  status?: string
  type?: string
}

const matchesText = (m: Machine, q: string): boolean =>
  m.name.toLowerCase().includes(q) ||
  m.instanceId.toLowerCase().includes(q) ||
  m.group.toLowerCase().includes(q) ||
  m.region.toLowerCase().includes(q) ||
  m.type.toLowerCase().includes(q)

export function filterMachines(machines: Machine[], f: MachineFilter): Machine[] {
  const q = (f.q ?? '').trim().toLowerCase()
  return machines.filter((m) => {
    if (f.group && f.group !== 'all' && m.group !== f.group) return false
    if (f.region && f.region !== 'all' && m.region !== f.region) return false
    if (f.status && f.status !== 'all' && m.status !== f.status) return false
    if (f.type && f.type !== 'all' && m.type !== f.type) return false
    if (q && !matchesText(m, q)) return false
    return true
  })
}

/** Distinct, sorted values for a filter dropdown (e.g. groups, regions, types). */
export function distinct(machines: Machine[], key: 'group' | 'region' | 'type'): string[] {
  return Array.from(new Set(machines.map((m) => m[key]).filter(Boolean))).sort()
}

// ── Pagination (client-side over the real, filtered rows) ────────────────────
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}

export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = Math.max(0, page) * pageSize
  return rows.slice(start, start + pageSize)
}

// ── Presentation helpers (pure) ──────────────────────────────────────────────
const REGION_META: Record<string, { flag: string; label: string }> = {
  nyc: { flag: '🇺🇸', label: 'New York' },
  sfo: { flag: '🇺🇸', label: 'San Francisco' },
  ams: { flag: '🇳🇱', label: 'Amsterdam' },
  sgp: { flag: '🇸🇬', label: 'Singapore' },
  lon: { flag: '🇬🇧', label: 'London' },
  fra: { flag: '🇩🇪', label: 'Frankfurt' },
  tor: { flag: '🇨🇦', label: 'Toronto' },
  blr: { flag: '🇮🇳', label: 'Bangalore' },
  syd: { flag: '🇦🇺', label: 'Sydney' },
}

const regionMeta = (region: string): { flag: string; label: string } => {
  const key = (region ?? '').slice(0, 3).toLowerCase()
  return REGION_META[key] ?? { flag: '', label: region || '—' }
}

/** Flag emoji for a DO region slug ('' when unknown — the region code is real). */
export const regionFlag = (region: string): string => regionMeta(region).flag
/** Human city label for a DO region slug. */
export const regionLabel = (region: string): string => regionMeta(region).label

export const fmtUsd = (n: number): string =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ── Funding model — WHICH balance pays, per compute kind (pure, tested) ───────
// The single source of truth for the CPU-credit vs GPU-prepay-card distinction the
// customer sees. It mirrors — and never contradicts — what the server ENFORCES on
// launch (cloud-api launch + commerce charge):
//   - A CPU / non-GPU machine is metered to the org's granted **credit** balance —
//     NO card required. It launches on credits.
//   - A GPU is **prepay-only**, charged to the org's payment **card** with the first
//     hour upfront; granted credits can NOT fund a GPU, and no card ⇒ blocked.
// So the console shows the RIGHT funding source + the RIGHT add-funds CTA per kind,
// making it obvious that a non-GPU droplet IS credit-eligible.

/** Which balance funds a launch: the granted credit ledger, or a real payment card. */
export type FundingSource = 'credit' | 'card'

/** The customer-facing funding descriptor for a compute kind. */
export type FundingModel = {
  source: FundingSource
  /** Headline, e.g. "Launches on your Hanzo credit" / "Prepay only · charged to your card". */
  headline: string
  /** One-line detail (available balance / first-hour prepay / no-card note). */
  detail: string
  /** True when the funding source is empty and must be topped up first (add credits / add a card). */
  needsFunds: boolean
  /** The add-funds action for this source (credits → /wallet; card → /billing/credits). */
  cta: { label: string; href: string }
}

/** Whole-dollar credit figure with thousands separators, e.g. 2046235 → "$20,462". */
export function fmtCredit(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`
}

/**
 * Resolve the funding model for a compute kind. `creditCents` is the org's spendable
 * credit balance (undefined/null = not yet known → the note stays honest without a
 * figure); `hasCard` is whether a payment card is on file (GPU only). PURE.
 */
export function fundingModel(
  kind: 'cpu' | 'gpu',
  opts: { creditCents?: number | null; hasCard?: boolean | null } = {},
): FundingModel {
  if (kind === 'gpu') {
    // GPUs are real-money, card-prepay only — never the credit balance.
    const needsFunds = opts.hasCard === false
    return {
      source: 'card',
      headline: 'Prepay only · charged to your card',
      detail:
        'First hour charged upfront to your payment card, then the per-hour rate. Granted credits can’t be used for GPUs.',
      needsFunds,
      cta: { label: 'Add a payment card & prepay', href: '/billing/credits' },
    }
  }
  // CPU / non-GPU compute → the granted Hanzo credit balance, no card required.
  const credit = opts.creditCents
  const known = typeof credit === 'number' && Number.isFinite(credit)
  const needsFunds = known && (credit as number) <= 0
  const available = known && (credit as number) > 0 ? `${fmtCredit(credit as number)} available · ` : ''
  return {
    source: 'credit',
    headline: 'Launches on your Hanzo credit',
    detail: needsFunds
      ? 'Your credit balance is empty — add credits to launch. No card required.'
      : `${available}charged to credits · no card required.`,
    needsFunds,
    cta: { label: 'Add credits', href: '/wallet' },
  }
}

/** Render a GB quantity as GB, or TB when large. */
export function fmtMemGb(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} TB`
  return `${gb.toLocaleString()} GB`
}

/** "3d 4h" style age from an ISO timestamp (cluster age — labeled as such in UI). */
export function ageFrom(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const secs = Math.max(0, Math.floor((now - t) / 1000))
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const mn = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${mn}m`
  return `${mn}m`
}

/** One cluster's node total (sum of pool counts) — for the Groups tab. */
export function clusterNodeCount(c: Cluster): number {
  return poolsOf(c).reduce((n, p) => n + Math.max(0, Math.trunc(p.count ?? 0)), 0)
}
