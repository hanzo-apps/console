/**
 * Pure derivations for the Zero Trust overview — section counts, the mesh
 * topology, and the transport posture — computed from the REAL `/v1/zt/*` list
 * payloads. No React, fully unit-tested.
 *
 * Honest by construction: a section that did not load (null rows) contributes a
 * `null` count (the UI renders an em-dash), never a guess; the topology contains
 * only nodes that actually came back; and `pqSessionsPct` is null unless the
 * session rows carry a real cipher/pq field. The transport SUITE is a true
 * statement of the platform's post-quantum data plane (Hanzo zap), not telemetry.
 */

export type ZtSectionId = 'services' | 'identities' | 'routers' | 'policies' | 'sessions'

export const ZT_SECTION_IDS: ZtSectionId[] = ['services', 'identities', 'routers', 'policies', 'sessions']

/** The `/v1/zt` endpoint for a section — matches the backend surface (hanzoai/zt). */
export const ZT_ENDPOINT: Record<ZtSectionId, string> = {
  services: 'zt/services',
  identities: 'zt/identities',
  routers: 'zt/routers',
  policies: 'zt/service-policies',
  sessions: 'zt/sessions',
}

export type Row = Record<string, unknown>

/** A fetched section: rows when loaded (possibly empty), or null when it errored. */
export type ZtSections = Record<ZtSectionId, Row[] | null>

/** All sections unloaded — the initial/blank state. */
export const emptySections: ZtSections = {
  services: null,
  identities: null,
  routers: null,
  policies: null,
  sessions: null,
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

/** True when EVERY section failed to load — the zt backend isn't live on this host. */
export const allSectionsDown = (s: ZtSections): boolean =>
  ZT_SECTION_IDS.every((id) => s[id] === null)

/** How many rows look "live" (active/online/healthy/up/connected) — a health read. */
export const liveCount = (rows: Row[] | null): number =>
  (rows ?? []).filter((r) => LIVE.has((rowStatus(r) ?? '').toLowerCase())).length

export type ZtNodeKind = 'router' | 'service' | 'identity'
export type ZtNode = { id: string; name: string; kind: ZtNodeKind; status?: string }

/**
 * The mesh topology, left→right: routers (ingress) → services (targets) →
 * identities (principals). Only real rows become nodes; each column is capped so
 * the strip stays readable. Empty columns are simply absent.
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
    identity: col(s.identities, 'identity'),
  }
}

export const topologyIsEmpty = (t: Record<ZtNodeKind, ZtNode[]>): boolean =>
  t.router.length === 0 && t.service.length === 0 && t.identity.length === 0

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
  /** % of live sessions reporting a PQ cipher, or null when sessions don't report one. */
  pqSessionsPct: number | null
}

/** Whether a session row reports a post-quantum cipher — honest; null when unknown. */
const sessionIsPq = (row: Row): boolean | null => {
  const c = firstString(row, ['cipher', 'suite', 'crypto', 'transport'])
  if (c !== undefined) return /ml-?kem|kyber|ml-?dsa|dilithium|\bpq\b/i.test(c)
  const pq = row.pq ?? row.postQuantum ?? row.quantumSafe
  return typeof pq === 'boolean' ? pq : null
}

export const derivePosture = (sessions: Row[] | null): ZtPosture => {
  let known = 0
  let pq = 0
  for (const r of sessions ?? []) {
    const v = sessionIsPq(r)
    if (v === null) continue
    known += 1
    if (v) pq += 1
  }
  return {
    suite: 'ML-KEM-768 · ML-DSA-65',
    kem: 'ML-KEM-768',
    sig: 'ML-DSA-65',
    transport: 'Hanzo zap',
    pqSessionsPct: known === 0 ? null : Math.round((pq / known) * 100),
  }
}
