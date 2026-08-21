/**
 * Pure fold from the org's live platform surface (its `/v1/platform/apps`, their
 * domains, and the managed data resources they reference) into the generic
 * `@hanzo/canvas` node/edge model. No React, no I/O — unit-tested in isolation.
 *
 * Honest by construction: every node is a thing the API actually returned, and
 * an edge is drawn ONLY where a real relationship exists —
 *   - domain → app: the host came straight off the app's own `domains` list.
 *   - app → app (dependency): an OBSERVED runtime service→service call from the
 *     o11y dependency graph (trace-derived). This is the REAL dependency signal —
 *     the platform store declares no service bindings — drawn only when both ends
 *     resolve to apps in the canvas.
 *   - app → resource / app → app (reference): an UNMASKED env-var value names the
 *     target's host or name (a genuine connection reference / declared intent).
 *     Secret values arrive masked, so they can't match; a drawn edge is a real
 *     link, never invented. An observed dependency supersedes a reference guess for
 *     the same pair. When no link is exposed, resources/apps sit unconnected.
 *
 * App nodes also carry a live requests sparkline (`metric`) folded from the o11y
 * per-service RED metrics; a service with no telemetry shows none (honest empty).
 */
import type { ServiceEdgeData, ServiceKind, ServiceMetric, ServiceNodeData } from '@hanzo/canvas/pure'
import { normalizeServiceStatus, toEpochMs } from '@hanzo/canvas/pure'

import type { PlatformApp } from '~/lib/api/platform-apps'
import { appImageRef } from './logic'
import { capabilityFor, inferAppCapability } from '~/lib/products/subsystems'

/** A managed data resource (one row of `/v1/provisioning/<kind>`), tagged with its kind. */
export interface CanvasResource {
  kind: string
  name: string
  status?: string
  host?: string
  port?: number
  database?: string
}

export interface CanvasInput {
  apps: PlatformApp[]
  resources: CanvasResource[]
}

export interface CanvasFilter {
  /** Project slug to scope to; omit / '' for all projects. */
  project?: string
  /** Environment to scope to; omit / '' for all environments. */
  env?: string
}

/**
 * One observed runtime dependency — a service→service call edge from the o11y
 * dependency graph (`/v1/o11y/dependency_graph`, trace-derived). `parent` calls
 * `child`; both are OpenTelemetry `service.name` values. This is REAL observed
 * dependency data (the platform store declares none), rendered as a solid
 * `dependency` edge ONLY where both endpoints resolve to apps in the canvas.
 */
export interface ServiceDepEdge {
  parent: string
  child: string
  callCount?: number
}

/**
 * Live signals folded onto the graph, fetched separately (o11y) so `buildProjectCanvas`
 * stays a pure fold. `metricByApp` keys the card's requests `ServiceMetric` by
 * `PlatformApp.id`; `serviceDeps` are the observed runtime dependencies.
 */
export interface CanvasExtras {
  metricByApp?: Map<string, ServiceMetric>
  serviceDeps?: ServiceDepEdge[]
}

export interface CanvasOption {
  id: string
  label: string
  count: number
}

export interface ProjectCanvasModel {
  nodes: ServiceNodeData[]
  edges: ServiceEdgeData[]
  projects: CanvasOption[]
  envs: CanvasOption[]
}

const RESOURCE_KIND: Record<string, ServiceKind> = {
  sql: 'database',
  datastore: 'database',
  docdb: 'database',
  vector: 'vector',
  kv: 'cache',
  search: 'search',
  s3: 'storage',
}
const RESOURCE_TYPE_LABEL: Record<string, string> = {
  sql: 'SQL database',
  vector: 'Vector store',
  kv: 'KV cache',
  search: 'Search index',
  s3: 'Object storage',
  datastore: 'Datastore',
  docdb: 'Document DB',
}

/** The app's authoritative lifecycle string — health verdict, then phase, then status. */
const appRaw = (a: PlatformApp): string => a.health || a.phase || a.status || ''

/** Extract `owner/name` from a git URL, else the raw ref. */
function repoRef(url: string | undefined): string {
  if (!url) return ''
  const m = /github\.com[/:]([^/]+\/[^/.]+)/i.exec(url)
  if (m) return m[1]
  return url.replace(/^https?:\/\//, '').replace(/\.git$/, '')
}

function appSource(a: PlatformApp): ServiceNodeData['source'] {
  if (a.source === 'image') {
    const ref = appImageRef(a)
    return ref ? { kind: 'image', ref } : undefined
  }
  const ref = repoRef(a.repo?.url)
  return ref ? { kind: 'repo', ref, branch: a.repo?.branch } : undefined
}

const appNodeId = (a: PlatformApp): string => `app:${a.id}`
const domainNodeId = (host: string): string => `dom:${host}`
const resourceNodeId = (r: CanvasResource): string => `res:${r.kind}:${r.name}`

function appNode(a: PlatformApp, metric?: ServiceMetric): ServiceNodeData {
  const raw = appRaw(a)
  return {
    id: appNodeId(a),
    name: a.name || a.slug || a.id,
    kind: 'app',
    status: normalizeServiceStatus(raw),
    statusLabel: (a.phase || a.status || raw) || undefined,
    typeLabel: 'App',
    source: appSource(a),
    replicas: a.replicas,
    deployedAt: toEpochMs(a.updatedAt),
    capability: inferAppCapability({ slug: a.slug, imageRepo: a.image?.repository, name: a.name }),
    href: '/app-platform',
    metric,
  }
}

/** repo basename, e.g. `hanzoai/api` → `api`. */
function repoBase(url: string | undefined): string {
  const ref = repoRef(url)
  return ref ? ref.split('/').pop() || '' : ''
}

/** The OTel `service.name` values an app might emit under (slug/name/repo basename). */
function serviceCandidates(a: PlatformApp): string[] {
  const out = new Set<string>()
  for (const c of [a.slug, a.name, repoBase(a.repo?.url), a.image?.repository?.split('/').pop()]) {
    const s = (c ?? '').trim().toLowerCase()
    if (s) out.add(s)
  }
  return [...out]
}

function resourceNode(r: CanvasResource): ServiceNodeData {
  const cap = capabilityFor(r.kind)
  return {
    id: resourceNodeId(r),
    name: r.name,
    kind: RESOURCE_KIND[r.kind] ?? 'database',
    status: normalizeServiceStatus(r.status),
    statusLabel: r.status || undefined,
    typeLabel: RESOURCE_TYPE_LABEL[r.kind] ?? r.kind,
    source: { kind: 'managed', ref: r.host || r.kind },
    capability: cap ?? undefined,
    href: `/${r.kind}`,
  }
}

/** Concatenated UNMASKED env values (secrets arrive as ''), lowercased. */
function refText(a: PlatformApp): string {
  const parts: string[] = []
  for (const e of a.env ?? []) if (e.value) parts.push(e.value)
  return parts.join('\n').toLowerCase()
}

/** True when `refs` names a target (host/name, ≥4 chars to avoid spurious matches). */
function references(refs: string, ...tokens: (string | undefined)[]): boolean {
  for (const t of tokens) {
    const s = (t ?? '').toLowerCase()
    if (s.length >= 4 && refs.includes(s)) return true
  }
  return false
}

function distinct(apps: PlatformApp[], pick: (a: PlatformApp) => string | undefined, label?: (id: string) => string): CanvasOption[] {
  const counts = new Map<string, number>()
  for (const a of apps) {
    const id = pick(a)
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return Array.from(counts, ([id, count]) => ({ id, label: label ? label(id) : id, count })).sort((x, y) =>
    x.id.localeCompare(y.id),
  )
}

/**
 * Build the project-canvas model. `projects`/`envs` are computed over ALL apps
 * (so the switchers show every option); `nodes`/`edges` are scoped to the filter.
 * Resources appear only when a visible app references them (honest linkage).
 *
 * `extras` folds live o11y signals onto the graph: `metricByApp` sets each app node's
 * card sparkline (real requests preview), and `serviceDeps` (the observed runtime
 * dependency graph) adds solid `dependency` edges between app nodes — a real observed
 * link supersedes the env-var-derived `reference` guess for the same pair.
 */
export function buildProjectCanvas(input: CanvasInput, filter: CanvasFilter = {}, extras: CanvasExtras = {}): ProjectCanvasModel {
  const projects = distinct(input.apps, (a) => a.projectSlug)
  const envs = distinct(input.apps, (a) => a.environment)

  const scoped = input.apps.filter(
    (a) => (!filter.project || a.projectSlug === filter.project) && (!filter.env || a.environment === filter.env),
  )

  const nodes: ServiceNodeData[] = []
  const edges: ServiceEdgeData[] = []

  // App nodes (with their real o11y requests sparkline, when present)
  for (const a of scoped) nodes.push(appNode(a, extras.metricByApp?.get(a.id)))

  // Domain nodes + route edges (first app to claim a host owns the node)
  const domainOwner = new Set<string>()
  for (const a of scoped) {
    const st = normalizeServiceStatus(appRaw(a))
    for (const host of a.domains ?? []) {
      const did = domainNodeId(host)
      if (!domainOwner.has(host)) {
        domainOwner.add(host)
        nodes.push({
          id: did,
          name: host,
          kind: 'domain',
          status: st,
          statusLabel: appRaw(a) || undefined,
          typeLabel: 'Domain',
          externalHref: `https://${host}`,
          href: '/app-platform',
        })
      }
      edges.push({ id: `${did}->${appNodeId(a)}`, source: did, target: appNodeId(a), reason: 'route' })
    }
  }

  // Referenced managed resources + reference edges (only where an env value links)
  const usedResource = new Map<string, CanvasResource>()
  for (const a of scoped) {
    const refs = refText(a)
    if (!refs) continue
    for (const r of input.resources) {
      if (references(refs, r.host, r.name, r.database)) {
        usedResource.set(resourceNodeId(r), r)
        edges.push({ id: `${appNodeId(a)}->${resourceNodeId(r)}`, source: appNodeId(a), target: resourceNodeId(r), reason: 'reference' })
      }
    }
    // app → app links (an env value names another visible app's host or name)
    for (const b of scoped) {
      if (b.id === a.id) continue
      const hosts = b.domains ?? []
      if (references(refs, b.name, b.slug, ...hosts)) {
        edges.push({ id: `${appNodeId(a)}~>${appNodeId(b)}`, source: appNodeId(a), target: appNodeId(b), reason: 'reference' })
      }
    }
  }
  for (const r of usedResource.values()) nodes.push(resourceNode(r))

  // Observed runtime dependencies (o11y dependency graph). Map each service→service
  // call edge onto app nodes by OTel service.name; draw a solid `dependency` edge ONLY
  // when BOTH endpoints resolve to apps in THIS canvas (so an edge is never drawn to a
  // service outside the scope, and cross-org names can't leak an edge). A real observed
  // link supersedes the env-var-derived `reference` guess for the same ordered pair.
  if (extras.serviceDeps && extras.serviceDeps.length > 0) {
    const svcToApp = new Map<string, string>()
    for (const a of scoped) for (const s of serviceCandidates(a)) if (!svcToApp.has(s)) svcToApp.set(s, appNodeId(a))

    const depPairs = new Set<string>()
    const depEdges: ServiceEdgeData[] = []
    for (const d of extras.serviceDeps) {
      const src = svcToApp.get((d.parent || '').toLowerCase())
      const dst = svcToApp.get((d.child || '').toLowerCase())
      if (!src || !dst || src === dst) continue
      const key = `${src}->${dst}`
      if (depPairs.has(key)) continue
      depPairs.add(key)
      depEdges.push({ id: `dep:${key}`, source: src, target: dst, reason: 'dependency' })
    }

    if (depEdges.length > 0) {
      // Drop an app→app reference edge when an observed dependency covers the same pair.
      const filtered = edges.filter(
        (e) =>
          !(e.reason === 'reference' && e.source.startsWith('app:') && e.target.startsWith('app:') && depPairs.has(`${e.source}->${e.target}`)),
      )
      filtered.push(...depEdges)
      return { nodes, edges: filtered, projects, envs }
    }
  }

  return { nodes, edges, projects, envs }
}

export interface CanvasSummary {
  services: number
  active: number
  deploying: number
  crashed: number
}

/** Header counts derived from the visible nodes (all real). */
export function summarizeCanvas(nodes: ServiceNodeData[]): CanvasSummary {
  const s: CanvasSummary = { services: 0, active: 0, deploying: 0, crashed: 0 }
  for (const n of nodes) {
    if (n.kind === 'domain') continue
    s.services++
    if (n.status === 'active') s.active++
    else if (n.status === 'deploying' || n.status === 'queued') s.deploying++
    else if (n.status === 'crashed') s.crashed++
  }
  return s
}
