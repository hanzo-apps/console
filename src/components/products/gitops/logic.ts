/**
 * Pure GitOps logic — the ONE place a raw operator-CR status is folded into the
 * console's health/sync vocabulary, and an application's owned-resource tree is
 * mapped into the generic `@hanzo/canvas` node/edge model. No React, no I/O —
 * unit-tested in isolation (`logic.test.ts`), so the transport layer
 * (`lib/api/gitops.ts`) and the views stay thin, and so these folds/adapters can
 * feed either the interim console board or the `@hanzo/ui/gitops` components when
 * that package lands.
 *
 * Health mirrors ArgoCD's small glanceable set, folded from the CR `.status`
 * (phase + ready/desired replicas). Sync compares the DESIRED image tag
 * (CR `spec.image.tag`) against the LIVE running tag: agreement = Synced, a
 * mismatch = OutOfSync (Syncing while the reconcile is still in flight). A
 * server-computed `health`/`sync` (when cloud provides one) is trusted verbatim;
 * `Unknown` means "derive it here".
 *
 * Honest by construction: a missing signal is never guessed up to Healthy — an
 * empty phase with no replica data folds to `Unknown`.
 */
import type { ServiceEdgeData, ServiceKind, ServiceNodeData, ServiceStatus } from '@hanzo/canvas/pure'

import type { Application, AppTree, HealthStatus, ResourceNode, SyncStatus } from '~/lib/api/gitops'

// ── Health fold ──────────────────────────────────────────────────────────────

/** The CR `.status.phase` values that mean "actively converging". */
const PROGRESSING_PHASES = new Set(['pending', 'creating', 'deleting', 'progressing', 'updating'])

/**
 * Fold a CR's status into a health verdict. A server-supplied `health` (other
 * than `Unknown`) wins; otherwise derive from phase + replicas:
 *   - phase `Degraded`                         → Degraded
 *   - `Running` with 0 ready but ≥1 desired    → Degraded (up but nothing serving)
 *   - `Running` with ready < desired           → Progressing (partial rollout)
 *   - `Running` fully ready (or 0 desired)      → Healthy
 *   - Pending/Creating/Deleting/Updating       → Progressing
 *   - unknown/empty                            → Unknown (never guessed up)
 */
export function foldHealth(input: {
  health?: HealthStatus
  phase?: string
  replicas?: number
  readyReplicas?: number
}): HealthStatus {
  if (input.health && input.health !== 'Unknown') return input.health
  const phase = (input.phase ?? '').trim().toLowerCase()
  const desired = input.replicas ?? 0
  const ready = input.readyReplicas ?? 0

  if (phase === 'degraded' || phase === 'failed' || phase === 'error') return 'Degraded'
  if (phase === 'suspended' || phase === 'paused') return 'Suspended'
  if (phase === 'running' || phase === 'ready' || phase === 'available' || phase === 'healthy') {
    if (desired > 0 && ready === 0) return 'Degraded'
    if (desired > 0 && ready < desired) return 'Progressing'
    return 'Healthy'
  }
  if (PROGRESSING_PHASES.has(phase)) return 'Progressing'
  // No phase but replica data present — infer from it rather than blank Unknown.
  if (desired > 0) return ready >= desired ? 'Healthy' : ready === 0 ? 'Degraded' : 'Progressing'
  return 'Unknown'
}

// ── Sync fold ────────────────────────────────────────────────────────────────

/**
 * Fold desired-vs-live into a sync verdict. A server-supplied `sync` (other than
 * `Unknown`) wins; otherwise compare the desired CR tag to the live running tag:
 *   - equal                                     → Synced
 *   - differ, reconcile still in flight (health Progressing) → Syncing
 *   - differ, settled                           → OutOfSync
 *   - live tag unknown                          → Unknown
 */
export function foldSync(input: {
  sync?: SyncStatus
  desiredTag?: string
  liveTag?: string
  health?: HealthStatus
}): SyncStatus {
  if (input.sync && input.sync !== 'Unknown') return input.sync
  const desired = (input.desiredTag ?? '').trim()
  const live = (input.liveTag ?? '').trim()
  if (!desired || !live) return 'Unknown'
  if (desired === live) return 'Synced'
  return input.health === 'Progressing' ? 'Syncing' : 'OutOfSync'
}

/** Resolve an application's effective health + sync (server value refined by the fold). */
export function resolveApp(a: Application): { health: HealthStatus; sync: SyncStatus } {
  const health = foldHealth(a)
  const sync = foldSync({ sync: a.sync, desiredTag: a.image.tag, liveTag: a.liveTag, health })
  return { health, sync }
}

// ── Palette (GitHub-family hues; shared with @hanzo/canvas semantics) ────────

const HEALTH_COLOR: Record<HealthStatus, string> = {
  Healthy: '#3fb950',
  Progressing: '#d29922',
  Degraded: '#f85149',
  Suspended: '#8b949e',
  Missing: '#6e7681',
  Unknown: '#8b949e',
}
const SYNC_COLOR: Record<SyncStatus, string> = {
  Synced: '#3fb950',
  Syncing: '#d29922',
  OutOfSync: '#d29922',
  Unknown: '#8b949e',
}

export const healthColor = (h: HealthStatus): string => HEALTH_COLOR[h]
export const syncColor = (s: SyncStatus): string => SYNC_COLOR[s]

/** Whether a health verdict should visually pulse (a live thing converging). */
export const healthPulses = (h: HealthStatus): boolean => h === 'Progressing'

// ── Board summary ────────────────────────────────────────────────────────────

export interface AppSummary {
  total: number
  healthy: number
  progressing: number
  degraded: number
  synced: number
  outOfSync: number
}

/** Roll an application list into the header KPI counts (all real, from the folds). */
export function summarize(apps: Application[]): AppSummary {
  const s: AppSummary = { total: 0, healthy: 0, progressing: 0, degraded: 0, synced: 0, outOfSync: 0 }
  for (const a of apps) {
    const { health, sync } = resolveApp(a)
    s.total++
    if (health === 'Healthy') s.healthy++
    else if (health === 'Progressing') s.progressing++
    else if (health === 'Degraded' || health === 'Missing') s.degraded++
    if (sync === 'Synced') s.synced++
    else if (sync === 'OutOfSync') s.outOfSync++
  }
  return s
}

// ── Tree → @hanzo/canvas graph (the adapter that feeds a topology component) ──

/** Map a health verdict onto the canvas status vocabulary (drives node tone). */
export function healthToServiceStatus(h: HealthStatus): ServiceStatus {
  switch (h) {
    case 'Healthy':
      return 'active'
    case 'Progressing':
      return 'deploying'
    case 'Degraded':
      return 'crashed'
    case 'Suspended':
      return 'sleeping'
    case 'Missing':
      return 'removed'
    default:
      return 'unknown'
  }
}

/** Map a k8s Kind onto a canvas ServiceKind (drives the default glyph/tint). */
export function kindToServiceKind(kind: string): ServiceKind {
  switch (kind) {
    case 'Service': // the operator CR (hanzo.ai/v1) — top of the tree
    case 'Deployment':
    case 'StatefulSet':
    case 'DaemonSet':
      return 'app'
    case 'ReplicaSet':
    case 'Pod':
    case 'Job':
      return 'worker'
    case 'CronJob':
    case 'HorizontalPodAutoscaler':
      return 'cron'
    case 'Ingress':
    case 'Certificate':
      return 'domain'
    case 'ConfigMap':
    case 'Secret':
      return 'storage'
    case 'PersistentVolumeClaim':
      return 'database'
    default:
      return 'service'
  }
}

/** Per-resource health — trust its own verdict, else infer from ready/desired. */
export function resourceHealth(n: ResourceNode): HealthStatus {
  return foldHealth({ health: n.health, phase: n.phase, replicas: n.replicas, readyReplicas: n.readyReplicas })
}

function resourceNode(n: ResourceNode): ServiceNodeData {
  const health = resourceHealth(n)
  const replicaLabel = n.replicas > 0 ? `${n.readyReplicas}/${n.replicas} ready` : ''
  return {
    id: n.ref,
    name: n.name,
    kind: kindToServiceKind(n.kind),
    status: healthToServiceStatus(health),
    statusLabel: n.phase || replicaLabel || health,
    // The exact k8s Kind under the name — also the key the icon renderer maps on.
    typeLabel: n.kind,
    replicas: n.replicas || undefined,
    // `createdAt` is already epoch ms (the client parses the k8s timestamp) — the
    // `deployedAt` a canvas node renders as relative time.
    deployedAt: n.createdAt || undefined,
  }
}

/**
 * Fold an application's owned-resource tree into the `@hanzo/canvas` node/edge
 * model. Edges are owner→child (from `ownerRefs`, plus any explicit `edges`),
 * drawn ONLY when both endpoints are present in the node set — so the layered
 * layout reads as the ArgoCD-style left-to-right ownership flow (Service →
 * Deployment → ReplicaSet → Pods), and an edge is never drawn to a resource
 * outside the tree.
 */
export function treeToGraph(tree: AppTree): { nodes: ServiceNodeData[]; edges: ServiceEdgeData[] } {
  const nodes = tree.nodes.map(resourceNode)
  const present = new Set(tree.nodes.map((n) => n.ref))
  const seen = new Set<string>()
  const edges: ServiceEdgeData[] = []

  const add = (from: string, to: string) => {
    if (!from || !to || from === to || !present.has(from) || !present.has(to)) return
    const id = `${from}->${to}`
    if (seen.has(id)) return
    seen.add(id)
    edges.push({ id, source: from, target: to, reason: 'dependency' })
  }

  for (const n of tree.nodes) for (const owner of n.ownerRefs) add(owner, n.ref)
  for (const e of tree.edges) add(e.from, e.to)

  return { nodes, edges }
}

/** Health tally over a tree's resources (for the detail header). */
export function treeHealth(tree: AppTree): Record<HealthStatus, number> {
  const tally: Record<HealthStatus, number> = {
    Healthy: 0,
    Progressing: 0,
    Degraded: 0,
    Suspended: 0,
    Missing: 0,
    Unknown: 0,
  }
  for (const n of tree.nodes) tally[resourceHealth(n)]++
  return tally
}

// ── Rollback affordance ──────────────────────────────────────────────────────

/**
 * The image tags an application can roll back to — its recorded revisions, MINUS
 * the tag currently declared (you never "roll back" to where you already are),
 * newest first, de-duplicated. Empty ⇒ the board shows an honest "no prior
 * revisions".
 */
export function rollbackTargets(a: Application): string[] {
  const out: string[] = []
  const seen = new Set<string>([a.image.tag])
  for (const t of a.revisions) {
    const tag = t.trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}
