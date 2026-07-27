/**
 * Infrastructure board — the PURE decisions, so every ordering, filter, money figure
 * and delete gate is unit-tested in the node env and `InfraModule.tsx` stays thin.
 * No React / Gui / registry imports (vitest runs `environment: 'node'`).
 *
 * ORDERING AND SEARCH ARE NOT DEFINED HERE. The generic comparator, the header-click
 * reducer and the substring predicate this board introduced were promoted verbatim to
 * `~/lib/list/core`, which is now the ONE definition every list in the console shares
 * (a table of clusters and a catalog of models order the same way for the same reason).
 * They are re-exported below so this board's own call sites and tests keep reading
 * `./logic` — one implementation, one import path per consumer.
 *
 * What stays here is what is genuinely THIS board's: the per-table filter predicates,
 * the money/size formatting, and the delete gate — `canDelete` is the single predicate
 * the volumes table consults, and it trusts ONLY the backend's own `deletable` flag
 * (`complete && state === 'unreferenced'`); the console never re-derives deletability
 * from `state`, because that would offer deletes on an incomplete scan the server will
 * refuse.
 */
import type { FindingSeverity, InfraFinding, InfraNode, InfraVolume, VolumeState } from '~/lib/api/admin-infra'

export { distinctValues, nextSort, searchRows, sortRows, type Sort, type SortDir } from '~/lib/list/core'

import { searchRows } from '~/lib/list/core'

/** Search + an exact match on one status-ish field (`'all'` passes everything). */
export function filterByStatus<T>(rows: T[], q: string, status: string, pick: (row: T) => string, haystack: (row: T) => string): T[] {
  return searchRows(status === 'all' ? rows : rows.filter((r) => pick(r) === status), q, haystack)
}

/** Volume state filter values — the contract's four states plus the `all` pass-through. */
export type VolumeFilter = 'all' | VolumeState

export function filterVolumes(rows: InfraVolume[], q: string, state: VolumeFilter): InfraVolume[] {
  const scoped = state === 'all' ? rows : rows.filter((v) => v.state === state)
  return searchRows(scoped, q, (v) => `${v.name} ${v.id} ${v.region} ${v.cluster} ${v.tagCluster} ${v.nodeName} ${v.pvcNamespace} ${v.pvcName} ${v.pv}`)
}

/** Node state filter — schedulability + readiness, the two operator questions. */
export type NodeFilter = 'all' | 'ready' | 'notready' | 'cordoned'

const nodeInState = (n: InfraNode, state: NodeFilter): boolean =>
  state === 'all' ? true : state === 'ready' ? n.ready : state === 'notready' ? !n.ready : !n.schedulable

export function filterNodes(rows: InfraNode[], q: string, state: NodeFilter): InfraNode[] {
  return searchRows(
    rows.filter((n) => nodeInState(n, state)),
    q,
    (n) => `${n.name} ${n.cluster} ${n.region} ${n.sizeSlug} ${n.status} ${n.privateIp} ${n.publicIp} ${n.tags.join(' ')}`,
  )
}

/** Findings filter — by severity, the axis an operator triages on. */
export type FindingFilter = 'all' | FindingSeverity

export function filterFindings(rows: InfraFinding[], q: string, sev: FindingFilter): InfraFinding[] {
  const scoped = sev === 'all' ? rows : rows.filter((f) => f.severity === sev)
  return searchRows(scoped, q, (f) => `${f.title} ${f.detail} ${f.kind} ${f.resource} ${f.cluster}`)
}

// ── formatting ────────────────────────────────────────────────────────────────

/** Integer cents → USD. `$50.00`, `$1,234.56`. */
export function usd(cents: number): string {
  const v = Number.isFinite(cents) ? cents / 100 : 0
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** GiB count → `500 GiB` / `12.5 TiB` (thousands-grouped, never a bare number). */
export function gib(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n >= 1024) return `${(n / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} TiB`
  return `${Math.round(n).toLocaleString('en-US')} GiB`
}

// ── tone + copy ───────────────────────────────────────────────────────────────

/** Tone for a volume state: paying-for-nothing reads red, healthy reads green. */
export function volumeStateTone(state: VolumeState): 'green' | 'yellow' | 'red' | 'neutral' {
  if (state === 'attached') return 'green'
  if (state === 'bound') return 'neutral'
  if (state === 'released') return 'yellow'
  return 'red'
}

/** Tone for a finding severity (shared by the audit table + the severity groups). */
export function severityTone(sev: FindingSeverity): 'red' | 'yellow' | 'neutral' {
  return sev === 'critical' ? 'red' : sev === 'warn' ? 'yellow' : 'neutral'
}

/**
 * THE delete gate. Trusts ONLY the backend's `deletable` (`complete && unreferenced`) —
 * a false/absent flag is never overridden, so the console can never present a delete the
 * server will refuse. `blockedReason` is what the UI shows in its place.
 */
export const canDelete = (v: InfraVolume): boolean => v.deletable === true

/**
 * The delete confirmation text. States the volume NAME, its SIZE, the monthly spend
 * being reclaimed, and whether a snapshot is taken first — everything the operator needs
 * to be sure, in one sentence they must read before the red button.
 */
export function deleteMessage(v: InfraVolume, snapshot: boolean): string {
  return (
    `Delete volume “${v.name}” (${gib(v.sizeGiB)}) and reclaim ${usd(v.monthlyCents)}/month? ` +
    (snapshot
      ? 'A snapshot is taken first, so the data can be restored.'
      : 'NO snapshot will be taken — the data is destroyed permanently and cannot be restored.') +
    ' The server re-verifies the volume is still unreferenced and refuses otherwise.'
  )
}

/** The drain confirmation text — states the pod count being evicted off this node. */
export function drainMessage(n: InfraNode): string {
  return `Drain “${n.name}”? This cordons the node and evicts ${n.pods} pod${n.pods === 1 ? '' : 's'} onto the rest of the cluster. Workloads restart elsewhere.`
}

// ── audit grouping ────────────────────────────────────────────────────────────

/** One severity group for the audit tab: its findings and their total monthly impact. */
export type FindingGroup = { severity: FindingSeverity; findings: InfraFinding[]; monthlyCents: number }

/**
 * Group findings by severity, worst first, each with its summed cost impact. A severity
 * with no findings is OMITTED (an empty "critical" group would read as a false alarm).
 */
export function groupFindings(rows: InfraFinding[]): FindingGroup[] {
  const order: FindingSeverity[] = ['critical', 'warn', 'info']
  return order
    .map((severity) => {
      const findings = rows.filter((f) => f.severity === severity)
      return { severity, findings, monthlyCents: findings.reduce((s, f) => s + f.monthlyCents, 0) }
    })
    .filter((grp) => grp.findings.length > 0)
}
