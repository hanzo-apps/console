import { describe, expect, it } from 'vitest'

import { normalizeSnapshot } from './admin-infra'

/** The real-shaped payload: 58 nodes, 295 volumes, 8 clusters, 132 detached, 3 reclaimable. */
const raw = {
  at: '2026-07-26T10:00:00Z',
  complete: true,
  incompleteReason: '',
  sources: [{ name: 'do-api', ok: true, rows: 295, error: '', at: '2026-07-26T10:00:00Z' }],
  totals: {
    clusters: 8, nodes: 58, volumes: 295, load_balancers: 6,
    volume_gib: 41200, attached_volumes: 163, attached_gib: 28900,
    detached_volumes: 132, detached_gib: 12300,
    unreferenced_volumes: 3, unreferenced_gib: 500, idle_pvcs: 11, local_disk_gib: 9280,
  },
  cost: { droplets_monthly: 1284000, volumes_monthly: 412000, load_balancers_monthly: 7200, total_monthly: 1703200, reclaimable_monthly: 5000 },
  clusters: [{ id: 'c-1', name: 'hanzo-k8s', region: 'nyc3', node_pools: 3, idle_pvcs: 4, scanned: true, monthly_cents: 480000 }],
  nodes: [{ id: 42, name: 'pool-a-1', size_slug: 's-4vcpu-8gb', memory_mib: 8192, local_disk_gib: 160, monthly_cents: 4800, ready: true, schedulable: true, tags: ['k8s'] }],
  volumes: [{ id: 'v-1', name: 'pvc-orphan', size_gib: 200, monthly_cents: 2000, state: 'unreferenced', deletable: true, droplet_ids: [], mounted_by: [] }],
  loadBalancers: [{ id: 'lb-1', name: 'edge', size_unit: 1, monthly_cents: 1200, droplets: 4 }],
  findings: [{ id: 'f-1', severity: 'critical', kind: 'unreferenced-volume', title: 'Unreferenced volume', monthly_cents: 2000 }],
}

describe('normalizeSnapshot', () => {
  it('reads the snake_case wire shape into the typed board model', () => {
    const s = normalizeSnapshot(raw)
    expect(s.totals).toMatchObject({ clusters: 8, nodes: 58, volumes: 295, loadBalancers: 6, detachedVolumes: 132, unreferencedVolumes: 3, unreferencedGiB: 500, localDiskGiB: 9280 })
    expect(s.cost).toMatchObject({ dropletsMonthly: 1284000, volumesMonthly: 412000, totalMonthly: 1703200, reclaimableMonthly: 5000 })
    expect(s.clusters[0]).toMatchObject({ name: 'hanzo-k8s', nodePools: 3, idlePVCs: 4, scanned: true, monthlyCents: 480000 })
    expect(s.nodes[0]).toMatchObject({ id: 42, sizeSlug: 's-4vcpu-8gb', memoryMiB: 8192, localDiskGiB: 160, schedulable: true, tags: ['k8s'] })
    expect(s.volumes[0]).toMatchObject({ name: 'pvc-orphan', sizeGiB: 200, state: 'unreferenced', deletable: true })
    expect(s.loadBalancers[0]).toMatchObject({ name: 'edge', sizeUnit: 1, monthlyCents: 1200, droplets: 4 })
    expect(s.findings[0]).toMatchObject({ severity: 'critical', kind: 'unreferenced-volume', monthlyCents: 2000 })
  })

  it('also reads camelCase and coerces numeric strings', () => {
    const s = normalizeSnapshot({ ...raw, totals: { ...raw.totals, localDiskGiB: '9280' }, cost: { ...raw.cost, totalMonthly: '1703200' } })
    expect(s.totals.localDiskGiB).toBe(9280)
    expect(s.cost.totalMonthly).toBe(1703200)
  })

  it('CONTRACT: an incomplete scan makes NO volume deletable, whatever the row flag says', () => {
    const s = normalizeSnapshot({ ...raw, complete: false, incompleteReason: 'cluster c-3 unreachable' })
    expect(s.complete).toBe(false)
    expect(s.volumes.every((v) => v.deletable === false)).toBe(true)
    expect(s.volumes[0]?.blockedReason).toContain('Scan incomplete')
  })

  it('fails CLOSED on a missing/garbage deletable flag', () => {
    const s = normalizeSnapshot({ ...raw, volumes: [{ id: 'a' }, { id: 'b', deletable: 'true' }, { id: 'c', deletable: 1 }] })
    expect(s.volumes.map((v) => v.deletable)).toEqual([false, false, false])
  })

  it('degrades an empty / garbage / null-array payload to honest zeros and empty lists', () => {
    for (const junk of [undefined, null, {}, 'nope', { volumes: null, nodes: null, findings: null }]) {
      const s = normalizeSnapshot(junk)
      expect(s.totals.volumes).toBe(0)
      expect(s.cost.totalMonthly).toBe(0)
      expect(s.volumes).toEqual([])
      expect(s.nodes).toEqual([])
      expect(s.clusters).toEqual([])
      expect(s.loadBalancers).toEqual([])
      expect(s.findings).toEqual([])
    }
  })

  it('clamps an unknown volume state / finding severity to the safe end of the scale', () => {
    const s = normalizeSnapshot({ ...raw, volumes: [{ id: 'v', state: 'weird' }], findings: [{ id: 'f', severity: 'apocalyptic' }] })
    expect(s.volumes[0]?.state).toBe('unreferenced') // unknown ⇒ treated as the wasteful case, still not deletable
    expect(s.volumes[0]?.deletable).toBe(false)
    expect(s.findings[0]?.severity).toBe('info') // unknown ⇒ never a fabricated "critical"
  })
})
