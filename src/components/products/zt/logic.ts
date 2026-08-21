/**
 * Pure derivations for the Zero Trust overview — section counts, the mesh
 * topology, and the transport posture — computed from the REAL `/v1/network/*`
 * list payloads. No React, fully unit-tested.
 *
 * Honest by construction: a section that did not load (null rows) contributes a
 * `null` count (the UI renders an em-dash), never a guess, and the topology
 * contains only nodes that actually came back. The transport SUITE is a true
 * statement of the platform's post-quantum data plane (Hanzo zap), not telemetry.
 */

export type ZtSectionId = 'services' | 'routers'

export const ZT_SECTION_IDS: ZtSectionId[] = ['services', 'routers']

/** The fabric endpoint for a section — cloud's Zero Trust surface (HIP-0139). */
export const ZT_ENDPOINT: Record<ZtSectionId, string> = {
  services: 'network/services',
  routers: 'network/routers',
}

export type Row = Record<string, unknown>

/** A fetched section: rows when loaded (possibly empty), or null when it errored. */
export type ZtSections = Record<ZtSectionId, Row[] | null>

/** All sections unloaded — the initial/blank state. */
export const emptySections: ZtSections = {
  services: null,
  routers: null,
}

const firstString = (row: Row, keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = row[k]
    if (typeof v === 'string' && v) return v
  }
  return undefined
}

/** A human label for a row, preferring name/id/host/endpoint. */
export const rowName = (row: Row, fallback: string): string =>
  firstString(row, ['name', 'id', 'host', 'endpoint', 'service', 'identity']) ?? fallback

/** The row's status/state/health string, if any. */
export const rowStatus = (row: Row): string | undefined =>
  firstString(row, ['status', 'state', 'health'])

const LIVE = new Set(['active', 'online', 'healthy', 'up', 'connected', 'ready', 'available'])

/** Count a section: a number when loaded, null when it didn't load (→ em-dash). */
export const sectionCount = (rows: Row[] | null): number | null =>
  rows === null ? null : rows.length

/** True when EVERY section failed to load — the fabric isn't reachable from this host. */
export const allSectionsDown = (s: ZtSections): boolean =>
  ZT_SECTION_IDS.every((id) => s[id] === null)

/** How many rows look "live" (active/online/healthy/up/connected) — a health read. */
export const liveCount = (rows: Row[] | null): number =>
  (rows ?? []).filter((r) => LIVE.has((rowStatus(r) ?? '').toLowerCase())).length

export type ZtNodeKind = 'router' | 'service'
export type ZtNode = { id: string; name: string; kind: ZtNodeKind; status?: string }

/**
 * The mesh topology, left→right: routers (ingress) → services (targets). Only
 * real rows become nodes; each column is capped so the strip stays readable.
 * Empty columns are simply absent.
 */
export const deriveTopology = (s: ZtSections, perColumn = 6): Record<ZtNodeKind, ZtNode[]> => {
  const col = (rows: Row[] | null, kind: ZtNodeKind): ZtNode[] =>
    (rows ?? []).slice(0, perColumn).map((r, i) => ({
      id: `${kind}-${rowName(r, String(i))}`,
      name: rowName(r, `${kind} ${i + 1}`),
      kind,
      status: rowStatus(r),
    }))
  return {
    router: col(s.routers, 'router'),
    service: col(s.services, 'service'),
  }
}

export const topologyIsEmpty = (t: Record<ZtNodeKind, ZtNode[]>): boolean =>
  t.router.length === 0 && t.service.length === 0

/** The platform's post-quantum transport posture (a true capability statement). */
export type ZtPosture = {
  /** PQ suite securing the data plane — the platform's real transport crypto. */
  suite: string
  /** Key-exchange primitive. */
  kem: string
  /** Signature primitive. */
  sig: string
  /** Transport that carries it. */
  transport: string
}

export const POSTURE: ZtPosture = {
  suite: 'ML-KEM-768 · ML-DSA-65',
  kem: 'ML-KEM-768',
  sig: 'ML-DSA-65',
  transport: 'Hanzo zap',
}
