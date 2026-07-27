/**
 * Infrastructure board — the INFRA-SPECIFIC decisions: which rows each tab shows, the
 * delete gate, the confirmation copy, and the audit grouping. `InfraModule.tsx` stays
 * thin and every decision is unit-tested in the node env.
 *
 * Ordering, filtering and formatting are NOT infra concerns — they live in `~/lib/table`
 * and `~/lib/format`, the ONE implementation every board shares, and are re-exported
 * here so this module's importers keep their single import path.
 *
 * The delete gate lives here: `canDelete` is the single predicate the volumes table
 * consults, and it trusts ONLY the backend's own `deletable` flag (`complete &&
 * state === 'unreferenced'`) — the console never re-derives deletability from `state`,
 * because that would offer deletes on an incomplete scan that the server will refuse.
 */
import type { FindingSeverity, InfraFinding, InfraNode, InfraVolume, VolumeState } from '~/lib/api/admin-infra'
import { distinctValues, filterByStatus, nextSort, searchRows, sortRows, type Sort, type SortDir } from '~/lib/table'
import { gib, usd } from '~/lib/format'

export { distinctValues, filterByStatus, nextSort, searchRows, sortRows, type Sort, type SortDir }
export { gib, usd }

// ── filtering ─────────────────────────────────────────────────────────────────

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
