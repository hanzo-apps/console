import { describe, it, expect } from 'vitest'
import type { UsageRecord } from '~/lib/api/aimetrics'
import type { CatalogModel } from '~/lib/api/models-catalog'
import type { RawMlEndpoint } from '~/lib/api/inference'
import {
  deltaPct,
  deriveMlPhase,
  distinctLevels,
  distinctModels,
  distinctTypes,
  endpointDailyRequests,
  endpointMetrics,
  endpointType,
  endpointUrl,
  filterEndpoints,
  fmtCount,
  fmtDelta,
  fmtUsd,
  fromCatalogModel,
  fromMlEndpoint,
  logDetailFacts,
  logsFromRecords,
  mergeEndpoints,
  paginate,
  perModelMap,
  requestsByModel,
  sortEndpoints,
  statusSummary,
  usageWindow,
  type Endpoint,
} from './logic'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-07-02T12:00:00Z')

function rec(over: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    cents: over.cents ?? 0,
    model: over.model ?? '',
    provider: over.provider ?? '',
    product: over.product ?? '',
    agent: over.agent ?? '',
    promptTokens: over.promptTokens ?? 0,
    completionTokens: over.completionTokens ?? 0,
    totalTokens: over.totalTokens ?? 0,
    at: over.at ?? NOW,
    notes: over.notes ?? '',
    premium: over.premium ?? false,
    stream: over.stream ?? false,
    status: over.status ?? '',
    requestId: over.requestId ?? '',
  }
}

describe('endpointType', () => {
  it('classifies from the real id, defaulting to Text Generation', () => {
    expect(endpointType('embed-8b')).toBe('Embeddings')
    expect(endpointType('text-embedding-3-large')).toBe('Embeddings')
    expect(endpointType('rerank-2b')).toBe('Reranking')
    expect(endpointType('tts-1b')).toBe('Audio')
    expect(endpointType('whisper-large')).toBe('Audio')
    expect(endpointType('vision-2b')).toBe('Vision')
    expect(endpointType('qwen2-vl-7b')).toBe('Vision')
    expect(endpointType('flux-schnell')).toBe('Vision')
    expect(endpointType('zen-3-32b')).toBe('Text Generation')
    expect(endpointType('')).toBe('Text Generation')
  })
})

describe('deriveMlPhase', () => {
  it('reads live KServe conditions, never assumes operational', () => {
    expect(deriveMlPhase(undefined)).toBe('provisioning')
    expect(deriveMlPhase({})).toBe('provisioning')
    expect(deriveMlPhase({ conditions: [{ type: 'Ready', status: 'True' }] })).toBe('ready')
    expect(deriveMlPhase({ conditions: [{ type: 'Ready', status: 'Unknown' }] })).toBe('provisioning')
    expect(deriveMlPhase({ conditions: [{ type: 'Ready', status: 'False', reason: 'RevisionFailed' }] })).toBe('failed')
    expect(deriveMlPhase({ conditions: [{ type: 'Ready', status: 'False', reason: 'IngressNotConfigured' }] })).toBe('provisioning')
    expect(deriveMlPhase({ conditions: [{ type: 'PredictorReady', status: 'False', reason: 'ModelLoadError' }] })).toBe('failed')
    expect(deriveMlPhase({ conditions: [{ type: 'PredictorReady', status: 'True' }] })).toBe('provisioning')
  })
})

describe('endpointUrl', () => {
  it('prefers the in-cluster address.url, falls back to url, else empty', () => {
    expect(endpointUrl({ address: { url: 'http://svc.ml' }, url: 'https://ext' })).toBe('http://svc.ml')
    expect(endpointUrl({ url: 'https://ext' })).toBe('https://ext')
    expect(endpointUrl({})).toBe('')
    expect(endpointUrl(undefined)).toBe('')
  })
})

describe('normalizers', () => {
  it('fromCatalogModel → managed/available', () => {
    const m: CatalogModel = { id: 'zen-3-32b', object: 'model', created: 1_700_000_000, owned_by: 'hanzo', premium: true, pricing: null }
    const e = fromCatalogModel(m)
    expect(e).toMatchObject({ id: 'managed:zen-3-32b', name: 'zen-3-32b', kind: 'managed', provider: 'hanzo', type: 'Text Generation', phase: 'available', phaseLabel: 'Available', premium: true, url: '' })
    expect(e.createdAt).toBe(1_700_000_000 * 1000)
  })

  it('fromMlEndpoint → deployed with real phase + url', () => {
    const r: RawMlEndpoint = { name: 'my-llama', createdAt: '2026-07-01T00:00:00Z', status: { conditions: [{ type: 'Ready', status: 'True' }], address: { url: 'http://my-llama.ml-acme' } } }
    const e = fromMlEndpoint(r)
    expect(e).toMatchObject({ id: 'deployed:my-llama', name: 'my-llama', kind: 'deployed', phase: 'ready', phaseLabel: 'Ready', url: 'http://my-llama.ml-acme', premium: false })
    expect(e.createdAt).toBe(Date.parse('2026-07-01T00:00:00Z'))
  })
})

describe('mergeEndpoints', () => {
  it('a deployed endpoint wins over a same-named managed one; deployed sort first', () => {
    const managed = [fromCatalogModel({ id: 'zen-3-32b', object: 'model', created: 0, owned_by: 'hanzo', pricing: null }), fromCatalogModel({ id: 'my-llama', object: 'model', created: 0, owned_by: 'hanzo', pricing: null })]
    const deployed = [fromMlEndpoint({ name: 'my-llama', status: { conditions: [{ type: 'Ready', status: 'True' }] } })]
    const merged = mergeEndpoints(managed, deployed)
    expect(merged.map((e) => `${e.kind}:${e.name}`)).toEqual(['deployed:my-llama', 'managed:zen-3-32b'])
  })
})

describe('filter / sort / paginate', () => {
  const list: Endpoint[] = [
    fromCatalogModel({ id: 'zen-3-32b', object: 'model', created: 3, owned_by: 'hanzo', pricing: null }),
    fromCatalogModel({ id: 'embed-8b', object: 'model', created: 1, owned_by: 'hanzo', pricing: null }),
    fromMlEndpoint({ name: 'custom-vlm-vision', createdAt: '2026-07-02T00:00:00Z', status: { conditions: [{ type: 'Ready', status: 'False', reason: 'ModelLoadFailed' }] } }),
  ]

  it('distinctTypes reflects only real types present', () => {
    expect(distinctTypes(list)).toEqual(['Embeddings', 'Text Generation', 'Vision'])
  })

  it('filters by q, type, phase', () => {
    expect(filterEndpoints(list, { q: 'embed', type: 'all', phase: 'all' }).map((e) => e.name)).toEqual(['embed-8b'])
    expect(filterEndpoints(list, { q: '', type: 'Vision', phase: 'all' }).map((e) => e.name)).toEqual(['custom-vlm-vision'])
    expect(filterEndpoints(list, { q: '', type: 'all', phase: 'failed' }).map((e) => e.name)).toEqual(['custom-vlm-vision'])
    expect(filterEndpoints(list, { q: 'nomatch', type: 'all', phase: 'all' })).toEqual([])
  })

  it('sorts by name, recent, and real request counts', () => {
    expect(sortEndpoints(list, 'name').map((e) => e.name)).toEqual(['custom-vlm-vision', 'embed-8b', 'zen-3-32b'])
    // recent = newest createdAt first (custom is 2026-07-02, then zen=3, embed=1)
    expect(sortEndpoints(list, 'recent').map((e) => e.name)).toEqual(['custom-vlm-vision', 'zen-3-32b', 'embed-8b'])
    const req = new Map([['embed-8b', 100], ['zen-3-32b', 5]])
    expect(sortEndpoints(list, 'requests', req).map((e) => e.name)).toEqual(['embed-8b', 'zen-3-32b', 'custom-vlm-vision'])
  })

  it('paginate slices + reports honest counts and clamps out-of-range pages', () => {
    const p1 = paginate([1, 2, 3, 4, 5], 1, 2)
    expect(p1).toMatchObject({ slice: [1, 2], page: 1, pages: 3, from: 1, to: 2, total: 5 })
    const p9 = paginate([1, 2, 3, 4, 5], 9, 2)
    expect(p9).toMatchObject({ slice: [5], page: 3, from: 5, to: 5 })
    const p0 = paginate([], 1, 2)
    expect(p0).toMatchObject({ slice: [], pages: 1, from: 0, to: 0, total: 0 })
  })
})

describe('per-endpoint metrics from the real ledger', () => {
  const records: UsageRecord[] = [
    rec({ model: 'zen-3-32b', at: NOW - 1 * DAY, totalTokens: 100, cents: 5 }),
    rec({ model: 'zen-3-32b', at: NOW - 1 * DAY, totalTokens: 100, cents: 5 }),
    rec({ model: 'zen-3-32b', at: NOW - 3 * DAY, totalTokens: 50, cents: 2 }),
    rec({ model: 'embed-8b', at: NOW - 2 * DAY, totalTokens: 10, cents: 1 }),
  ]
  const zen = fromCatalogModel({ id: 'zen-3-32b', object: 'model', created: 0, owned_by: 'hanzo', pricing: null })
  const unused = fromCatalogModel({ id: 'never-called', object: 'model', created: 0, owned_by: 'hanzo', pricing: null })

  it('perModelMap + requestsByModel are real ledger counts within the window', () => {
    const map = perModelMap(records, '7d', NOW)
    expect(map.get('zen-3-32b')?.requests).toBe(3)
    expect(requestsByModel(records, '7d', NOW).get('embed-8b')).toBe(1)
  })

  it('endpointDailyRequests is a dense real series for the endpoint model', () => {
    const s = endpointDailyRequests(records, 'zen-3-32b', '7d', NOW)
    expect(s.length).toBe(7)
    expect(s.reduce((a, b) => a + b, 0)).toBe(3) // 2 + 1 across the window
  })

  it('endpointMetrics: real requests + series; p95/uptime always null; no ledger → all null', () => {
    const map = perModelMap(records, '7d', NOW)
    const m = endpointMetrics(zen, map, records, '7d', NOW, true)
    expect(m.requests).toBe(3)
    expect(m.series.reduce((a, b) => a + b, 0)).toBe(3)
    expect(m.p95Ms).toBeNull()
    expect(m.uptimePct).toBeNull()
    // a model with no rows → real 0 (honest), not fabricated
    expect(endpointMetrics(unused, map, records, '7d', NOW, true).requests).toBe(0)
    // ledger absent → everything "—"
    const none = endpointMetrics(zen, map, records, '7d', NOW, false)
    expect(none.requests).toBeNull()
    expect(none.series).toEqual([])
  })
})

describe('deltaPct + usageWindow', () => {
  it('deltaPct is null with no honest basis', () => {
    expect(deltaPct(10, 0)).toBeNull()
    expect(deltaPct(10, 5)).toBe(100)
    expect(deltaPct(5, 10)).toBe(-50)
  })

  it('usageWindow rolls real totals + prior-period deltas + a dense series', () => {
    const records: UsageRecord[] = [
      // current window (last 7d): 2 requests, 300 tokens, 10c
      rec({ at: NOW - 1 * DAY, totalTokens: 200, cents: 6 }),
      rec({ at: NOW - 2 * DAY, totalTokens: 100, cents: 4 }),
      // prior window (7–14d ago): 1 request, 100 tokens, 4c
      rec({ at: NOW - 9 * DAY, totalTokens: 100, cents: 4 }),
    ]
    const w = usageWindow(records, '7d', NOW)
    expect(w.requests).toBe(2)
    expect(w.tokens).toBe(300)
    expect(w.cents).toBe(10)
    expect(w.series.requests.length).toBe(7)
    expect(w.delta.requests).toBe(100) // 2 vs prior 1
    expect(w.delta.tokens).toBe(200) // 300 vs prior 100
    expect(w.delta.cents).toBe(150) // 10 vs prior 4
  })

  it('usageWindow with no usage → real zeros + null deltas (honest, never invented)', () => {
    const w = usageWindow([], '7d', NOW)
    expect(w.requests).toBe(0)
    expect(w.cents).toBe(0)
    expect(w.delta.requests).toBeNull()
  })
})

describe('logsFromRecords', () => {
  const records: UsageRecord[] = [
    rec({ id: 'a', model: 'zen-3-32b', at: NOW - 1000, status: 'success', notes: 'API usage: zen-3-32b (120 tokens)' }),
    rec({ id: 'b', model: 'embed-8b', at: NOW - 5000, status: 'error', totalTokens: 10, cents: 1 }),
    rec({ id: 'c', model: 'zen-3-32b', at: NOW - 9000, status: 'success' }),
  ]

  it('projects real recorded requests newest-first with filters + a composed message', () => {
    const all = logsFromRecords(records, { endpoint: 'all', level: 'all' }, 10)
    expect(all.map((l) => l.id)).toEqual(['a', 'b', 'c'])
    expect(all[0].message).toContain('zen-3-32b')
    expect(all[1].message).toContain('Inference · embed-8b') // composed when no note
    const errs = logsFromRecords(records, { endpoint: 'all', level: 'error' }, 10)
    expect(errs.map((l) => l.id)).toEqual(['b'])
    const zen = logsFromRecords(records, { endpoint: 'zen-3-32b', level: 'all' }, 10)
    expect(zen.map((l) => l.id)).toEqual(['a', 'c'])
  })

  it('carries the FULL underlying record so the row-detail drawer needs no second lookup', () => {
    const [first] = logsFromRecords(records, { endpoint: 'all', level: 'all' }, 10)
    expect(first.record.id).toBe('a')
    expect(first.record.model).toBe('zen-3-32b')
    expect(first.record.status).toBe('success')
  })

  it('distinctModels / distinctLevels are real options only; empty ledger → []', () => {
    expect(distinctModels(records)).toEqual(['embed-8b', 'zen-3-32b'])
    expect(distinctLevels(records)).toEqual(['error', 'success'])
    expect(logsFromRecords([], { endpoint: 'all', level: 'all' }, 10)).toEqual([])
  })
})

describe('logDetailFacts', () => {
  const fmt = {
    usd: (c: number) => (c === 0 ? '$0' : `$${(c / 100).toFixed(2)}`),
    count: (n: number) => n.toLocaleString(),
    time: (ms: number | null) => (ms == null ? '—' : `t=${ms}`),
  }

  it('projects EVERY real recorded field, formatting injected, honest em-dash for absent', () => {
    const r = rec({ id: 'tx1', model: 'zen-3-32b', provider: 'hanzo', status: 'success', cents: 250, promptTokens: 80, completionTokens: 20, totalTokens: 100, stream: true, premium: true, at: 1000, requestId: 'req-9' })
    const facts = logDetailFacts(r, fmt)
    const by = Object.fromEntries(facts.map((f) => [f.label, f.value]))
    expect(by.Endpoint).toBe('zen-3-32b')
    expect(by.Provider).toBe('hanzo')
    expect(by.Status).toBe('success')
    expect(by.Cost).toBe('$2.50')
    expect(by['Total tokens']).toBe('100')
    expect(by['Prompt tokens']).toBe('80')
    expect(by['Completion tokens']).toBe('20')
    expect(by.Streamed).toBe('Yes')
    expect(by.Tier).toBe('Premium')
    expect(by['Request ID']).toBe('req-9')
    expect(by['Transaction ID']).toBe('tx1')
    expect(by.Time).toBe('t=1000')
  })

  it('shows honest "—" / defaults for missing data and OMITS untagged product/agent', () => {
    // `at: null` is set explicitly (the `rec` helper's `?? NOW` can't express null).
    const r: UsageRecord = { ...rec({ id: 'tx2', model: '', provider: '', status: '', cents: 0, totalTokens: 0 }), at: null }
    const by = Object.fromEntries(logDetailFacts(r, fmt).map((f) => [f.label, f.value]))
    expect(by.Endpoint).toBe('—')
    expect(by.Provider).toBe('—')
    expect(by.Status).toBe('unknown')
    expect(by['Total tokens']).toBe('—')
    expect(by.Streamed).toBe('No')
    expect(by.Tier).toBe('Standard')
    expect(by.Time).toBe('—')
    // product/agent/requestId are only present when the ledger tagged them
    expect('Product' in by).toBe(false)
    expect('Agent' in by).toBe(false)
    expect('Request ID' in by).toBe(false)
  })

  it('surfaces product + agent attribution only when the ledger tagged the row', () => {
    const r = rec({ id: 'tx3', product: 'agents', agent: 'maxpower-support' })
    const by = Object.fromEntries(logDetailFacts(r, fmt).map((f) => [f.label, f.value]))
    expect(by.Product).toBe('agents')
    expect(by.Agent).toBe('maxpower-support')
  })
})

describe('statusSummary', () => {
  it('tallies real phases + kinds', () => {
    const list = [
      fromCatalogModel({ id: 'zen', object: 'model', created: 0, owned_by: 'h', pricing: null }),
      fromMlEndpoint({ name: 'r', status: { conditions: [{ type: 'Ready', status: 'True' }] } }),
      fromMlEndpoint({ name: 'p', status: {} }),
      fromMlEndpoint({ name: 'f', status: { conditions: [{ type: 'Ready', status: 'False', reason: 'Failed' }] } }),
    ]
    expect(statusSummary(list)).toEqual({ total: 4, ready: 2, provisioning: 1, failed: 1, managed: 1, deployed: 3 })
  })
})

describe('formatters', () => {
  it('are honest with non-finite input', () => {
    expect(fmtCount(32400)).toBe('32.4K')
    expect(fmtCount(null)).toBe('—')
    expect(fmtUsd(128642)).toBe('$1.3K')
    expect(fmtUsd(1286)).toBe('$12.86')
    expect(fmtUsd(null)).toBe('—')
    expect(fmtDelta(12)).toBe('+12%')
    expect(fmtDelta(-3)).toBe('−3%')
    expect(fmtDelta(0)).toBe('0%')
    expect(fmtDelta(null)).toBe('—')
  })
})
