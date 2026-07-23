import { describe, it, expect } from 'vitest'

import type { Cluster } from '~/lib/api'
import {
  machinesFromClusters,
  parseInstanceType,
  monthlyCostUsd,
  deriveMachineStatus,
  summarize,
  filterMachines,
  distinct,
  paginate,
  pageCount,
  regionFlag,
  regionLabel,
  ageFrom,
  clusterNodeCount,
  fundingModel,
  fmtCredit,
} from './logic'

/**
 * The whole point of these tests: the Machines page renders ONLY real, derived
 * data. The row count must equal the real node count, per-node metrics the
 * control plane doesn't expose must stay undefined (never fabricated), and the
 * cost estimate must come from the platform's own price table.
 */
const cluster = (over: Partial<Cluster>): Cluster => ({
  name: 'demo',
  status: 'running',
  phase: 'ready',
  region: 'sfo3',
  ...over,
})

describe('parseInstanceType — vCPU/RAM from the DO size slug', () => {
  it('parses the standard `Nvcpu-Mgb` form', () => {
    expect(parseInstanceType('s-4vcpu-8gb')).toMatchObject({ vcpu: 4, memGb: 8, family: 'Basic' })
    expect(parseInstanceType('g-8vcpu-32gb')).toMatchObject({ vcpu: 8, memGb: 32, family: 'General Purpose' })
    expect(parseInstanceType('m-2vcpu-16gb')).toMatchObject({ vcpu: 2, memGb: 16, family: 'Memory-Optimized' })
  })
  it('maps the tokenless CPU-Optimized family explicitly', () => {
    expect(parseInstanceType('c-2')).toMatchObject({ vcpu: 2, memGb: 4, family: 'CPU-Optimized' })
    expect(parseInstanceType('c-8')).toMatchObject({ vcpu: 8, memGb: 16 })
  })
  it('returns undefined specs (never invented) for an unknown slug', () => {
    const s = parseInstanceType('mystery-box')
    expect(s.vcpu).toBeUndefined()
    expect(s.memGb).toBeUndefined()
    expect(s.label).toBe('mystery-box')
  })
})

describe('monthlyCostUsd — from the platform bill-from table, else undefined', () => {
  it('extrapolates the real hourly rate to a monthly estimate', () => {
    // s-2vcpu-4gb = 5¢/h → 5 * 730 / 100 = $36.50
    expect(monthlyCostUsd('s-2vcpu-4gb')).toBeCloseTo(36.5, 5)
    // s-4vcpu-8gb = 9¢/h → $65.70
    expect(monthlyCostUsd('s-4vcpu-8gb')).toBeCloseTo(65.7, 5)
  })
  it('is undefined (not 0, not invented) for an unpriced slug', () => {
    expect(monthlyCostUsd('totally-unknown')).toBeUndefined()
    expect(monthlyCostUsd(undefined)).toBeUndefined()
  })
})

describe('deriveMachineStatus — only honestly-derivable states', () => {
  it('running + ready → online', () => {
    expect(deriveMachineStatus({ status: 'running', phase: 'ready' })).toBe('online')
  })
  it('provisioning/installing → busy', () => {
    expect(deriveMachineStatus({ status: 'provisioning', phase: 'provisioning' })).toBe('busy')
    expect(deriveMachineStatus({ status: 'running', phase: 'installing' })).toBe('busy')
  })
  it('error / baselineError / deleting → offline', () => {
    expect(deriveMachineStatus({ status: 'error', phase: 'error' })).toBe('offline')
    expect(deriveMachineStatus({ status: 'running', phase: 'ready', baselineError: 'boom' })).toBe('offline')
    expect(deriveMachineStatus({ status: 'deleting' })).toBe('offline')
  })
})

describe('machinesFromClusters — one row per REAL node, fields mapped honestly', () => {
  it('emits exactly sum(pool.count) rows', () => {
    const clusters = [
      cluster({
        name: 'edge',
        doksClusterId: 'cl_1',
        nodePools: [
          { poolId: 'p1', name: 'default', size: 's-4vcpu-8gb', count: 3 },
          { poolId: 'p2', name: 'gpu', size: 'g-2vcpu-8gb', count: 2 },
        ],
      }),
    ]
    const ms = machinesFromClusters(clusters)
    expect(ms).toHaveLength(5)
    expect(ms.every((m) => m.group === 'edge')).toBe(true)
    expect(ms.every((m) => m.region === 'sfo3')).toBe(true)
    expect(ms.every((m) => m.instanceId === 'cl_1')).toBe(true)
    // real type + parsed spec on the first pool
    expect(ms[0]).toMatchObject({ type: 's-4vcpu-8gb', vcpu: 4, memGb: 8, status: 'online' })
    // ids are unique + stable
    expect(new Set(ms.map((m) => m.id)).size).toBe(5)
  })

  it('falls back to flat nodeSize/nodeCount when no pools (still real data)', () => {
    const ms = machinesFromClusters([cluster({ name: 'flat', nodeSize: 's-2vcpu-4gb', nodeCount: 2 })])
    expect(ms).toHaveLength(2)
    expect(ms[0].type).toBe('s-2vcpu-4gb')
  })

  it('emits NO rows for a cluster with no pools and no flat size', () => {
    expect(machinesFromClusters([cluster({ name: 'empty' })])).toHaveLength(0)
  })

  it('leaves per-node live metrics absent (never fabricated)', () => {
    const ms = machinesFromClusters([
      cluster({ nodePools: [{ poolId: 'p', name: 'd', size: 's-4vcpu-8gb', count: 1 }] }),
    ])
    const m = ms[0]
    // The Machine type carries no cpuPct/memPct/uptime fields at all — the table
    // renders "—" for those columns. We assert cost is the real estimate and the
    // created-at is the real cluster value, nothing more.
    expect(m.costMonthlyUsd).toBeCloseTo(65.7, 5)
    expect(Object.prototype.hasOwnProperty.call(m, 'cpuPct')).toBe(false)
  })
})

describe('summarize — real aggregates, lower-bounded cost when partial', () => {
  const ms = machinesFromClusters([
    cluster({
      name: 'a',
      status: 'running',
      phase: 'ready',
      nodePools: [{ poolId: 'p', name: 'd', size: 's-4vcpu-8gb', count: 2 }], // priced
    }),
    cluster({
      name: 'b',
      status: 'provisioning',
      phase: 'provisioning',
      nodePools: [{ poolId: 'p', name: 'd', size: 'weird-size', count: 1 }], // unpriced
    }),
  ])
  it('counts totals + online and sums parsed cores/mem', () => {
    const s = summarize(ms)
    expect(s.total).toBe(3)
    expect(s.online).toBe(2)
    expect(s.totalCores).toBe(8) // 4+4 (the unpriced/unknown node contributes 0)
    expect(s.totalMemGb).toBe(16)
    expect(s.byStatus).toMatchObject({ online: 2, busy: 1, offline: 0 })
  })
  it('marks cost incomplete when any node is unpriced', () => {
    const s = summarize(ms)
    expect(s.costComplete).toBe(false)
    expect(s.monthlyCostUsd).toBeCloseTo(65.7 * 2, 4)
  })
})

describe('filterMachines + distinct + pagination', () => {
  const ms = machinesFromClusters([
    cluster({ name: 'us', region: 'sfo3', nodePools: [{ poolId: 'p', name: 'd', size: 's-4vcpu-8gb', count: 2 }] }),
    cluster({ name: 'eu', region: 'fra1', status: 'error', phase: 'error', nodePools: [{ poolId: 'p', name: 'd', size: 'c-2', count: 1 }] }),
  ])
  it('filters by group/region/status/type and free text', () => {
    expect(filterMachines(ms, { region: 'fra1' })).toHaveLength(1)
    expect(filterMachines(ms, { status: 'offline' })).toHaveLength(1)
    expect(filterMachines(ms, { type: 's-4vcpu-8gb' })).toHaveLength(2)
    expect(filterMachines(ms, { q: 'eu' })).toHaveLength(1)
    expect(filterMachines(ms, { group: 'all' })).toHaveLength(3) // 'all' = no filter
  })
  it('distinct returns sorted unique facets', () => {
    expect(distinct(ms, 'region')).toEqual(['fra1', 'sfo3'])
    expect(distinct(ms, 'group')).toEqual(['eu', 'us'])
  })
  it('paginates the real rows', () => {
    expect(pageCount(3, 2)).toBe(2)
    expect(paginate(ms, 0, 2)).toHaveLength(2)
    expect(paginate(ms, 1, 2)).toHaveLength(1)
  })
})

describe('presentation helpers', () => {
  it('regionFlag/regionLabel decorate a real region code', () => {
    expect(regionFlag('sfo3')).toBe('🇺🇸')
    expect(regionLabel('fra1')).toBe('Frankfurt')
    expect(regionFlag('zzz9')).toBe('') // unknown → no flag, region stays real
  })
  it('ageFrom renders a stable age from a fixed now', () => {
    const now = Date.parse('2026-06-10T00:00:00Z')
    expect(ageFrom('2026-06-07T00:00:00Z', now)).toBe('3d 0h')
    expect(ageFrom(undefined, now)).toBe('—')
  })
  it('clusterNodeCount sums real pool counts', () => {
    expect(
      clusterNodeCount(
        cluster({ nodePools: [{ count: 3 }, { count: 2 }] }),
      ),
    ).toBe(5)
  })
})

/**
 * Funding model — the CPU-credit vs GPU-prepay-card distinction the customer sees.
 * It must ALWAYS match what the server enforces: a CPU machine is credit-funded (no
 * card), a GPU is card-prepay only (never credits) and blocks without a card.
 */
describe('fundingModel', () => {
  it('fmtCredit renders whole dollars with thousands separators', () => {
    expect(fmtCredit(2_046_235)).toBe('$20,462') // Dave/maxpower's ~$20,462 credit
    expect(fmtCredit(0)).toBe('$0')
    expect(fmtCredit(99)).toBe('$1') // rounds to the nearest dollar
  })

  it('CPU is credit-funded (no card), and shows the available balance when known', () => {
    const f = fundingModel('cpu', { creditCents: 2_046_235 })
    expect(f.source).toBe('credit')
    expect(f.needsFunds).toBe(false)
    expect(f.headline).toMatch(/credit/i)
    expect(f.detail).toContain('$20,462 available')
    expect(f.detail).toMatch(/no card/i)
    expect(f.cta).toEqual({ label: 'Add credits', href: '/wallet' })
  })

  it('CPU stays honest (still "on credits", no figure) when the balance is unknown', () => {
    const f = fundingModel('cpu', { creditCents: null })
    expect(f.source).toBe('credit')
    expect(f.needsFunds).toBe(false)
    expect(f.detail).not.toContain('available')
    expect(f.detail).toMatch(/charged to credits/i)
  })

  it('CPU with an empty credit balance needs funds → add credits', () => {
    const f = fundingModel('cpu', { creditCents: 0 })
    expect(f.source).toBe('credit')
    expect(f.needsFunds).toBe(true)
    expect(f.cta.href).toBe('/wallet')
  })

  it('GPU is prepay-card only (never credits) with the first hour upfront', () => {
    const f = fundingModel('gpu', { hasCard: true })
    expect(f.source).toBe('card')
    expect(f.needsFunds).toBe(false)
    expect(f.headline).toMatch(/prepay/i)
    expect(f.headline).toMatch(/card/i)
    expect(f.detail).toMatch(/first hour charged upfront/i)
    expect(f.detail).toMatch(/credits can’t be used/i)
  })

  it('GPU without a card on file needs funds → add a card', () => {
    const f = fundingModel('gpu', { hasCard: false })
    expect(f.source).toBe('card')
    expect(f.needsFunds).toBe(true)
    expect(f.cta).toEqual({ label: 'Add a payment card & prepay', href: '/billing/credits' })
  })

  it('GPU never claims the credit balance funds it, even with credit present', () => {
    const f = fundingModel('gpu', { hasCard: true, creditCents: 5_000_000 })
    expect(f.source).toBe('card')
    expect(f.detail).not.toContain('available')
  })
})
