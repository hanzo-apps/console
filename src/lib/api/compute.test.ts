import { describe, it, expect } from 'vitest'

import {
  gpuSpecOf,
  gpuClustersOf,
  totalDerivedGpus,
  summarize,
  filterGpus,
  uniqueValues,
  paginate,
  normalizeGpu,
  normalizeLedger,
  fmtPct,
  fmtUptime,
  shortUuid,
  usd,
  emptyFilter,
  type Gpu,
} from './compute'
import type { Cluster } from './platform'

const cluster = (over: Partial<Cluster>): Cluster => ({ name: 'c', status: 'ready', ...over })

describe('gpuSpecOf — real node-size slug → model + per-node count', () => {
  it('parses DigitalOcean GPU Droplet slugs', () => {
    expect(gpuSpecOf('gpu-h100x8-640gb')).toEqual({ model: 'H100', perNode: 8 })
    expect(gpuSpecOf('gpu-h100x1-80gb')).toEqual({ model: 'H100', perNode: 1 })
    expect(gpuSpecOf('gpu-l40sx1-48gb')).toEqual({ model: 'L40S', perNode: 1 })
    expect(gpuSpecOf('gpu-a100x8-640gb')).toEqual({ model: 'A100', perNode: 8 })
  })
  it('parses common AWS GPU instance families', () => {
    expect(gpuSpecOf('p5.48xlarge')).toEqual({ model: 'H100', perNode: 8 })
    expect(gpuSpecOf('p4d.24xlarge')).toEqual({ model: 'A100', perNode: 8 })
    expect(gpuSpecOf('g5.12xlarge')).toEqual({ model: 'A10G', perNode: 4 })
  })
  it('returns null for non-GPU slugs and empties (no fabrication)', () => {
    expect(gpuSpecOf('s-4vcpu-8gb')).toBeNull()
    expect(gpuSpecOf('c-4-8gb')).toBeNull()
    expect(gpuSpecOf('')).toBeNull()
    expect(gpuSpecOf(undefined)).toBeNull()
  })
})

describe('gpuClustersOf / totalDerivedGpus — real counts from real clusters', () => {
  const clusters: Cluster[] = [
    cluster({ name: 'train', nodeSize: 'gpu-h100x8-640gb', nodeCount: 2 }),
    cluster({ name: 'infer', nodeSize: 'gpu-l40sx1-48gb', nodeCount: 3 }),
    cluster({ name: 'web', nodeSize: 's-4vcpu-8gb', nodeCount: 5 }),
  ]
  it('keeps only GPU clusters and computes perNode × nodeCount', () => {
    const gcs = gpuClustersOf(clusters)
    expect(gcs.map((g) => g.cluster.name)).toEqual(['train', 'infer'])
    expect(gcs.find((g) => g.cluster.name === 'train')!.gpuCount).toBe(16) // 8 × 2
    expect(gcs.find((g) => g.cluster.name === 'infer')!.gpuCount).toBe(3) // 1 × 3
  })
  it('defaults nodeCount to 1 when absent', () => {
    expect(gpuClustersOf([cluster({ nodeSize: 'gpu-h100x1-80gb' })])[0].gpuCount).toBe(1)
  })
  it('totals across GPU clusters', () => {
    expect(totalDerivedGpus(gpuClustersOf(clusters))).toBe(19)
  })
})

describe('summarize — inventory wins, else cluster derivation, else none', () => {
  const gpus: Gpu[] = [
    { id: 'a', model: 'H100', status: 'online', utilization: 80, memoryUtil: 50 },
    { id: 'b', model: 'H100', status: 'offline', utilization: 0, memoryUtil: 10 },
    { id: 'c', model: 'A100', status: 'online' }, // no telemetry
  ]
  it('uses inventory rows + telemetry when present', () => {
    const s = summarize(true, gpus, [])
    expect(s.source).toBe('inventory')
    expect(s.total).toBe(3)
    expect(s.online).toBe(2)
    expect(s.utilAvg).toBe(40) // mean of 80 and 0 (c omitted — no telemetry)
    expect(s.byModel).toEqual([
      { model: 'H100', count: 2 },
      { model: 'A100', count: 1 },
    ])
  })
  it('falls back to real cluster counts, telemetry null (honest —)', () => {
    const gcs = gpuClustersOf([cluster({ nodeSize: 'gpu-h100x8-640gb', nodeCount: 1 })])
    const s = summarize(false, [], gcs)
    expect(s.source).toBe('clusters')
    expect(s.total).toBe(8)
    expect(s.online).toBeNull()
    expect(s.utilAvg).toBeNull()
  })
  it('is fully null when nothing is known (not-configured)', () => {
    const s = summarize(true, [], [])
    expect(s).toMatchObject({ total: null, online: null, utilAvg: null, source: 'none', byModel: [] })
  })
})

describe('filterGpus / uniqueValues / paginate', () => {
  const gpus: Gpu[] = [
    { id: '1', name: 'node-a', model: 'H100', cluster: 'train', status: 'online', location: 'sfo3' },
    { id: '2', name: 'node-b', model: 'A100', cluster: 'infer', status: 'offline', location: 'nyc1' },
    { id: '3', name: 'node-c', model: 'H100', cluster: 'train', status: 'online', location: 'sfo3' },
  ]
  it('filters by facet and free-text', () => {
    expect(filterGpus(gpus, { ...emptyFilter, model: 'H100' }).map((g) => g.id)).toEqual(['1', '3'])
    expect(filterGpus(gpus, { ...emptyFilter, status: 'offline' }).map((g) => g.id)).toEqual(['2'])
    expect(filterGpus(gpus, { ...emptyFilter, q: 'node-b' }).map((g) => g.id)).toEqual(['2'])
    expect(filterGpus(gpus, emptyFilter)).toHaveLength(3)
  })
  it('lists distinct sorted facet values', () => {
    expect(uniqueValues(gpus, 'cluster')).toEqual(['infer', 'train'])
    expect(uniqueValues(gpus, 'model')).toEqual(['A100', 'H100'])
  })
  it('paginates and clamps the page', () => {
    expect(paginate(gpus, 1, 2)).toMatchObject({ page: 1, pages: 2, total: 3 })
    expect(paginate(gpus, 99, 2).page).toBe(2)
    expect(paginate(gpus, 2, 2).rows.map((g) => g.id)).toEqual(['3'])
  })
})

describe('normalizeGpu — defensive (string/number, alt field names)', () => {
  it('coerces numeric strings and maps alternates', () => {
    const g = normalizeGpu({ uuid: 'GPU-xyz', gpuModel: 'H100', util: '73', tempC: 61, node: 'train-1' })
    expect(g.model).toBe('H100')
    expect(g.utilization).toBe(73)
    expect(g.temperature).toBe(61)
    expect(g.cluster).toBe('train-1')
  })
  it('leaves telemetry undefined when absent (renders — not 0)', () => {
    const g = normalizeGpu({ id: 'a' })
    expect(g.utilization).toBeUndefined()
    expect(g.temperature).toBeUndefined()
  })
  it('passes provider through so cloud vs BYO can be badged', () => {
    expect(normalizeGpu({ id: 'a', provider: 'doks' }).provider).toBe('doks')
    expect(normalizeGpu({ id: 'b', provider: 'byo' }).provider).toBe('byo')
    expect(normalizeGpu({ id: 'c' }).provider).toBeUndefined()
  })
  it('tolerates a BYO GPU’s string memory (GB10 128GB) → numeric VRAM', () => {
    // On-prem/BYO agents report memory as a unit-suffixed string, not memoryTotalGb.
    expect(normalizeGpu({ id: 'spark', model: 'GB10', provider: 'byo', memory: '128GB' }).memoryTotalGb).toBe(128)
    expect(normalizeGpu({ id: 'b', memory: '80 GiB' }).memoryTotalGb).toBe(80)
    expect(normalizeGpu({ id: 'c', memory: '131072MB' }).memoryTotalGb).toBe(128)
    // The numeric DOKS field still wins and is untouched.
    expect(normalizeGpu({ id: 'd', memoryTotalGb: 80, memory: 'garbage' }).memoryTotalGb).toBe(80)
    // Unparseable memory → undefined (renders —, never a fabricated 0).
    expect(normalizeGpu({ id: 'e', memory: 'n/a' }).memoryTotalGb).toBeUndefined()
  })
})

describe('normalizeLedger — cloud_usage rows → total + daily + breakdown', () => {
  it('aggregates raw ledger rows by day, model, and provider', () => {
    const led = normalizeLedger({
      usages: [
        { timestamp: '2026-06-20T10:00:00Z', model: 'zen', provider: 'do-ai', cost_cents: 120, total_tokens: 1000 },
        { timestamp: '2026-06-20T12:00:00Z', model: 'zen', provider: 'do-ai', cost_cents: 80, total_tokens: 500 },
        { timestamp: '2026-06-21T09:00:00Z', model: 'gpt', provider: 'openai', cost_cents: 50 },
      ],
    })
    expect(led.totalCents).toBe(250)
    expect(led.daily).toEqual([
      { day: '2026-06-20', cents: 200 },
      { day: '2026-06-21', cents: 50 },
    ])
    expect(led.byModel[0]).toEqual({ label: 'zen', cents: 200, tokens: 1500 })
    expect(led.byProvider.map((p) => p.label)).toContain('openai')
  })
  it('accepts a pre-aggregated payload unchanged', () => {
    const led = normalizeLedger({ totalCents: 999, daily: [{ day: '2026-06-21', cost_cents: 999 }] })
    expect(led.totalCents).toBe(999)
    expect(led.daily).toEqual([{ day: '2026-06-21', cents: 999 }])
  })
  it('is empty-safe', () => {
    expect(normalizeLedger({})).toMatchObject({ totalCents: 0, daily: [], byModel: [] })
  })
})

describe('formatters — honest — for absent values', () => {
  it('renders — for null/undefined, never 0', () => {
    expect(fmtPct(null)).toBe('—')
    expect(fmtPct(73.4)).toBe('73%')
    expect(usd(null)).toBe('—')
    expect(usd(250)).toBe('$2.50')
    expect(fmtUptime(undefined)).toBe('—')
    expect(fmtUptime(90000)).toBe('1d 1h')
    expect(shortUuid('GPU-abcdef1234567890', 'x')).toBe('abcdef12…90')
    expect(shortUuid(undefined, 'fallback')).toBe('fallback')
  })
})
