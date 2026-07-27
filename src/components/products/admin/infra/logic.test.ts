import { describe, expect, it } from 'vitest'

import type { InfraFinding, InfraNode, InfraVolume } from '~/lib/api/admin-infra'
import {
  canDelete,
  deleteMessage,
  distinctValues,
  drainMessage,
  filterByStatus,
  filterFindings,
  filterNodes,
  filterVolumes,
  gib,
  groupFindings,
  nextSort,
  searchRows,
  severityTone,
  sortRows,
  usd,
  volumeStateTone,
} from './logic'

// ── fixtures ──────────────────────────────────────────────────────────────────

const volume = (over: Partial<InfraVolume>): InfraVolume => ({
  id: 'v-1', name: 'pvc-a', region: 'nyc3', sizeGiB: 100, monthlyCents: 1000, state: 'attached',
  dropletIds: [], nodeName: '', cluster: '', clusterId: '', tagCluster: '', pv: '', pvPhase: '',
  pvcNamespace: '', pvcName: '', mountedBy: [], idle: false, createdAt: '', deletable: false, blockedReason: '',
  ...over,
})

const node = (over: Partial<InfraNode>): InfraNode => ({
  id: 1, name: 'node-1', cluster: 'hanzo-k8s', clusterId: 'c-1', region: 'nyc3', status: 'active',
  sizeSlug: 's-4vcpu-8gb', vcpus: 4, memoryMiB: 8192, localDiskGiB: 160, monthlyCents: 4800,
  createdAt: '', privateIp: '10.0.0.1', publicIp: '', tags: [], ready: true, schedulable: true, pods: 12, volumes: 2,
  ...over,
})

const finding = (over: Partial<InfraFinding>): InfraFinding => ({
  id: 'f-1', severity: 'info', kind: 'idle-pvc', title: 'Idle PVC', detail: '', resource: '', cluster: '', monthlyCents: 0,
  ...over,
})

// ── sorting: ONE comparator, every column type ────────────────────────────────

describe('sortRows — the one generic comparator', () => {
  it('sorts a STRING column, both directions', () => {
    const rows = [volume({ name: 'charlie' }), volume({ name: 'alpha' }), volume({ name: 'bravo' })]
    expect(sortRows(rows, 'name', 'asc').map((v) => v.name)).toEqual(['alpha', 'bravo', 'charlie'])
    expect(sortRows(rows, 'name', 'desc').map((v) => v.name)).toEqual(['charlie', 'bravo', 'alpha'])
  })

  it('sorts a string column NUMERIC-AWARE (node-2 before node-10, not lexicographic)', () => {
    const rows = [node({ name: 'node-10' }), node({ name: 'node-2' }), node({ name: 'node-1' })]
    expect(sortRows(rows, 'name', 'asc').map((n) => n.name)).toEqual(['node-1', 'node-2', 'node-10'])
  })

  it('sorts a NUMBER column numerically (not as strings)', () => {
    const rows = [volume({ monthlyCents: 900 }), volume({ monthlyCents: 10000 }), volume({ monthlyCents: 1000 })]
    expect(sortRows(rows, 'monthlyCents', 'asc').map((v) => v.monthlyCents)).toEqual([900, 1000, 10000])
    expect(sortRows(rows, 'monthlyCents', 'desc').map((v) => v.monthlyCents)).toEqual([10000, 1000, 900])
  })

  it('sorts a BOOLEAN column (false < true ascending)', () => {
    const rows = [node({ name: 'a', schedulable: true }), node({ name: 'b', schedulable: false }), node({ name: 'c', schedulable: true })]
    expect(sortRows(rows, 'schedulable', 'asc').map((n) => n.name)).toEqual(['b', 'a', 'c'])
    expect(sortRows(rows, 'schedulable', 'desc')[0]?.name).toBe('a')
  })

  it('sorts an ARRAY column by LENGTH', () => {
    const rows = [
      volume({ name: 'two', mountedBy: ['p1', 'p2'] }),
      volume({ name: 'none', mountedBy: [] }),
      volume({ name: 'one', mountedBy: ['p1'] }),
    ]
    expect(sortRows(rows, 'mountedBy', 'asc').map((v) => v.name)).toEqual(['none', 'one', 'two'])
  })

  it('never mutates the input and is stable for equal cells', () => {
    const rows = [volume({ name: 'b', sizeGiB: 10 }), volume({ name: 'a', sizeGiB: 10 })]
    const out = sortRows(rows, 'sizeGiB', 'asc')
    expect(out).not.toBe(rows)
    expect(rows.map((v) => v.name)).toEqual(['b', 'a']) // input untouched
    expect(out.map((v) => v.name)).toEqual(['b', 'a']) // stable: original order kept
  })

  it('tolerates an unknown key and absent cells without throwing', () => {
    const rows = [volume({ name: 'a' }), volume({ name: 'b' })]
    expect(() => sortRows(rows, 'nope', 'asc')).not.toThrow()
    expect(sortRows(rows, 'nope', 'asc')).toHaveLength(2)
  })
})

describe('nextSort', () => {
  it('flips direction on the SAME key and starts ascending on a NEW key', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' })
    expect(nextSort({ key: 'name', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
    expect(nextSort({ key: 'name', dir: 'desc' }, 'sizeGiB')).toEqual({ key: 'sizeGiB', dir: 'asc' })
  })
})

// ── filtering ─────────────────────────────────────────────────────────────────

describe('searchRows', () => {
  it('matches a case-insensitive substring and passes everything for a blank query', () => {
    const rows = ['Alpha', 'Bravo']
    expect(searchRows(rows, 'alp', (r) => r)).toEqual(['Alpha'])
    expect(searchRows(rows, '   ', (r) => r)).toEqual(rows)
  })

  it('treats the query LITERALLY — a regex metacharacter matches nothing (no ReDoS, no surprises)', () => {
    const rows = ['pvc-abc']
    expect(searchRows(rows, '.*', (r) => r)).toEqual([])
    expect(searchRows(rows, 'pvc-', (r) => r)).toEqual(rows)
  })
})

describe('filterVolumes', () => {
  const rows = [
    volume({ id: 'v1', name: 'pvc-logs', state: 'attached', nodeName: 'node-1' }),
    volume({ id: 'v2', name: 'pvc-cache', state: 'bound', pvcNamespace: 'hanzo', pvcName: 'cache' }),
    volume({ id: 'v3', name: 'pvc-old', state: 'released' }),
    volume({ id: 'v4', name: 'orphan-a', state: 'unreferenced' }),
    volume({ id: 'v5', name: 'orphan-b', state: 'unreferenced' }),
  ]

  it('passes everything for state "all" + a blank query', () => {
    expect(filterVolumes(rows, '', 'all')).toHaveLength(5)
  })

  it('narrows to exactly one state', () => {
    expect(filterVolumes(rows, '', 'unreferenced').map((v) => v.id)).toEqual(['v4', 'v5'])
    expect(filterVolumes(rows, '', 'attached').map((v) => v.id)).toEqual(['v1'])
    expect(filterVolumes(rows, '', 'released').map((v) => v.id)).toEqual(['v3'])
  })

  it('searches name, node and PVC together, and composes with the state filter', () => {
    expect(filterVolumes(rows, 'node-1', 'all').map((v) => v.id)).toEqual(['v1'])
    expect(filterVolumes(rows, 'hanzo/', 'all')).toEqual([]) // haystack is space-joined, not slashed
    expect(filterVolumes(rows, 'cache', 'all').map((v) => v.id)).toEqual(['v2'])
    expect(filterVolumes(rows, 'orphan', 'unreferenced')).toHaveLength(2)
    expect(filterVolumes(rows, 'orphan', 'attached')).toEqual([])
  })
})

describe('filterNodes', () => {
  const rows = [
    node({ id: 1, name: 'ready-schedulable', ready: true, schedulable: true }),
    node({ id: 2, name: 'ready-cordoned', ready: true, schedulable: false }),
    node({ id: 3, name: 'down', ready: false, schedulable: true, tags: ['gpu'] }),
  ]

  it('filters by readiness and by cordon state', () => {
    expect(filterNodes(rows, '', 'all')).toHaveLength(3)
    expect(filterNodes(rows, '', 'ready').map((n) => n.id)).toEqual([1, 2])
    expect(filterNodes(rows, '', 'notready').map((n) => n.id)).toEqual([3])
    expect(filterNodes(rows, '', 'cordoned').map((n) => n.id)).toEqual([2])
  })

  it('searches name, size, IP and tags', () => {
    expect(filterNodes(rows, 'gpu', 'all').map((n) => n.id)).toEqual([3])
    expect(filterNodes(rows, '10.0.0.1', 'all')).toHaveLength(3)
    expect(filterNodes(rows, 's-4vcpu', 'all')).toHaveLength(3)
  })
})

describe('filterFindings / filterByStatus / distinctValues', () => {
  const rows = [
    finding({ id: 'f1', severity: 'critical', title: 'Unreferenced volume', kind: 'unreferenced-volume' }),
    finding({ id: 'f2', severity: 'warn', title: 'Idle PVC', kind: 'idle-pvc' }),
    finding({ id: 'f3', severity: 'info', title: 'Cost outlier', kind: 'cost-outlier' }),
  ]

  it('filters findings by severity and text', () => {
    expect(filterFindings(rows, '', 'all')).toHaveLength(3)
    expect(filterFindings(rows, '', 'critical').map((f) => f.id)).toEqual(['f1'])
    expect(filterFindings(rows, 'idle', 'all').map((f) => f.id)).toEqual(['f2'])
    expect(filterFindings(rows, 'idle', 'critical')).toEqual([])
  })

  it('filterByStatus passes everything for "all" and matches exactly otherwise', () => {
    const items = [{ status: 'running', name: 'a' }, { status: 'error', name: 'b' }]
    const pick = (r: (typeof items)[number]) => r.status
    const hay = (r: (typeof items)[number]) => r.name
    expect(filterByStatus(items, '', 'all', pick, hay)).toHaveLength(2)
    expect(filterByStatus(items, '', 'error', pick, hay).map((r) => r.name)).toEqual(['b'])
  })

  it('distinctValues offers REAL options only — deduped, sorted, blanks dropped', () => {
    expect(distinctValues([{ s: 'b' }, { s: 'a' }, { s: 'b' }, { s: '' }], (r) => r.s)).toEqual(['a', 'b'])
  })
})

// ── cost + size math ──────────────────────────────────────────────────────────

describe('usd / gib', () => {
  it('renders integer cents as USD with thousands grouping', () => {
    expect(usd(0)).toBe('$0.00')
    expect(usd(5000)).toBe('$50.00') // the 3 unreferenced volumes ≈ $50/mo
    expect(usd(123456)).toBe('$1,234.56')
  })

  it('renders GiB, promoting to TiB past 1024, with an honest dash for garbage', () => {
    expect(gib(500)).toBe('500 GiB') // 3 unreferenced volumes = 500 GiB
    expect(gib(0)).toBe('0 GiB')
    expect(gib(2048)).toBe('2 TiB')
    expect(gib(-1)).toBe('—')
    expect(gib(Number.NaN)).toBe('—')
  })
})

// ── tone ──────────────────────────────────────────────────────────────────────

describe('tones', () => {
  it('tones a volume state by how wasteful it is', () => {
    expect(volumeStateTone('attached')).toBe('green')
    expect(volumeStateTone('bound')).toBe('neutral')
    expect(volumeStateTone('released')).toBe('yellow')
    expect(volumeStateTone('unreferenced')).toBe('red')
  })

  it('tones a finding severity', () => {
    expect(severityTone('critical')).toBe('red')
    expect(severityTone('warn')).toBe('yellow')
    expect(severityTone('info')).toBe('neutral')
  })
})

// ── THE delete gate ───────────────────────────────────────────────────────────

describe('canDelete — a non-deletable volume is NEVER presented as deletable', () => {
  it('is true only for the backend flag, never re-derived from state', () => {
    expect(canDelete(volume({ deletable: true, state: 'unreferenced' }))).toBe(true)
    // The dangerous case: it LOOKS reclaimable (unreferenced) but the backend says no —
    // e.g. the scan was incomplete. The console must not offer a delete the server refuses.
    expect(canDelete(volume({ deletable: false, state: 'unreferenced' }))).toBe(false)
    expect(canDelete(volume({ deletable: false, state: 'released' }))).toBe(false)
    expect(canDelete(volume({ deletable: false, state: 'attached' }))).toBe(false)
  })

  it('refuses a missing/garbage flag (fail closed)', () => {
    for (const bad of [undefined, null, 'true', 1, {}]) {
      expect(canDelete({ ...volume({}), deletable: bad } as unknown as InfraVolume)).toBe(false)
    }
  })

  it('is never true for a volume the backend blocked, whatever the reason says', () => {
    const blocked = volume({ deletable: false, state: 'unreferenced', blockedReason: 'Scan incomplete — no volume is deletable.' })
    expect(canDelete(blocked)).toBe(false)
    expect(blocked.blockedReason).not.toBe('')
  })
})

describe('deleteMessage', () => {
  const v = volume({ name: 'pvc-abandoned', sizeGiB: 200, monthlyCents: 2000, state: 'unreferenced', deletable: true })

  it('states the NAME, the SIZE, the MONTHLY COST reclaimed, and that a snapshot is taken', () => {
    const msg = deleteMessage(v, true)
    expect(msg).toContain('pvc-abandoned')
    expect(msg).toContain('200 GiB')
    expect(msg).toContain('$20.00/month')
    expect(msg).toContain('snapshot is taken first')
  })

  it('says plainly that NO snapshot means permanent destruction when the toggle is off', () => {
    const msg = deleteMessage(v, false)
    expect(msg).toContain('NO snapshot')
    expect(msg).toContain('cannot be restored')
    expect(msg).toContain('pvc-abandoned')
    expect(msg).toContain('$20.00/month')
  })
})

describe('drainMessage', () => {
  it('states the pod count, pluralized honestly', () => {
    expect(drainMessage(node({ name: 'node-7', pods: 12 }))).toContain('evicts 12 pods')
    expect(drainMessage(node({ pods: 1 }))).toContain('evicts 1 pod onto')
    expect(drainMessage(node({ pods: 0 }))).toContain('evicts 0 pods')
  })
})

// ── audit grouping ────────────────────────────────────────────────────────────

describe('groupFindings', () => {
  it('groups worst-first, sums cost impact, and OMITS severities with no findings', () => {
    const groups = groupFindings([
      finding({ id: 'a', severity: 'info', monthlyCents: 100 }),
      finding({ id: 'b', severity: 'critical', monthlyCents: 3000 }),
      finding({ id: 'c', severity: 'critical', monthlyCents: 2000 }),
    ])
    expect(groups.map((g) => g.severity)).toEqual(['critical', 'info']) // no empty 'warn' group
    expect(groups[0]?.findings.map((f) => f.id)).toEqual(['b', 'c'])
    expect(groups[0]?.monthlyCents).toBe(5000)
    expect(groups[1]?.monthlyCents).toBe(100)
  })

  it('returns nothing for no findings (never a false "critical: 0" alarm)', () => {
    expect(groupFindings([])).toEqual([])
  })
})
