import { describe, it, expect } from 'vitest'

import {
  buildTree,
  foldEvents,
  normalizeCompute,
  type ComputeEvent,
  type ComputeLeaf,
} from './admin-compute'

/**
 * The compute-analytics client folds the datastore's raw compute events (the
 * coordinated 9 columns incl. `kind`) — or consumes cloud's pre-aggregated leaves —
 * into ONE kind's org → app → project tree (the Bots or Machines board). Every path
 * is pure + optional-safe: a missing field degrades to 0/'', an unroutable endpoint
 * yields an empty tree, and no figure is ever fabricated.
 */

const ev = (p: Partial<ComputeEvent>): ComputeEvent => ({
  org: 'acme',
  app: 'web',
  project: 'prod',
  kind: 'machine',
  event: 'provision',
  machineId: 'm1',
  size: 's-1vcpu-1gb',
  priceCents: 0,
  ts: '2026-07-01T00:00:00Z',
  ...p,
})

describe('foldEvents — raw events → per-(org,app,project) leaves (single kind)', () => {
  it('counts distinct units, active (latest non-terminal), spend, sizes', () => {
    const events: ComputeEvent[] = [
      ev({ machineId: 'm1', event: 'provision', size: 's-1', priceCents: 100, ts: '2026-07-01T00:00:00Z' }),
      // m1 later stopped → inactive; a $0 lifecycle row still folds into the same leaf.
      ev({ machineId: 'm1', event: 'stop', size: 's-1', priceCents: 0, ts: '2026-07-01T05:00:00Z' }),
      ev({ machineId: 'm2', event: 'start', size: 's-2', priceCents: 200, ts: '2026-07-01T01:00:00Z' }),
      ev({ machineId: 'm3', event: 'start', size: 's-1', priceCents: 50, ts: '2026-07-01T02:00:00Z' }),
    ]
    const leaves = foldEvents(events)
    expect(leaves).toHaveLength(1)
    const leaf = leaves[0]
    expect(leaf.org).toBe('acme')
    expect(leaf.kind).toBe('machine')
    expect(leaf.count).toBe(3) // m1, m2, m3
    expect(leaf.active).toBe(2) // m2 + m3 (m1's latest event is stop → terminal)
    expect(leaf.spendCents).toBe(350) // 100 + 0 + 200 + 50
    expect(leaf.lastTs).toBe('2026-07-01T05:00:00Z')
    // sizes: s-1 has m1 + m3 = 2, s-2 has m2 = 1, sorted desc by count.
    expect(leaf.sizes).toEqual([
      { size: 's-1', count: 2 },
      { size: 's-2', count: 1 },
    ])
  })

  it('carries the leaf kind from its events (bot lens)', () => {
    const leaves = foldEvents([ev({ kind: 'bot', machineId: 'b1' })])
    expect(leaves[0].kind).toBe('bot')
    expect(leaves[0].count).toBe(1)
  })

  it('separates leaves by (org, app, project)', () => {
    const events: ComputeEvent[] = [
      ev({ org: 'acme', app: 'web', project: 'prod', machineId: 'a' }),
      ev({ org: 'acme', app: 'web', project: 'staging', machineId: 'b' }),
      ev({ org: 'globex', app: 'api', project: 'prod', machineId: 'c' }),
    ]
    expect(foldEvents(events)).toHaveLength(3)
  })

  it('a unit whose only event is unknown is treated as active (non-terminal default)', () => {
    expect(foldEvents([ev({ machineId: 'm1', event: 'somethingWeird' })])[0].active).toBe(1)
  })
})

describe('buildTree — group leaves into org → app → project, rolled up + sorted', () => {
  const leaf = (p: Partial<ComputeLeaf>): ComputeLeaf => ({
    org: 'acme',
    app: 'web',
    project: 'prod',
    kind: 'machine',
    count: 1,
    active: 1,
    spendCents: 0,
    lastTs: '2026-07-01T00:00:00Z',
    sizes: [],
    ...p,
  })

  it('rolls count/active/spend up app and org levels', () => {
    const { orgs, totals } = buildTree([
      leaf({ org: 'acme', app: 'web', project: 'prod', count: 2, active: 2, spendCents: 300 }),
      leaf({ org: 'acme', app: 'web', project: 'staging', count: 1, active: 0, spendCents: 100 }),
      leaf({ org: 'acme', app: 'api', project: 'prod', count: 3, active: 3, spendCents: 600 }),
    ])
    expect(orgs).toHaveLength(1)
    const acme = orgs[0]
    expect(acme.count).toBe(6)
    expect(acme.active).toBe(5)
    expect(acme.spendCents).toBe(1000)
    // two apps under acme, sorted by spend desc: api (600) before web (400).
    expect(acme.apps.map((a) => a.app)).toEqual(['api', 'web'])
    // web's two projects sorted by spend desc: prod (300) before staging (100).
    const web = acme.apps.find((a) => a.app === 'web')!
    expect(web.projects.map((p) => p.project)).toEqual(['prod', 'staging'])
    expect(totals).toEqual({ count: 6, active: 5, spendCents: 1000 })
  })

  it('sorts orgs by spend desc', () => {
    const { orgs } = buildTree([
      leaf({ org: 'small', spendCents: 10 }),
      leaf({ org: 'big', spendCents: 9000 }),
      leaf({ org: 'mid', spendCents: 500 }),
    ])
    expect(orgs.map((o) => o.org)).toEqual(['big', 'mid', 'small'])
  })

  it('substitutes an em-dash-safe sentinel for a missing org/app/project', () => {
    const { orgs } = buildTree([leaf({ org: '', app: '', project: '' })])
    expect(orgs[0].org).toBe('—')
    expect(orgs[0].apps[0].app).toBe('—')
    expect(orgs[0].apps[0].projects[0].project).toBe('—')
  })
})

describe('normalizeCompute — optional-safe, kind-filtered, over both backend shapes', () => {
  it('consumes pre-aggregated { leaves } (the cheap datastore GROUP BY path)', () => {
    const tree = normalizeCompute(
      {
        range: '7d',
        leaves: [{ org: 'acme', app: 'web', project: 'prod', kind: 'machine', count: 4, active: 3, spendCents: 1200 }],
      },
      'machine',
    )
    expect(tree.kind).toBe('machine')
    expect(tree.range).toBe('7d')
    expect(tree.orgs).toHaveLength(1)
    expect(tree.totals).toEqual({ count: 4, active: 3, spendCents: 1200 })
  })

  it('filters leaves to the requested kind (drops the other lens if present)', () => {
    const tree = normalizeCompute(
      {
        leaves: [
          { org: 'acme', app: 'web', project: 'prod', kind: 'machine', count: 4, spendCents: 100 },
          { org: 'acme', app: 'web', project: 'prod', kind: 'bot', count: 2, spendCents: 999 },
        ],
      },
      'bot',
    )
    expect(tree.totals).toEqual({ count: 2, active: 0, spendCents: 999 })
  })

  it('folds raw { events } (the exact datastore schema) — snake_case tolerated', () => {
    const tree = normalizeCompute(
      {
        range: '30d',
        events: [
          { org: 'acme', app: 'web', project: 'prod', kind: 'machine', event: 'provision', machine_id: 'm1', size: 's-1', price_cents: 500, ts: '2026-07-01T00:00:00Z' },
        ],
      },
      'machine',
    )
    expect(tree.orgs).toHaveLength(1)
    expect(tree.orgs[0].spendCents).toBe(500)
    expect(tree.orgs[0].apps[0].projects[0].count).toBe(1)
  })

  it('folds a bare array of events (shape-detected by event/machine_id), kind-filtered', () => {
    const tree = normalizeCompute(
      [
        { org: 'a', app: 'x', project: 'p', kind: 'machine', event: 'start', machine_id: 'm', size: 's', price_cents: 1, ts: '2026-07-01T00:00:00Z' },
        { org: 'a', app: 'x', project: 'p', kind: 'bot', event: 'start', machine_id: 'b', size: 's', price_cents: 9, ts: '2026-07-01T00:00:00Z' },
      ],
      'machine',
    )
    expect(tree.orgs).toHaveLength(1)
    expect(tree.totals.spendCents).toBe(1) // only the machine row
  })

  it('degrades an empty / garbage payload to an empty tree with zero totals (never fabricated)', () => {
    for (const bad of [{}, null, undefined, { range: '24h' }, { leaves: [] }, 42, 'nope']) {
      const tree = normalizeCompute(bad, 'machine')
      expect(tree.orgs).toEqual([])
      expect(tree.totals).toEqual({ count: 0, active: 0, spendCents: 0 })
    }
  })
})


describe("the widened kind spectrum — cluster / nodepool / function are first-class", () => {
  it("folds a cluster leaf under kind=cluster and keeps it off the machine board", () => {
    const raw = {
      leaves: [
        { org: "acme", app: "", project: "", kind: "cluster", count: 2, active: 2, spendCents: 0 },
        { org: "acme", app: "web", project: "prod", kind: "machine", count: 5, active: 5, spendCents: 100 },
      ],
    }
    expect(normalizeCompute(raw, "cluster").totals).toEqual({ count: 2, active: 2, spendCents: 0 })
    expect(normalizeCompute(raw, "machine").totals).toEqual({ count: 5, active: 5, spendCents: 100 })
  })

  it("folds nodepool events with their CostPerHour price under kind=nodepool", () => {
    const tree = normalizeCompute(
      { events: [ev({ kind: "nodepool", machineId: "pool-1", event: "running", priceCents: 24 })] },
      "nodepool",
    )
    expect(tree.kind).toBe("nodepool")
    expect(tree.totals.spendCents).toBe(24)
    expect(tree.orgs[0].apps[0].projects[0].count).toBe(1)
  })

  it("keeps a function leaf under kind=function and honest-empty elsewhere", () => {
    const raw = { leaves: [{ org: "acme", app: "", project: "", kind: "function", count: 3, active: 1, spendCents: 7 }] }
    expect(normalizeCompute(raw, "function").totals).toEqual({ count: 3, active: 1, spendCents: 7 })
    expect(normalizeCompute(raw, "machine").orgs).toEqual([])
  })

  it("normalizes an out-of-spectrum kind to machine (open column, safe fallback)", () => {
    const tree = normalizeCompute({ leaves: [{ org: "acme", kind: "quantum-toaster", count: 1, spendCents: 0 }] }, "machine")
    expect(tree.totals.count).toBe(1)
  })
})
