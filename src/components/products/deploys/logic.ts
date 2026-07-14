/**
 * Pure deploy-plane logic — the ONE place a raw operator-CR status is folded into
 * the console's health/sync vocabulary, and a CR's owned-resource tree is mapped
 * into the generic `@hanzo/canvas` node/edge model. No React, no I/O — unit-tested
 * in isolation (`logic.test.ts`), so the transport layer (`lib/api/deploys.ts`)
 * and the views stay thin.
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
import { toEpochMs } from '@hanzo/canvas/pure'

import type { Deploy, DeployHealth, DeploySync, DeployTree, ResourceNode } from '~/lib/api/deploys'

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
  health?: DeployHealth
  phase?: string
  replicas?: number
  readyReplicas?: number
}): DeployHealth {
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
  sync?: DeploySync
  desiredTag?: string
  liveTag?: string
  health?: DeployHealth
}): DeploySync {
  if (input.sync && input.sync !== 'Unknown') return input.sync
  const desired = (input.desiredTag ?? '').trim()
  const live = (input.liveTag ?? '').trim()
  if (!desired || !live) return 'Unknown'
  if (desired === live) return 'Synced'
  return input.health === 'Progressing' ? 'Syncing' : 'OutOfSync'
}

/** Resolve a deploy's effective health + sync (server value refined by the fold). */
export function resolveDeploy(d: Deploy): { health: DeployHealth; sync: DeploySync } {
  const health = foldHealth(d)
  const sync = foldSync({ sync: d.sync, desiredTag: d.image.tag, liveTag: d.liveTag, health })
  return { health, sync }
}

// ── Palette (GitHub-family hues; shared with @hanzo/canvas semantics) ────────

const HEALTH_COLOR: Record<DeployHealth, string> = {
  Healthy: '#3fb950',
  Progressing: '#d29922',
  Degraded: '#f85149',
  Suspended: '#8b949e',
  Missing: '#6e7681',
  Unknown: '#8b949e',
}
const SYNC_COLOR: Record<DeploySync, string> = {
  Synced: '#3fb950',
  Syncing: '#d29922',
  OutOfSync: '#d29922',
  Unknown: '#8b949e',
}

export const healthColor = (h: DeployHealth): string => HEALTH_COLOR[h]
export const syncColor = (s: DeploySync): string => SYNC_COLOR[s]

/** Whether a health verdict should visually pulse (a live thing converging). */
export const healthPulses = (h: DeployHealth): boolean => h === 'Progressing'

// ── Board summary ────────────────────────────────────────────────────────────

export interface DeploySummary {
  total: number
  healthy: number
  progressing: number
  degraded: number
  synced: number
  outOfSync: number
}

/** Roll a deploy list into the header KPI counts (all real, from the folds). */
export function summarize(deploys: Deploy[]): DeploySummary {
  const s: DeploySummary = { total: 0, healthy: 0, progressing: 0, degraded: 0, synced: 0, outOfSync: 0 }
  for (const d of deploys) {
    const { health, sync } = resolveDeploy(d)
    s.total++
    if (health === 'Healthy') s.healthy++
    else if (health === 'Progressing') s.progressing++
    else if (health === 'Degraded' || health === 'Missing') s.degraded++
    if (sync === 'Synced') s.synced++
    else if (sync === 'OutOfSync') s.outOfSync++
  }
  return s
}

// ── Tree → @hanzo/canvas graph ───────────────────────────────────────────────

/** Map a health verdict onto the canvas status vocabulary (drives node tone). */
export function healthToServiceStatus(h: DeployHealth): ServiceStatus {
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
export function resourceHealth(n: ResourceNode): DeployHealth {
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
    deployedAt: n.createdAt ? toEpochMs(new Date(n.createdAt).toISOString()) : undefined,
  }
}

/**
 * Fold a CR's owned-resource tree into the `@hanzo/canvas` node/edge model. Edges
 * are owner→child (from `ownerRefs`, plus any explicit `edges`), drawn ONLY when
 * both endpoints are present in the node set — so the layered layout reads as the
 * ArgoCD-style left-to-right ownership flow (Service → Deployment → ReplicaSet →
 * Pods), and an edge is never drawn to a resource outside the tree.
 */
export function treeToGraph(tree: DeployTree): { nodes: ServiceNodeData[]; edges: ServiceEdgeData[] } {
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
export function treeHealth(tree: DeployTree): Record<DeployHealth, number> {
  const tally: Record<DeployHealth, number> = {
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
 * The image tags a CR can roll back to — its recorded revisions, MINUS the tag
 * currently declared (you never "roll back" to where you already are), newest
 * first, de-duplicated. Empty ⇒ the board shows an honest "no prior revisions".
 */
export function rollbackTargets(d: Deploy): string[] {
  const out: string[] = []
  const seen = new Set<string>([d.image.tag])
  for (const t of d.revisions) {
    const tag = t.trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}
