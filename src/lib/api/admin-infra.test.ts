import { describe, expect, it } from 'vitest'

import {
  destroyMessage,
  gate,
  normalizeSnapshot,
  resizeMessage,
  scaleMessage,
  scanGate,
  type InfraNode,
} from './admin-infra'

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
  clusters: [{ id: 'c-1', name: 'hanzo-k8s', region: 'nyc3', node_pools: 3, idle_pvcs: 4, scanned: true, monthly_cents: 480000, pools: [{ name: 'pool-a', size: 's-4vcpu-8gb', count: 3, nodes: 3 }] }],
  nodes: [{ id: 42, name: 'pool-a-1', size_slug: 's-4vcpu-8gb', memory_mib: 8192, local_disk_gib: 160, monthly_cents: 4800, ready: true, schedulable: true, tags: ['k8s'], mutable: false, blocked_reason: 'Managed by DOKS pool pool-a — scale the pool instead.' }],
  volumes: [{ id: 'v-1', name: 'pvc-orphan', size_gib: 200, monthly_cents: 2000, state: 'unreferenced', deletable: true, droplet_ids: [], mounted_by: [] }],
  loadBalancers: [{ id: 'lb-1', name: 'edge', size_unit: 1, monthly_cents: 1200, droplets: 4, service: 'ingress-nginx/controller', deletable: false, blocked_reason: 'Claimed by Service ingress-nginx/controller.' }],
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

  it('reads the management fields: droplet mutability, pools, and the LB Service claim', () => {
    const s = normalizeSnapshot(raw)
    expect(s.nodes[0]).toMatchObject({ mutable: false, blockedReason: 'Managed by DOKS pool pool-a — scale the pool instead.' })
    expect(s.clusters[0]?.pools).toEqual([{ name: 'pool-a', size: 's-4vcpu-8gb', count: 3, nodes: 3 }])
    expect(s.loadBalancers[0]).toMatchObject({ service: 'ingress-nginx/controller', deletable: false, blockedReason: 'Claimed by Service ingress-nginx/controller.' })
  })

  it('fails CLOSED on a missing/garbage mutable or LB deletable flag', () => {
    const s = normalizeSnapshot({
      ...raw,
      nodes: [{ id: 1 }, { id: 2, mutable: 'true' }, { id: 3, mutable: 1 }, { id: 4, mutable: true }],
      loadBalancers: [{ id: 'a' }, { id: 'b', deletable: 'true' }, { id: 'c', deletable: true }],
      clusters: [{ id: 'c-1' }],
    })
    expect(s.nodes.map((n) => n.mutable)).toEqual([false, false, false, true])
    expect(s.loadBalancers.map((l) => l.deletable)).toEqual([false, false, true])
    expect(s.clusters[0]?.pools).toEqual([]) // absent pools ⇒ nothing to scale, never a fabricated pool
  })

  it('CONTRACT: an incomplete scan freezes EVERY mutation — droplets and LBs too', () => {
    const s = normalizeSnapshot({
      ...raw,
      complete: false,
      incompleteReason: 'cluster c-3 unreachable',
      nodes: [{ id: 1, mutable: true }],
      loadBalancers: [{ id: 'lb-1', deletable: true }],
      volumes: [{ id: 'v-1', deletable: true }],
    })
    expect(s.nodes[0]?.mutable).toBe(false)
    expect(s.loadBalancers[0]?.deletable).toBe(false)
    expect(s.volumes[0]?.deletable).toBe(false)
    for (const r of [s.nodes[0], s.loadBalancers[0], s.volumes[0]]) expect(r?.blockedReason).toContain('Scan incomplete')
  })

  it('keeps the row’s OWN reason when the scan freezes it (the specific beats the generic)', () => {
    const s = normalizeSnapshot({ ...raw, complete: false, nodes: [{ id: 1, mutable: true, blockedReason: 'Managed by DOKS pool pool-a.' }] })
    expect(s.nodes[0]).toMatchObject({ mutable: false, blockedReason: 'Managed by DOKS pool pool-a.' })
  })
})

// ── the gate: may this control be offered at all? ──────────────────────────────

describe('gate', () => {
  it('allows ONLY on a strict true — absent, false and truthy-but-not-true all refuse', () => {
    expect(gate(true, '', 'fallback').allowed).toBe(true)
    for (const flag of [false, undefined]) expect(gate(flag, '', 'fallback').allowed).toBe(false)
  })

  it('shows the server’s reason verbatim, and falls back only when it gave none', () => {
    expect(gate(false, 'Claimed by Service ingress-nginx/controller.', 'fallback').reason).toBe('Claimed by Service ingress-nginx/controller.')
    expect(gate(false, '', 'fallback').reason).toBe('fallback')
    expect(gate(undefined, undefined, 'fallback').reason).toBe('fallback')
    expect(gate(false, '   ', 'fallback').reason).toBe('fallback') // whitespace is not a reason
  })

  it('never reports a reason when the control IS allowed', () => {
    expect(gate(true, 'stale reason', 'fallback')).toEqual({ allowed: true, reason: '' })
  })
})

describe('scanGate', () => {
  it('allows every mutation on a complete scan', () => {
    expect(scanGate({ complete: true, incompleteReason: 'ignored' })).toEqual({ allowed: true, reason: '' })
  })

  it('refuses on an incomplete scan and NAMES the cluster that did not report', () => {
    const g = scanGate({ complete: false, incompleteReason: 'cluster c-3 unreachable' })
    expect(g.allowed).toBe(false)
    expect(g.reason).toContain('Scan incomplete')
    expect(g.reason).toContain('cluster c-3 unreachable')
  })

  it('still states WHY when the backend gave no reason', () => {
    expect(scanGate({ complete: false, incompleteReason: '' }).reason).toContain('Scan incomplete')
  })
})

// ── confirm copy: it must NAME what dies and state what cannot be undone ──────

const node = (over: Partial<InfraNode>): InfraNode => ({
  id: 7, name: 'pool-a-1', cluster: 'hanzo-k8s', clusterId: 'c-1', region: 'nyc3', status: 'active',
  sizeSlug: 's-4vcpu-8gb', vcpus: 4, memoryMiB: 8192, localDiskGiB: 160, monthlyCents: 4800,
  createdAt: '', privateIp: '', publicIp: '', tags: [], ready: true, schedulable: true, pods: 12, volumes: 2,
  ...over,
})

describe('destroyMessage', () => {
  it('names the resource, its monthly spend, the consequence, and that there is no undo', () => {
    const m = destroyMessage('droplet', 'pool-a-1', 4800, '12 pods still run on it.')
    expect(m).toContain('“pool-a-1”')
    expect(m).toContain('$48.00/month')
    expect(m).toContain('12 pods still run on it.')
    expect(m).toContain('no undo')
  })
})

describe('resizeMessage', () => {
  it('states both sizes and the power-off, always', () => {
    const m = resizeMessage(node({}), 's-8vcpu-16gb', false)
    expect(m).toContain('“pool-a-1”')
    expect(m).toContain('from s-4vcpu-8gb to s-8vcpu-16gb')
    expect(m).toContain('powered OFF')
  })

  it('calls a DISK resize permanent, and a CPU/memory one reversible', () => {
    expect(resizeMessage(node({}), 's-8vcpu-16gb', true)).toContain('PERMANENTLY')
    expect(resizeMessage(node({}), 's-8vcpu-16gb', false)).toContain('changed back')
    expect(resizeMessage(node({}), 's-8vcpu-16gb', false)).not.toContain('PERMANENTLY')
  })
})

describe('scaleMessage', () => {
  it('a GROW states the nodes joining and that they start billing', () => {
    const m = scaleMessage('pool-a', 3, 5)
    expect(m).toContain('from 3 to 5 nodes')
    expect(m).toContain('2 nodes join')
    expect(m).toContain('billing')
  })

  it('a SHRINK states that DIGITALOCEAN picks the victims — the proof we do not have', () => {
    const m = scaleMessage('pool-a', 5, 3)
    expect(m).toContain('DigitalOcean chooses which 2 nodes to destroy')
    expect(m).toContain('pod disruption budgets')
  })

  it('counts ONE node without a plural s, in both directions', () => {
    expect(scaleMessage('pool-a', 3, 4)).toContain('1 node join')
    expect(scaleMessage('pool-a', 3, 2)).toContain('which 1 node to destroy')
  })
})
