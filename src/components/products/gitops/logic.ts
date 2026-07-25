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
import type { ServiceEdgeData, ServiceKind, ServiceNodeData, ServiceStatus, XYPosition } from '@hanzo/canvas/pure'

import type { Application, AppTree, HealthStatus, ResourceNode, SyncStatus } from '~/lib/api/gitops'
import { inferAppCapability } from '~/lib/products/subsystems'
import type { Tone } from '~/components/ui/tone'
import { toneVar } from '~/components/ui/tone-var'

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

// ── Tone (the ONE console map — weight, never hue) ───────────────────────────

const HEALTH_TONE: Record<HealthStatus, Tone> = {
  Healthy: 'positive',
  Progressing: 'warning',
  Degraded: 'critical',
  Suspended: 'muted',
  Missing: 'muted',
  Unknown: 'muted',
}
const SYNC_TONE: Record<SyncStatus, Tone> = {
  Synced: 'positive',
  Syncing: 'warning',
  OutOfSync: 'warning',
  Unknown: 'muted',
}

export const healthColor = (h: HealthStatus): string => toneVar(HEALTH_TONE[h])
export const syncColor = (s: SyncStatus): string => toneVar(SYNC_TONE[s])

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

/**
 * A clean release semver `vX.Y.Z` (optionally `-suffix`) — the exact shape cloud's
 * `/v1/deploy/{name}/rollback` accepts (`paas.IsSemverTag`). The rollback dialog is
 * fed the app's git tags filtered by this, so a user can only pick a real prior
 * release (and cloud re-validates), never a fat-fingered arbitrary tag.
 */
const SEMVER_TAG_RE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
export const isReleaseTag = (tag: string): boolean => SEMVER_TAG_RE.test(tag.trim())

/**
 * Roll-backable release targets from an app's real git tags (or any candidate list):
 * clean semver only, the current declared tag removed, newest first, de-duplicated.
 * `newestFirst` sorts descending by semver so the most recent releases lead.
 */
export function releaseTargets(current: string, tags: string[]): string[] {
  const seen = new Set<string>([current.trim()])
  const out: string[] = []
  for (const raw of tags) {
    const tag = raw.trim()
    if (!tag || seen.has(tag) || !isReleaseTag(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out.sort(compareSemverDesc)
}

/** Descending semver compare (numeric parts), suffix-tolerant; non-semver sink last. */
export function compareSemverDesc(a: string, b: string): number {
  const pa = semverParts(a)
  const pb = semverParts(b)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i]
  return b.localeCompare(a)
}
function semverParts(tag: string): [number, number, number] {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [-1, -1, -1]
}

// ── Fleet map fold (Application[] → the @hanzo/canvas node model) ─────────────

/** The repo basename of an image repository, e.g. `ghcr.io/hanzoai/iam` → `iam`. */
export function repoBaseName(repository: string): string {
  const s = (repository || '').trim().replace(/:.*/, '')
  const base = s.split('/').filter(Boolean).pop() ?? ''
  return base.toLowerCase()
}

/** Per-repo git facts folded onto a node's source (from a single `GitApi.repos()`). */
export interface FleetGit {
  /** `owner/name` display ref for the SourceRef. */
  ref: string
  branch?: string
  /** Short HEAD sha, when known. */
  head?: string
}

/** Per-repo latest CI build (from a single `BuildsApi.list()`), for deploy time. */
export interface FleetBuild {
  status?: string
  /** Epoch ms of the build start, when known. */
  startedAt?: number
}

export interface FleetExtras {
  /** repoBase → git repo facts (source shows git repo+branch when present). */
  gitByRepo?: Map<string, FleetGit>
  /** repoBase → latest build (fills a node's deploy time when the CR reports none). */
  buildByRepo?: Map<string, FleetBuild>
}

/** A stable node id for a fleet app, namespaced by env so the same name across envs never collides. */
export const fleetNodeId = (a: Application): string => `app:${a.env || a.namespace}:${a.name}`

/**
 * Fold the fleet of `/v1/deploy` applications into `@hanzo/canvas` service nodes.
 * NODES ONLY — the App-CR dataset declares no in-band relationship between
 * applications, so no edge is invented (honest by construction; a resource-level
 * topology with real owner→child edges is the per-app drawer's `treeToGraph`).
 *
 * Node status is the authoritative CD health (never conflated with CI/build
 * status). `source` prefers the real git repo+branch (best-effort, from a single
 * repos read) and degrades to the declared image ref; `deployedAt` prefers the
 * CR's own change time and degrades to the latest build's start. Every node is a
 * thing `/v1/deploy` actually returned; missing enrichment never drops a node.
 */
export function foldFleet(apps: Application[], extras: FleetExtras = {}): ServiceNodeData[] {
  const sorted = [...apps].sort(
    (a, b) => (a.env || a.namespace).localeCompare(b.env || b.namespace) || a.name.localeCompare(b.name),
  )
  return sorted.map((a) => fleetNode(a, extras))
}

function fleetNode(a: Application, extras: FleetExtras): ServiceNodeData {
  const { health } = resolveApp(a)
  const base = repoBaseName(a.image.repository)
  const git = extras.gitByRepo?.get(base)
  const build = extras.buildByRepo?.get(base)
  return {
    id: fleetNodeId(a),
    name: a.name,
    kind: 'app',
    status: healthToServiceStatus(health),
    statusLabel: a.phase || health,
    typeLabel: a.role ? a.role.charAt(0).toUpperCase() + a.role.slice(1) : 'App',
    source: appSource(a, git),
    capability: inferAppCapability({ slug: a.name, imageRepo: a.image.repository, name: a.name }),
    deployedAt: a.updatedAt || build?.startedAt || undefined,
    region: a.env || undefined,
    href: `/gitops/${encodeURIComponent(a.name)}`,
  }
}

/** A node's source: the real git repo+branch when enriched, else the declared image ref. */
function appSource(a: Application, git?: FleetGit): ServiceNodeData['source'] {
  if (git?.ref) return { kind: 'repo', ref: git.ref, branch: git.branch }
  const repo = a.image.repository
  if (!repo) return undefined
  return { kind: 'image', ref: a.image.tag ? `${repo}:${a.image.tag}` : repo }
}

/**
 * Deterministic squarish GRID positions for the fleet nodes (id → x/y). The fleet
 * has no edges, so the edge-driven layered layout would stack everything in one
 * column; a grid reads as a clean Railway board and `ProjectCanvas` fitView scales
 * it to any viewport (touch pan/zoom on mobile). Byte-identical for the same ids.
 */
export function gridPositions(
  ids: string[],
  opts: { cols?: number; colGap?: number; rowGap?: number } = {},
): Record<string, XYPosition> {
  const n = ids.length
  const cols = Math.max(1, opts.cols ?? Math.ceil(Math.sqrt(n)))
  const colGap = opts.colGap ?? 320
  const rowGap = opts.rowGap ?? 152
  const pos: Record<string, XYPosition> = {}
  ids.forEach((id, i) => {
    pos[id] = { x: (i % cols) * colGap, y: Math.floor(i / cols) * rowGap }
  })
  return pos
}
