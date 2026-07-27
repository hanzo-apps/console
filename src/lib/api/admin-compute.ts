/**
 * Admin compute-analytics API — the SaaS operator view of the compute that `visor`
 * (github.com/hanzoai/vm) provisions, split into two `kind` lenses over ONE table:
 *
 *   - kind='machine' — raw VMs visor can open.
 *   - kind='bot'     — a machine running the @hanzo/bot agent (booted, gateway-connected).
 *
 * Each lens is grouped org → app → project. SOURCE: the unified datastore
 * (hanzoai/datastore) via cloud-api's `GET /v1/admin/compute?kind=` —
 * ONE cross-tenant GROUP BY over `hanzo.compute_events(org, app, project, kind,
 * event, machine_id, size, price_cents, ts)`, never a per-tenant SQLite fan-out
 * (the tenant-data-hierarchy invariant). The request goes through `originGet` — the
 * console's OWN origin (`<origin>/v1/admin/compute`), which `next.config.mjs`
 * rewrites to the GLOBAL-ADMIN-GATED `app/admin/aggregate` proxy (`getAdminGate`,
 * fail-closed 403, THEN a minted user bearer). The browser holds no admin credential.
 *
 * OPTIONAL-SAFE end to end (mirrors `admin-overview.ts`): the endpoint may return
 * PRE-AGGREGATED leaves (`{ leaves }` — the cheap datastore GROUP BY, the ONE way
 * cloud ships) OR raw event rows (`{ events }` — the exact datastore schema), which
 * pure `foldEvents` folds client-side. Either way `normalizeCompute` filters to the
 * requested `kind`, builds the org → app → project tree, and every missing field
 * degrades to a real empty/`0` — a kind with no compute, or a deployment where the
 * aggregate is not yet routed (`ApiError 404`), renders honest empties, NEVER a
 * fabricated fleet. Money is USD cents end to end.
 */
import { originGet } from './client'

/** A compute unit's kind: a raw machine, or a machine running the @hanzo/bot agent. */
export type ComputeKind = 'bot' | 'machine' | 'cluster' | 'nodepool' | 'function'

/** A raw compute event row — the datastore's coordinated 9-column shape. */
export type ComputeEvent = {
  org: string
  app: string
  project: string
  kind: ComputeKind | (string & {})
  /** provision | start | stop | destroy | resize | … */
  event: string
  machineId: string
  size: string
  /** The billed amount for this event, USD cents. */
  priceCents: number
  /** RFC3339 (UTC). */
  ts: string
}

/** A count of units at one size, within a leaf. */
export type SizeCount = { size: string; count: number }

/** Rolled-up figures shared by every tree level (for a single kind). */
export type Rollup = {
  /** Distinct units of this kind (bots, or machines). */
  count: number
  /** Currently-running units (latest event is non-terminal). */
  active: number
  /** Billed spend over the window, USD cents. */
  spendCents: number
}

/** A single org → app → project leaf for one kind. */
export type ComputeLeaf = Rollup & {
  org: string
  app: string
  project: string
  kind: ComputeKind
  /** Most recent event ts in the leaf (RFC3339); '' when unknown. */
  lastTs: string
  /** Unit count by size (desc by count). */
  sizes: SizeCount[]
}

export type ProjectNode = ComputeLeaf & { key: string }
export type AppNode = Rollup & { app: string; key: string; lastTs: string; projects: ProjectNode[] }
export type OrgNode = Rollup & { org: string; key: string; lastTs: string; apps: AppNode[] }

/** One kind's board: the org → app → project tree plus platform totals. */
export type ComputeFleets = { kind: ComputeKind; range: string; orgs: OrgNode[]; totals: Rollup }

// ── parsing helpers (optional-safe; mirror admin-overview.ts) ────────────────
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
/** First present of the given keys, camel- or snake-cased. */
const pick = (r: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null) return r[k]
  return undefined
}
/** The recognized compute spectrum; anything else falls back to `machine`
 *  (mirror of visor's Go `CanonicalKind`) so an unknown kind never pollutes a
 *  sibling board via `keepKind`. */
const KIND_SET = new Set<ComputeKind>(['bot', 'machine', 'cluster', 'nodepool', 'function'])
const asKind = (v: unknown): ComputeKind => {
  const k = str(v).trim().toLowerCase()
  return (KIND_SET as Set<string>).has(k) ? (k as ComputeKind) : 'machine'
}

/** Events whose LATEST occurrence means the unit is no longer running. */
const TERMINAL = new Set([
  'stop',
  'stopped',
  'destroy',
  'destroyed',
  'terminate',
  'terminated',
  'delete',
  'deleted',
  'off',
  'shutdown',
  'expire',
  'expired',
])
const isTerminal = (event: string): boolean => TERMINAL.has(event.trim().toLowerCase())

function normalizeEvent(raw: unknown): ComputeEvent {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    org: str(pick(r, 'org', 'orgId', 'org_id', 'owner')),
    app: str(pick(r, 'app', 'application', 'appId', 'app_id')),
    project: str(pick(r, 'project', 'projectId', 'project_id')),
    kind: asKind(pick(r, 'kind', 'unit', 'resource')),
    event: str(pick(r, 'event', 'action', 'type')),
    machineId: str(pick(r, 'machineId', 'machine_id', 'machine', 'id')),
    size: str(pick(r, 'size', 'sku', 'slug')),
    priceCents: num(pick(r, 'priceCents', 'price_cents', 'cents', 'amountCents', 'amount_cents')),
    ts: str(pick(r, 'ts', 'time', 'timestamp', 'createdAt', 'created_at')),
  }
}

const laterTs = (a: string, b: string): string => (a && b ? (a >= b ? a : b) : a || b)

/**
 * Fold raw compute events into per-(org, app, project) leaves — the pure client
 * equivalent of the datastore GROUP BY, used only when the endpoint returns raw
 * `events` (the aggregated `leaves` path skips this). Expects single-kind input
 * (the caller filters by `kind` first); the leaf's kind is taken from its events.
 * Distinct units by `machine_id`; a unit is `active` iff its LATEST event is
 * non-terminal; `spendCents` sums every event's `price_cents`; `sizes` counts
 * distinct units by their latest size. Deterministic + total.
 */
export function foldEvents(events: ComputeEvent[]): ComputeLeaf[] {
  type Unit = { latestTs: string; latestEvent: string; size: string }
  type Leaf = { org: string; app: string; project: string; kind: ComputeKind; spendCents: number; lastTs: string; units: Map<string, Unit> }
  const leaves = new Map<string, Leaf>()

  for (const e of events) {
    const kind = asKind(e.kind)
    const lk = `${e.org} ${e.app} ${e.project}`
    let leaf = leaves.get(lk)
    if (!leaf) {
      leaf = { org: e.org, app: e.app, project: e.project, kind, spendCents: 0, lastTs: '', units: new Map() }
      leaves.set(lk, leaf)
    }
    leaf.spendCents += e.priceCents
    leaf.lastTs = laterTs(leaf.lastTs, e.ts)
    const id = e.machineId || `${e.size}:${e.ts}` // synthetic id so a machine-less row still counts once
    const u = leaf.units.get(id)
    if (!u) {
      leaf.units.set(id, { latestTs: e.ts, latestEvent: e.event, size: e.size })
    } else if (!u.latestTs || e.ts >= u.latestTs) {
      u.latestTs = e.ts
      u.latestEvent = e.event
      if (e.size) u.size = e.size
    }
  }

  const out: ComputeLeaf[] = []
  for (const leaf of leaves.values()) {
    let active = 0
    const bySize = new Map<string, number>()
    for (const u of leaf.units.values()) {
      if (!isTerminal(u.latestEvent)) active++
      const s = u.size || 'unknown'
      bySize.set(s, (bySize.get(s) ?? 0) + 1)
    }
    const sizes = [...bySize.entries()]
      .map(([size, count]) => ({ size, count }))
      .sort((a, b) => b.count - a.count || a.size.localeCompare(b.size))
    out.push({
      org: leaf.org,
      app: leaf.app,
      project: leaf.project,
      kind: leaf.kind,
      count: leaf.units.size,
      active,
      spendCents: leaf.spendCents,
      lastTs: leaf.lastTs,
      sizes,
    })
  }
  return out
}

function normalizeLeaf(raw: unknown): ComputeLeaf {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    org: str(pick(r, 'org', 'orgId', 'org_id', 'owner')),
    app: str(pick(r, 'app', 'application', 'appId', 'app_id')),
    project: str(pick(r, 'project', 'projectId', 'project_id')),
    kind: asKind(pick(r, 'kind')),
    count: num(pick(r, 'count', 'machines', 'units', 'machineCount', 'machine_count')),
    active: num(pick(r, 'active', 'activeMachines', 'active_machines', 'running')),
    spendCents: num(pick(r, 'spendCents', 'spend_cents', 'cents', 'priceCents', 'price_cents')),
    lastTs: str(pick(r, 'lastTs', 'last_ts', 'ts', 'time')),
    sizes: arr(pick(r, 'sizes')).map((s) => {
      const sr = (s ?? {}) as Record<string, unknown>
      return { size: str(pick(sr, 'size', 'sku', 'slug')), count: num(pick(sr, 'count', 'n')) }
    }),
  }
}

/** A record looks like an event when it carries an `event`/`machine_id`. */
function looksLikeEvent(raw: unknown): boolean {
  const r = (raw ?? {}) as Record<string, unknown>
  return pick(r, 'event', 'action') !== undefined || pick(r, 'machineId', 'machine_id') !== undefined
}

const addRollup = (a: Rollup, b: Rollup): void => {
  a.count += b.count
  a.active += b.active
  a.spendCents += b.spendCents
}
const bySpendDesc = <T extends Rollup>(a: T, b: T): number => b.spendCents - a.spendCents || b.count - a.count

/** Group leaves into the org → app → project tree, rolling figures up each level. */
export function buildTree(leaves: ComputeLeaf[]): { orgs: OrgNode[]; totals: Rollup } {
  const orgs = new Map<string, OrgNode>()
  const apps = new Map<string, AppNode>()
  const totals: Rollup = { count: 0, active: 0, spendCents: 0 }

  for (const leaf of leaves) {
    const orgKey = leaf.org || '—'
    const appKey = `${orgKey} ${leaf.app || '—'}`
    let org = orgs.get(orgKey)
    if (!org) {
      org = { org: orgKey, key: orgKey, count: 0, active: 0, spendCents: 0, lastTs: '', apps: [] }
      orgs.set(orgKey, org)
    }
    let app = apps.get(appKey)
    if (!app) {
      app = { app: leaf.app || '—', key: appKey, count: 0, active: 0, spendCents: 0, lastTs: '', projects: [] }
      apps.set(appKey, app)
      org.apps.push(app)
    }
    // Consistent em-dash sentinel across all three levels — no blank labels render.
    const project: ProjectNode = {
      ...leaf,
      org: orgKey,
      app: app.app,
      project: leaf.project || '—',
      key: `${appKey} ${leaf.project || '—'}`,
    }
    app.projects.push(project)
    addRollup(app, leaf)
    addRollup(org, leaf)
    addRollup(totals, leaf)
    app.lastTs = laterTs(app.lastTs, leaf.lastTs)
    org.lastTs = laterTs(org.lastTs, leaf.lastTs)
  }

  const orgList = [...orgs.values()].sort(bySpendDesc)
  for (const org of orgList) {
    org.apps.sort(bySpendDesc)
    for (const app of org.apps) app.projects.sort(bySpendDesc)
  }
  return { orgs: orgList, totals }
}

/** Keep only the rows of the requested kind (defensive — the endpoint filters too). */
const keepKind = <T extends { kind?: unknown }>(rows: T[], kind: ComputeKind): T[] =>
  rows.filter((r) => {
    const k = str((r as { kind?: unknown }).kind).trim().toLowerCase()
    return k === '' || k === kind // untagged rows trusted (the ?kind query already filtered)
  })

/** Map an arbitrary `/v1/admin/compute` payload onto one kind's tree (optional-safe). */
export function normalizeCompute(raw: unknown, kind: ComputeKind): ComputeFleets {
  const r = (raw ?? {}) as Record<string, unknown>
  const range = str(pick(r, 'range')) || '30d'

  let leaves: ComputeLeaf[]
  const rawLeaves = pick(r, 'leaves', 'rows', 'fleets')
  const rawEvents = pick(r, 'events')
  if (Array.isArray(rawLeaves)) {
    leaves = keepKind(rawLeaves.map(normalizeLeaf), kind)
  } else if (Array.isArray(rawEvents)) {
    leaves = foldEvents(keepKind(rawEvents.map(normalizeEvent), kind))
  } else if (Array.isArray(raw)) {
    // A bare array (the /v1 envelope's `data`) — decide by the first element's shape.
    leaves = raw.length && looksLikeEvent(raw[0]) ? foldEvents(keepKind(raw.map(normalizeEvent), kind)) : keepKind(raw.map(normalizeLeaf), kind)
  } else {
    leaves = []
  }

  const { orgs, totals } = buildTree(leaves)
  return { kind, range, orgs, totals }
}

export type ComputeParams = {
  /** Which lens to load — `bot` or `machine`. Forwarded as `?kind=`. */
  kind: ComputeKind
  /** Lookback window; forwarded as `?range=`. Default `30d`. */
  range?: '24h' | '7d' | '30d'
}

export const AdminComputeApi = {
  /**
   * One kind's board (org → app → project units + spend). Throws a typed `ApiError`
   * (404 when the datastore aggregate isn't routed on this host) that the caller
   * renders as an honest state, never a fabricated fleet.
   */
  compute: async (p: ComputeParams): Promise<ComputeFleets> => {
    const data = await originGet<unknown>('admin/compute', { range: p.range ?? '30d', kind: p.kind })
    return normalizeCompute(data, p.kind)
  },
}
