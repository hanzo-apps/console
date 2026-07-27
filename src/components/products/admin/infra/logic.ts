/**
 * Infrastructure board — the PURE decisions, so every ordering, filter, money figure
 * and delete gate is unit-tested in the node env and `InfraModule.tsx` stays thin.
 * No React / Gui / registry imports (vitest runs `environment: 'node'`).
 *
 * ONE generic comparator serves every table (string / number / boolean / array-length),
 * so adding a sortable column is declaring `sortable: true` — never another sort
 * function. ONE `searchRows` serves every filter; the per-table filters differ only in
 * their state predicate and which fields they read.
 *
 * The delete gate lives here too: `canDelete` is the single predicate the volumes table
 * consults, and it trusts ONLY the backend's own `deletable` flag (`complete &&
 * state === 'unreferenced'`) — the console never re-derives deletability from `state`,
 * because that would offer deletes on an incomplete scan that the server will refuse.
 */
import type { FindingSeverity, InfraFinding, InfraNode, InfraVolume, VolumeState } from '~/lib/api/admin-infra'

// ── sorting ───────────────────────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc'
export type Sort = { key: string; dir: SortDir }

/**
 * The ONE comparable projection of a cell: numbers/booleans/array-lengths compare
 * numerically, everything else as a string. Absent → '' (sorts first ascending), so a
 * missing datum never crashes the sort and never fabricates a rank.
 */
function cmpValue(v: unknown): string | number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'boolean') return v ? 1 : 0
  if (Array.isArray(v)) return v.length
  if (v == null) return ''
  return String(v)
}

/**
 * Sort a copy of `rows` by `key`. Numeric-ish cells compare numerically; strings use a
 * numeric-aware, case-insensitive collation so `node-2` precedes `node-10`. Stable
 * (Array#sort is), so equal cells keep the backend's own order.
 */
export function sortRows<T>(rows: T[], key: string, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = cmpValue((a as Record<string, unknown>)[key])
    const y = cmpValue((b as Record<string, unknown>)[key])
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * sign
  })
}

/** Header-click reducer: the same key flips direction, a new key starts ascending. */
export function nextSort(cur: Sort, key: string): Sort {
  return cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
}

// ── filtering ─────────────────────────────────────────────────────────────────

/**
 * Literal, case-insensitive substring match over the fields `haystack` exposes — never
 * a compiled RegExp of user input (no ReDoS, no accidental metacharacters).
 */
export function searchRows<T>(rows: T[], q: string, haystack: (row: T) => string): T[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter((r) => haystack(r).toLowerCase().includes(needle))
}

/** The distinct non-empty values of a field, sorted — so a filter offers REAL options only. */
export function distinctValues<T>(rows: T[], pick: (row: T) => string): string[] {
  return Array.from(new Set(rows.map(pick).filter(Boolean))).sort()
}

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
