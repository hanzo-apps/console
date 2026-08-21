/**
 * Org Settings (auto-routing) admin client — the config-as-Base surface over the
 * hanzoai/ai OrgSettings CRUD (`GET/PUT/DELETE /v1/ai/org/settings` + `GET
 * /v1/ai/org/settings/list`, all RequireSuperAdmin upstream).
 *
 * OrgSettings is ONE Base/SQLite row per org keyed on `owner`, plus a reserved
 * `GlobalDefaultOwner` ("*") row that is the platform-wide default. Runtime policy
 * lives as DATA in these rows — edited from admin.hanzo.ai, never an env var or a
 * session-gated code toggle. This client edits the ONE field this surface owns —
 * `autoRouting` (three-state: "" inherit / "enabled" / "disabled").
 *
 * READ-MODIFY-WRITE is the convention: the write reads the current row, overrides
 * only `autoRouting`, and PUTs the whole row back. The backend `PUT /v1/ai/org/settings`
 * PATCH-merges (a field ABSENT from the body keeps its value), so carrying the full raw
 * row through can never clobber the sibling routing-policy fields (routerPrefer,
 * routerCostCeiling, defaultSessionRouting, trainingContribution) that OTHER endpoints
 * own. A revert to inherit DELETEs the row only when nothing else is set on it, else it
 * just clears the field (an explicit `autoRouting: ''` in the merged body).
 *
 * Reads/writes ride originGet/originPut/originDelete — the console's OWN origin, dispatched by
 * next.config to the /ai user-bearer proxy (session cookie → short-lived minted
 * bearer → the hanzoai/ai gateway). The super-admin gate is enforced UPSTREAM; a
 * non-admin gets a real 403 the module renders honestly (SuperAdminRequired).
 */
import { originGet, originPut, originDelete } from './client'

/** The reserved owner of the platform-wide default row (read as the fallback
 *  between a real org's row and the gateway conf). No real request resolves its
 *  org to "*", so it is never mistaken for a tenant. */
export const GLOBAL_DEFAULT_OWNER = '*'

/** The three-state auto-routing control value. `inherit` = no override on this row
 *  (fall through to the "*" default row, then the gateway conf). */
export type RoutingState = 'inherit' | 'enabled' | 'disabled'

/**
 * One per-org settings row as this surface sees it: the `owner`, the resolved
 * `autoRouting` string (`'' | 'enabled' | 'disabled'`), the last-updated stamp, and
 * the RAW wire row carried through opaquely so a write preserves every sibling field
 * (routerPrefer/costCeiling/… and any field this surface does not model).
 */
export type OrgSettings = {
  owner: string
  /** The stored value: `'' | 'enabled' | 'disabled'`. Use `routingState` for the control. */
  autoRouting: string
  updatedTime: string
  /** The full wire row — the source of truth for read-modify-write. */
  raw: Record<string, unknown>
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Normalize the stored auto-routing string to the two real values or "" (unset). */
const normAutoRouting = (v: unknown): string => (v === 'enabled' || v === 'disabled' ? v : '')

/** Normalize a raw wire row into `OrgSettings`, keeping the raw row for write-back. */
export function normalizeOrgSettings(raw: unknown): OrgSettings {
  const r = asRecord(raw)
  return {
    owner: str(r.owner),
    autoRouting: normAutoRouting(r.autoRouting),
    updatedTime: str(r.updatedTime),
    raw: r,
  }
}

/** Parse the `org/settings/list` payload (an array) into rows, dropping any
 *  row with no owner. Honest-empty on a null/garbage payload. */
export function settingsFrom(payload: unknown): OrgSettings[] {
  const list = Array.isArray(payload) ? payload : []
  return list.map(normalizeOrgSettings).filter((s) => s.owner !== '')
}

/** The control state for a row (or a missing row): "" / missing → inherit. */
export function routingState(row: OrgSettings | null): RoutingState {
  const a = row?.autoRouting
  return a === 'enabled' ? 'enabled' : a === 'disabled' ? 'disabled' : 'inherit'
}

/** A synthetic empty row for an org with no settings yet (renders as inherit; a
 *  write creates the real row). */
export const emptyOrgSettings = (owner: string): OrgSettings =>
  normalizeOrgSettings({ owner })

/** True iff the row carries state OTHER than autoRouting (router policy, session
 *  routing, training opt-in) — i.e. deleting it to revert autoRouting would clobber
 *  something. Read over the raw row so unmodeled fields still count. */
function hasSiblingState(raw: Record<string, unknown>): boolean {
  const set = (k: string): boolean => typeof raw[k] === 'string' && raw[k] !== ''
  const prefer = raw.routerPrefer
  const hasPrefer = !!prefer && typeof prefer === 'object' && Object.keys(prefer as object).length > 0
  const ceiling = raw.routerCostCeiling
  const hasCeiling = typeof ceiling === 'number' && ceiling !== 0
  return set('defaultSessionRouting') || set('trainingContribution') || hasPrefer || hasCeiling
}

/**
 * The full row to POST for an explicit enabled/disabled write — the raw current row
 * (or a fresh one) with `owner` pinned and only `autoRouting` overridden, so the
 * full-row-replace update preserves every sibling field.
 */
export function planSave(
  current: OrgSettings | null,
  owner: string,
  state: 'enabled' | 'disabled',
): Record<string, unknown> {
  return { ...(current?.raw ?? {}), owner, autoRouting: state }
}

/** The revert-to-inherit plan (task: "delete to revert to inherit"): a no-op when
 *  there is no row, a DELETE when the row is only an auto-routing row (nothing else
 *  to keep), else an UPDATE that clears just `autoRouting` and preserves the rest. */
export type RevertPlan =
  | { op: 'noop' }
  | { op: 'delete'; owner: string }
  | { op: 'update'; row: Record<string, unknown> }

export function planRevert(current: OrgSettings | null): RevertPlan {
  if (!current) return { op: 'noop' }
  const cleared = { ...current.raw, owner: current.owner, autoRouting: '' }
  return hasSiblingState(cleared) ? { op: 'update', row: cleared } : { op: 'delete', owner: current.owner }
}

export const OrgSettingsApi = {
  /** The per-org settings rows for `owner` (the backend defaults to the admin org).
   *  0-or-1 row per owner (owner is the PK) — the console composes these with the
   *  global "*" row and admin-added orgs. */
  list: async (owner?: string): Promise<OrgSettings[]> => {
    const data = await originGet<unknown>('ai/org/settings/list', owner ? { owner } : undefined)
    return settingsFrom(data)
  },

  /** One org's settings row, or `null` when the org has no override yet. */
  get: async (owner: string): Promise<OrgSettings | null> => {
    const data = await originGet<unknown>('ai/org/settings', { owner })
    return data ? normalizeOrgSettings(data) : null
  },

  /**
   * Set an org's (or the global "*") auto-routing to a three-state value. Read-
   * modify-write throughout: reads the current row first so `enabled`/`disabled`
   * preserve every sibling field, and `inherit` reverts per `planRevert` (delete the
   * row when it holds nothing else, else clear just the field). Returns the resulting
   * row (null when reverted to inherit).
   */
  setRouting: async (owner: string, state: RoutingState): Promise<OrgSettings | null> => {
    const current = await OrgSettingsApi.get(owner)
    if (state === 'inherit') {
      const plan = planRevert(current)
      if (plan.op === 'delete') await originDelete('ai/org/settings', { owner: plan.owner })
      else if (plan.op === 'update') await originPut('ai/org/settings', plan.row, { owner })
      return null
    }
    const row = planSave(current, owner, state)
    await originPut('ai/org/settings', row, { owner })
    return normalizeOrgSettings(row)
  },
}
