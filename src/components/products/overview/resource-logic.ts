/**
 * Pure view-logic for the unified RESOURCE overview (unit-tested; no React, no I/O).
 *
 * The overview folds three REAL, per-org inventories into one at-a-glance picture —
 * Apps (`/v1/platform`), GPUs (`/v1/visor/gpus`), and Nodes/Machines (`/v1/visor/machines`). As of
 * the unioned cloud inventory each GPU/machine carries a `provider` (`visor`/`doks` =
 * Hanzo Cloud, or `byo` = a bring-your-own worker / on-prem node), so the board can
 * split "online" into cloud vs BYO and badge a bring-your-own GB10 distinctly. These
 * helpers are total functions over that shape — an absent field never throws, and an
 * unknown status counts as offline (never a fabricated "online").
 */

/** Where a resource lives: Hanzo Cloud, or a customer's own (bring-your-own) fleet. */
export type ProviderKind = 'byo' | 'cloud'

/** Provider slugs that mean a customer-owned / on-prem node (everything else = cloud). */
const BYO_PROVIDERS = new Set(['byo', 'bring-your-own', 'on-prem', 'onprem', 'on_prem', 'self', 'self-hosted', 'worker', 'fleet'])

/**
 * Classify a `provider` slug. Absent/unknown → `cloud`: the pre-union inventory was
 * entirely Hanzo Cloud (DOKS/visor), so an unlabeled row is cloud, not fabricated BYO.
 */
export const providerKind = (provider?: string): ProviderKind =>
  provider && BYO_PROVIDERS.has(provider.trim().toLowerCase()) ? 'byo' : 'cloud'

/** Short badge label for a provider — `BYO` for a bring-your-own node, else `Cloud`. */
export const providerLabel = (provider?: string): string => (providerKind(provider) === 'byo' ? 'BYO' : 'Cloud')

/** Status strings that mean a resource is up/serving (case-insensitive). */
const ONLINE_STATES = new Set(['online', 'ready', 'active', 'running', 'available', 'ok', 'up', 'healthy', 'live', 'succeeded'])

/** True iff a resource's lifecycle string means it is up. Unknown/absent → false. */
export const isOnline = (status?: string): boolean => ONLINE_STATES.has((status ?? '').trim().toLowerCase())

/** An online tally split by where the capacity lives — the "cloud + BYO" headline. */
export type OnlineSplit = {
  /** Total items in the inventory. */
  total: number
  /** Items whose status means online. */
  online: number
  /** Online items on Hanzo Cloud (visor/doks). */
  onlineCloud: number
  /** Online items on a bring-your-own / on-prem node. */
  onlineByo: number
  /** Total BYO items (online or not) — drives the "includes N BYO" caption. */
  byo: number
}

/**
 * Fold an inventory (GPUs or machines — anything carrying `provider` + `status`) into
 * the online split. PURE; the stat tiles read `online` + `onlineCloud`/`onlineByo`.
 */
export function onlineSplit(items: { provider?: string; status?: string }[]): OnlineSplit {
  let online = 0
  let onlineCloud = 0
  let onlineByo = 0
  let byo = 0
  for (const it of items) {
    const kind = providerKind(it.provider)
    if (kind === 'byo') byo++
    if (isOnline(it.status)) {
      online++
      if (kind === 'byo') onlineByo++
      else onlineCloud++
    }
  }
  return { total: items.length, online, onlineCloud, onlineByo, byo }
}

/** Caption for a GPU/node online tile: `"3 cloud · 1 BYO"`, or just cloud when no BYO. */
export function onlineCaption(s: OnlineSplit): string {
  if (s.total === 0) return 'none yet'
  if (s.byo === 0) return `${s.online} online`
  return `${s.onlineCloud} cloud · ${s.onlineByo} BYO`
}
