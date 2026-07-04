/**
 * Map graph — the PURE fold from the org's live deployment landscape (its apps,
 * its managed data resources, and the domains that front them) into a node/edge
 * graph plus a deterministic layout. No React, no DOM, no `fetch` — this is the
 * one place the topology is DERIVED, so it is unit-tested in isolation.
 *
 * Honesty is the whole point: every node is a thing the API actually returned,
 * and an edge is drawn ONLY where a real relationship exists —
 *   - domain → app: the host came straight off the app's own `domains` list.
 *   - app → resource: an app env var's UNMASKED value names the resource's host
 *     or name (a genuine connection reference). Secret values arrive masked, so
 *     they can't match; a drawn edge is therefore a real link, never invented.
 * When no linkage is exposed, resources simply sit in their own tier — grouped,
 * not connected. We never fabricate an edge to make the picture look busier.
 */
import type { PaasApp, PaasProject } from '~/lib/api/paas'
import type { Resource, ResourceKind } from '~/lib/api/provisioning'

/** The three tiers of the landscape. */
export type MapNodeKind = 'domain' | 'app' | 'resource'

/** Normalized status → the one thing the status dot renders. */
export type NodeStatus = 'ok' | 'building' | 'error' | 'idle'

/** An app carrying (optional) project context — what `listAllApps` returns. */
export type MapApp = PaasApp & { project?: PaasProject }

/** A managed resource tagged with the kind it was listed under. */
export type ResourceWithKind = Resource & { kind: ResourceKind }

/** The composite the graph is built from — one org-scoped read. */
export interface MapInput {
  apps: MapApp[]
  resources: ResourceWithKind[]
}

/** A single detail row shown in the side panel. */
export interface DetailRow {
  label: string
  value: string
}

/** Everything a node card + its detail panel needs — no back-references. */
export interface MapNodeData {
  kind: MapNodeKind
  /** Display name: the host, the app name, or the resource name. */
  label: string
  status: NodeStatus
  /** The raw lifecycle string the API reported (shown verbatim in the panel). */
  rawStatus?: string
  /** Present on resource nodes — drives the icon + a `/sql`-style deep link. */
  resourceKind?: ResourceKind
  /** One-line key fact under the title. */
  fact?: string
  /** Registry product id to deep-link to (`app-platform`, `sql`, …). */
  productId: string
  /** External URL for a domain node ("Open site"). */
  href?: string
  detail: DetailRow[]
}

export interface MapNode {
  id: string
  data: MapNodeData
}

/** Provenance keeps edges honest: `route` = domain→app, `reference` = env link. */
export type EdgeReason = 'route' | 'reference'

export interface MapEdge {
  id: string
  source: string
  target: string
  reason: EdgeReason
}

export interface MapGraph {
  nodes: MapNode[]
  edges: MapEdge[]
}

/** Per-kind display label + the product page each resource deep-links to. */
const RESOURCE_META: Record<ResourceKind, { label: string; productId: string }> = {
  sql: { label: 'SQL', productId: 'sql' },
  vector: { label: 'Vector', productId: 'vector' },
  kv: { label: 'KV', productId: 'kv' },
  search: { label: 'Search', productId: 'search' },
  s3: { label: 'S3', productId: 's3' },
  datastore: { label: 'Datastore', productId: 'datastore' },
  docdb: { label: 'DocDB', productId: 'docdb' },
}

const OK = new Set(['live', 'running', 'ready', 'active', 'available', 'ok', 'succeeded', 'connected', 'green', 'healthy'])
const BUILDING = new Set(['building', 'deploying', 'creating', 'provisioning', 'pending', 'updating', 'attaching', 'queued', 'starting', 'yellow'])
const ERROR = new Set(['error', 'failed', 'degraded', 'down', 'canceled', 'cancelled', 'red', 'unhealthy', 'crashloopbackoff'])

/**
 * Normalize a free-form lifecycle/health string to a status tone. Same tone
 * vocabulary as the console's `StatusTag`, so the map reads identically to every
 * list. An empty/unknown string is honest `idle` — never guessed up to `ok`.
 */
export function normalizeStatus(raw: string | undefined): NodeStatus {
  const s = (raw ?? '').toLowerCase().trim()
  if (!s) return 'idle'
  if (OK.has(s)) return 'ok'
  if (BUILDING.has(s)) return 'building'
  if (ERROR.has(s)) return 'error'
  return 'idle'
}

/** The app's authoritative lifecycle string — operator phase wins, then status, then health. */
const appRawStatus = (app: MapApp): string => app.phase || app.status || app.health || ''

const appNodeId = (app: MapApp): string => `app:${app.id}`
const domainNodeId = (host: string): string => `domain:${host}`
const resourceNodeId = (r: ResourceWithKind): string => `resource:${r.kind}:${r.name}`

/** Concatenated UNMASKED env values (secrets arrive as ""), lowercased for matching. */
function referenceText(app: MapApp): string {
  const parts: string[] = []
  for (const e of app.env ?? []) if (e.value) parts.push(e.value)
  return parts.join('\n').toLowerCase()
}

/**
 * True when an app genuinely references a resource — its host or name appears in
 * an unmasked env value. Short strings (< 4 chars) are ignored so a name like
 * "db" can't spuriously match; this favors false-negatives (a missing edge) over
 * a fabricated one.
 */
function referencesResource(refsLower: string, r: ResourceWithKind): boolean {
  const host = (r.host ?? '').toLowerCase()
  if (host.length >= 4 && refsLower.includes(host)) return true
  const name = (r.name ?? '').toLowerCase()
  if (name.length >= 4 && refsLower.includes(name)) return true
  return false
}

/** Build the honest node/edge graph from the org's live landscape. */
export function buildGraph(input: MapInput): MapGraph {
  const nodes: MapNode[] = []
  const edges: MapEdge[] = []

  // ── App nodes ────────────────────────────────────────────────────────────
  for (const app of input.apps) {
    const raw = appRawStatus(app)
    const domains = app.domains ?? []
    const replicas = app.replicas ?? 1
    nodes.push({
      id: appNodeId(app),
      data: {
        kind: 'app',
        label: app.name || app.slug || app.id,
        status: normalizeStatus(raw),
        rawStatus: raw || undefined,
        productId: 'app-platform',
        fact: `${replicas}× · ${app.source ?? 'app'}`,
        detail: [
          { label: 'Project', value: app.project?.name || app.projectId || '—' },
          { label: 'Status', value: raw || 'unknown' },
          { label: 'Replicas', value: String(replicas) },
          { label: 'Source', value: app.source || '—' },
          ...(app.environment ? [{ label: 'Environment', value: app.environment }] : []),
          ...(domains.length ? [{ label: 'Domains', value: String(domains.length) }] : []),
        ],
      },
    })
  }

  // ── Domain (entry) nodes + route edges (domain → app) ────────────────────
  // Hosts come straight off each app's `domains`; a host fronts an app only if
  // that app lists it. A domain serves only when its app is up, so it inherits
  // the app's status. First app to claim a host owns the node (shared hosts rare).
  const domainOwner = new Set<string>()
  for (const app of input.apps) {
    const status = normalizeStatus(appRawStatus(app))
    for (const host of app.domains ?? []) {
      const did = domainNodeId(host)
      if (!domainOwner.has(host)) {
        domainOwner.add(host)
        nodes.push({
          id: did,
          data: {
            kind: 'domain',
            label: host,
            status,
            productId: 'app-platform',
            href: `https://${host}`,
            fact: 'Entry point',
            detail: [
              { label: 'Host', value: host },
              { label: 'Routes to', value: app.name || app.slug || app.id },
            ],
          },
        })
      }
      edges.push({ id: `${did}->${appNodeId(app)}`, source: did, target: appNodeId(app), reason: 'route' })
    }
  }

  // ── Resource nodes ───────────────────────────────────────────────────────
  for (const r of input.resources) {
    const meta = RESOURCE_META[r.kind]
    const hostPort = r.host ? `${r.host}${r.port ? `:${r.port}` : ''}` : '—'
    nodes.push({
      id: resourceNodeId(r),
      data: {
        kind: 'resource',
        label: r.name,
        status: normalizeStatus(r.status),
        rawStatus: r.status || undefined,
        resourceKind: r.kind,
        productId: meta.productId,
        fact: meta.label,
        detail: [
          { label: 'Kind', value: meta.label },
          { label: 'Status', value: r.status || 'unknown' },
          { label: 'Endpoint', value: hostPort },
          ...(r.database ? [{ label: 'Database', value: r.database }] : []),
        ],
      },
    })
  }

  // ── App → resource reference edges (only where a real link is exposed) ────
  for (const app of input.apps) {
    const refs = referenceText(app)
    if (!refs) continue
    for (const r of input.resources) {
      if (referencesResource(refs, r)) {
        edges.push({
          id: `${appNodeId(app)}->${resourceNodeId(r)}`,
          source: appNodeId(app),
          target: resourceNodeId(r),
          reason: 'reference',
        })
      }
    }
  }

  return nodes.length ? { nodes, edges } : { nodes: [], edges: [] }
}

/** A node with its computed canvas coordinates. */
export interface PositionedNode extends MapNode {
  position: { x: number; y: number }
}

/** Tier x-offsets and row pitch — the layout constants. */
export const TIER_X: Record<MapNodeKind, number> = { domain: 0, app: 380, resource: 780 }
const ROW_H = 132

/**
 * Deterministic three-tier layered layout: domains left, apps center, resources
 * right. Within a tier, nodes are ordered by id and stacked; tiers are centered
 * on a shared vertical axis so they read as columns. Pure and stable — the same
 * graph always yields byte-identical positions (tested), no randomness.
 */
export function layout(graph: MapGraph): PositionedNode[] {
  const byKind: Record<MapNodeKind, MapNode[]> = { domain: [], app: [], resource: [] }
  for (const n of graph.nodes) byKind[n.data.kind].push(n)
  for (const kind of Object.keys(byKind) as MapNodeKind[]) {
    byKind[kind].sort((a, b) => a.id.localeCompare(b.id))
  }

  const rows = Math.max(byKind.domain.length, byKind.app.length, byKind.resource.length, 1)
  const axis = ((rows - 1) * ROW_H) / 2

  const out: PositionedNode[] = []
  for (const kind of ['domain', 'app', 'resource'] as const) {
    const list = byKind[kind]
    const top = axis - ((list.length - 1) * ROW_H) / 2
    list.forEach((n, i) => out.push({ ...n, position: { x: TIER_X[kind], y: top + i * ROW_H } }))
  }
  return out
}

export interface MapSummary {
  apps: number
  resources: number
  domains: number
  running: number
  issues: number
}

/** Roll the graph up into the header counts (apps · data · domains + health). */
export function summarize(graph: MapGraph): MapSummary {
  const s: MapSummary = { apps: 0, resources: 0, domains: 0, running: 0, issues: 0 }
  for (const n of graph.nodes) {
    if (n.data.kind === 'app') s.apps++
    else if (n.data.kind === 'resource') s.resources++
    else s.domains++
    if (n.data.status === 'ok') s.running++
    if (n.data.status === 'error') s.issues++
  }
  return s
}
