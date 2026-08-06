import { describe, expect, it } from 'vitest'

import {
  apmWindow,
  normalizeService,
  normalizeServices,
  normalizeEdge,
  normalizeDependencies,
  normalizeTopOperations,
  normalizeHosts,
  normalizePods,
  normalizeNodes,
  normalizeException,
  normalizeExceptions,
  normalizeDashboard,
  normalizeDashboards,
  listQueryPayload,
  serviceFilterExpression,
  pickService,
  serviceHealthOf,
  parseListRows,
  toIso,
  normalizeLogRow,
  normalizeLogs,
  normalizeTraceSpan,
  normalizeSpans,
  type ServiceRow,
} from './apm'

describe('apmWindow', () => {
  it('produces ns strings and ms numbers for the same window', () => {
    const w = apmWindow(3600)
    expect(w.endMs - w.startMs).toBe(3600 * 1000)
    // ns = ms * 1e6
    expect(w.startNs).toBe(String(w.startMs * 1_000_000))
    expect(w.endNs).toBe(String(w.endMs * 1_000_000))
    // ns strings are integer-only (no exponent) so O11y parses them
    expect(w.startNs).toMatch(/^\d+$/)
    expect(w.endNs).toMatch(/^\d+$/)
  })
})

describe('normalizeService', () => {
  it('maps the O11y ServiceItem wire shape', () => {
    const row = normalizeService({
      serviceName: 'cloud-api',
      p99: 125_000_000,
      avgDuration: 40_000_000,
      numCalls: 1200,
      callRate: 3.4,
      numErrors: 12,
      errorRate: 1,
      num4XX: 5,
      fourXXRate: 0.4,
    })
    expect(row.serviceName).toBe('cloud-api')
    expect(row.p99).toBe(125_000_000)
    expect(row.numCalls).toBe(1200)
    expect(row.errorRate).toBe(1)
  })

  it('degrades missing/garbage fields to safe defaults, never throws', () => {
    expect(normalizeService(undefined)).toEqual({
      serviceName: '',
      p99: 0,
      avgDuration: 0,
      numCalls: 0,
      callRate: 0,
      numErrors: 0,
      errorRate: 0,
      num4XX: 0,
      fourXXRate: 0,
    })
    expect(normalizeService({ serviceName: 'x', p99: 'NaN', numCalls: null }).p99).toBe(0)
  })
})

describe('normalizeServices', () => {
  it('reads a bare array and drops nameless rows', () => {
    const out = normalizeServices([{ serviceName: 'a', numCalls: 1 }, { serviceName: '' }, { numCalls: 2 }])
    expect(out).toHaveLength(1)
    expect(out[0].serviceName).toBe('a')
  })
  it('reads a {data:[…]} envelope', () => {
    const out = normalizeServices({ data: [{ serviceName: 'b' }] })
    expect(out.map((s) => s.serviceName)).toEqual(['b'])
  })
  it('garbage → []', () => {
    expect(normalizeServices(null)).toEqual([])
    expect(normalizeServices('nope')).toEqual([])
  })
})

describe('normalizeEdge / normalizeDependencies', () => {
  it('maps a dependency edge', () => {
    const e = normalizeEdge({ parent: 'gateway', child: 'cloud-api', callCount: 900, callRate: 2.1, errorRate: 0.5, p99: 1e8, p95: 8e7, p50: 3e7 })
    expect(e.parent).toBe('gateway')
    expect(e.child).toBe('cloud-api')
    expect(e.callCount).toBe(900)
    expect(e.p50).toBe(3e7)
  })
  it('drops edges missing an endpoint', () => {
    const out = normalizeDependencies([{ parent: 'a', child: 'b' }, { parent: 'a' }, { child: 'b' }])
    expect(out).toHaveLength(1)
  })
})

describe('normalizeTopOperations', () => {
  it('reads name/operation and drops nameless', () => {
    const out = normalizeTopOperations([{ name: 'GET /v1/x', numCalls: 5 }, { operation: 'POST /v1/y', numCalls: 3 }, { numCalls: 1 }])
    expect(out.map((o) => o.name)).toEqual(['GET /v1/x', 'POST /v1/y'])
  })
})

describe('normalizeHosts', () => {
  it('maps host records + derives name/os from meta when absent', () => {
    const out = normalizeHosts({
      type: 'list',
      total: 2,
      records: [
        { hostName: 'node-1', active: true, os: 'linux', cpu: 0.42, memory: 0.6, wait: 0.01, load15: 1.2 },
        { active: false, cpu: 0.1, memory: 0.2, meta: { 'host.name': 'node-2', 'os.type': 'linux' } },
      ],
    })
    expect(out.total).toBe(2)
    expect(out.hasData).toBe(true)
    expect(out.records[0].hostName).toBe('node-1')
    expect(out.records[0].active).toBe(true)
    expect(out.records[1].hostName).toBe('node-2')
    expect(out.records[1].os).toBe('linux')
  })
  it('empty records → hasData false, total 0', () => {
    const out = normalizeHosts({ type: 'list', records: [], total: 0 })
    expect(out.hasData).toBe(false)
    expect(out.total).toBe(0)
  })
  it('reads a nested {data:{records}} envelope', () => {
    const out = normalizeHosts({ data: { records: [{ hostName: 'h' }], total: 1 } })
    expect(out.records[0].hostName).toBe('h')
  })
})

describe('normalizePods', () => {
  it('maps pod records, phase counts, and namespace/name from meta', () => {
    const out = normalizePods({
      records: [
        {
          podCPU: 0.25,
          podCPURequest: 0.5,
          podMemory: 1e8,
          restartCount: 3,
          countByPhase: { pending: 1, running: 4, succeeded: 0, failed: 0, unknown: 0 },
          meta: { 'k8s.pod.name': 'cloud-api-abc', 'k8s.namespace.name': 'hanzo' },
        },
      ],
      total: 1,
    })
    const p = out.records[0]
    expect(p.podName).toBe('cloud-api-abc')
    expect(p.namespace).toBe('hanzo')
    expect(p.restarts).toBe(3)
    expect(p.phase.running).toBe(4)
  })
})

describe('normalizeNodes', () => {
  it('maps node usage/allocatable and condition counts', () => {
    const out = normalizeNodes({
      records: [
        {
          nodeCPUUsage: 1.5,
          nodeCPUAllocatable: 4,
          nodeMemoryUsage: 2e9,
          nodeMemoryAllocatable: 8e9,
          countByCondition: { ready: 1, notReady: 0, unknown: 0 },
          meta: { 'k8s.node.name': 'pool-1-xyz' },
        },
      ],
      total: 1,
    })
    const n = out.records[0]
    expect(n.nodeName).toBe('pool-1-xyz')
    expect(n.cpuUsage).toBe(1.5)
    expect(n.condition.ready).toBe(1)
  })
})

describe('normalizeException / normalizeExceptions', () => {
  it('maps a grouped error (the O11y Error struct)', () => {
    const e = normalizeException({
      exceptionType: 'RuntimeError',
      exceptionMessage: 'nil pointer',
      exceptionCount: 42,
      serviceName: 'cloud-api',
      groupID: 'g123',
      lastSeen: '2026-07-01T10:00:00Z',
      firstSeen: '2026-06-30T09:00:00Z',
    })
    expect(e.exceptionType).toBe('RuntimeError')
    expect(e.exceptionCount).toBe(42)
    expect(e.groupID).toBe('g123')
  })
  it('drops fully-empty rows but keeps message-only rows', () => {
    const out = normalizeExceptions([
      { exceptionType: 'E', exceptionCount: 1 },
      { exceptionMessage: 'just a message' },
      {},
    ])
    expect(out).toHaveLength(2)
  })
})

describe('normalizeDashboard / normalizeDashboards', () => {
  it('reads O11y nested data.{title,description,tags,widgets}', () => {
    const d = normalizeDashboard({
      uuid: 'u1',
      created_at: '2026-01-01T00:00:00Z',
      created_by: 'z@hanzo.ai',
      data: { title: 'API health', description: 'RED', tags: ['prod', 'api'], widgets: [{}, {}, {}] },
    })
    expect(d.uuid).toBe('u1')
    expect(d.title).toBe('API health')
    expect(d.tags).toEqual(['prod', 'api'])
    expect(d.widgetCount).toBe(3)
    expect(d.createdBy).toBe('z@hanzo.ai')
  })
  it('falls back to top-level title and defaults an untitled dashboard', () => {
    expect(normalizeDashboard({ uuid: 'u2', title: 'Top level' }).title).toBe('Top level')
    expect(normalizeDashboard({ uuid: 'u3' }).title).toBe('Untitled dashboard')
  })
  it('reads a {status,data:[…]} list and drops uuid-less rows', () => {
    const out = normalizeDashboards({ status: 'success', data: [{ uuid: 'a', data: { title: 'A' } }, { data: { title: 'no uuid' } }] })
    expect(out.map((d) => d.uuid)).toEqual(['a'])
  })
})

describe('listQueryPayload (the v5 query_range RAW-LIST envelope)', () => {
  const w = apmWindow(3600)

  type V5 = {
    schemaVersion: string
    start: number
    end: number
    requestType: string
    compositeQuery: { queries: { type: string; spec: Record<string, unknown> }[] }
  }
  const specOf = (p: unknown) => (p as V5).compositeQuery.queries[0].spec

  it('builds the v5 envelope with ms bounds and a raw request type', () => {
    const p = listQueryPayload('logs', w, 100) as V5
    expect(p.start).toBe(w.startMs)
    expect(p.end).toBe(w.endMs)
    // `raw` is the v5 requestType for a row list. `list` is a v3 panelType and is rejected.
    expect(p.requestType).toBe('raw')
    // Free-form and optional upstream, but it is "v1" — NOT "v5".
    expect(p.schemaVersion).toBe('v1')
    expect(p.compositeQuery.queries).toHaveLength(1)
    expect(p.compositeQuery.queries[0].type).toBe('builder_query')
  })

  // THE REGRESSION THIS SUITE EXISTS FOR. v5's compositeQuery has exactly one field,
  // `queries`, and its decoder is a strict unknown-field check: the v3 spelling made the
  // deployed runtime 400 with `unknown field "queryType" in composite query`, which is why
  // every Logs surface rendered empty. None of these keys may ever come back.
  it('never sends the v3 shape the runtime rejects', () => {
    const cq = (listQueryPayload('logs', w, 100) as V5).compositeQuery as Record<string, unknown>
    expect(Object.keys(cq)).toEqual(['queries'])
    for (const dead of ['queryType', 'panelType', 'builderQueries']) expect(cq[dead]).toBeUndefined()
  })

  it('names the signal on the spec (plural — singular "log" is rejected)', () => {
    expect(specOf(listQueryPayload('logs', w, 50)).signal).toBe('logs')
    expect(specOf(listQueryPayload('traces', w, 50)).signal).toBe('traces')
  })

  it('orders newest-first and omits aggregations for a raw list', () => {
    const spec = specOf(listQueryPayload('logs', w, 100))
    expect(spec.order).toEqual([{ key: { name: 'timestamp' }, direction: 'desc' }])
    expect(spec.aggregations).toBeUndefined()
  })

  it('clamps the limit into [1,1000] and floors it', () => {
    expect(specOf(listQueryPayload('logs', w, 99999)).limit).toBe(1000)
    expect(specOf(listQueryPayload('logs', w, 0)).limit).toBe(1)
    expect(specOf(listQueryPayload('logs', w, 12.9)).limit).toBe(12)
  })

  it('omits the filter entirely for a whole-org stream', () => {
    expect(specOf(listQueryPayload('logs', w, 100)).filter).toBeUndefined()
  })

  it('carries a single filter expression when scoped to one product', () => {
    const spec = specOf(listQueryPayload('logs', w, 100, serviceFilterExpression('iam')))
    expect(spec.filter).toEqual({ expression: "service.name = 'iam'" })
  })
})

describe('serviceFilterExpression (scope a logs/traces query to one OTel service.name)', () => {
  it('builds the SQL-ish equality v5 expects', () => {
    expect(serviceFilterExpression('vector')).toBe("service.name = 'vector'")
    expect(serviceFilterExpression('bot-gateway')).toBe("service.name = 'bot-gateway'")
  })
  it('escapes a quote so a value can never end the expression and rewrite the query', () => {
    expect(serviceFilterExpression("i'am")).toBe("service.name = 'i''am'")
  })
})

describe('pickService (RED-metrics row for a product, by candidate names)', () => {
  const rows: ServiceRow[] = [
    { serviceName: 'iam', p99: 1, avgDuration: 1, numCalls: 5, callRate: 1, numErrors: 0, errorRate: 0, num4XX: 0, fourXXRate: 0 },
    { serviceName: 'cloud', p99: 1, avgDuration: 1, numCalls: 9, callRate: 2, numErrors: 0, errorRate: 0, num4XX: 0, fourXXRate: 0 },
  ]
  it('exact-matches the first candidate that exists', () => {
    expect(pickService(rows, ['iam'])?.serviceName).toBe('iam')
    // tries candidates in order — a missing first, then a hit.
    expect(pickService(rows, ['ai', 'cloud'])?.serviceName).toBe('cloud')
  })
  it('returns null on no match (→ honest empty, never another service)', () => {
    expect(pickService(rows, ['nope'])).toBeNull()
    expect(pickService(rows, [null, undefined, ''])).toBeNull()
    expect(pickService([], ['iam'])).toBeNull()
  })
})

describe('serviceHealthOf (RED verdict for one service)', () => {
  const row = (over: Partial<ServiceRow>): ServiceRow => ({
    serviceName: 'iam', p99: 125_000_000, avgDuration: 40_000_000, numCalls: 1200, callRate: 3.4, numErrors: 12, errorRate: 1, num4XX: 5, fourXXRate: 0.4, ...over,
  })
  it('converts ns latency → ms and reads the (already-percent) error rate', () => {
    const h = serviceHealthOf(row({}))!
    expect(h.service).toBe('iam')
    expect(h.p99Ms).toBe(125) // 125e6 ns → 125 ms
    expect(h.avgMs).toBe(40)
    expect(h.errorRatePct).toBe(1)
    expect(h.callRate).toBe(3.4)
    expect(h.numCalls).toBe(1200)
  })
  it('rolls a RED verdict: <1% green, ≥1% yellow, ≥5% red', () => {
    expect(serviceHealthOf(row({ errorRate: 0.2 }))!.tone).toBe('green')
    expect(serviceHealthOf(row({ errorRate: 1 }))!.tone).toBe('yellow')
    expect(serviceHealthOf(row({ errorRate: 7 }))!.tone).toBe('red')
  })
  it('is null when the service reported no calls (nothing to fabricate a verdict from)', () => {
    expect(serviceHealthOf(row({ numCalls: 0 }))).toBeNull()
    expect(serviceHealthOf(null)).toBeNull()
    expect(serviceHealthOf(row({ serviceName: '' }))).toBeNull()
  })
})

describe('parseListRows', () => {
  it('reads rows from data.result[].list', () => {
    const body = { data: { result: [{ list: [{ timestamp: '1', data: { body: 'a' } }, { timestamp: '2', data: { body: 'b' } }] }] } }
    expect(parseListRows(body)).toHaveLength(2)
  })
  it('reads rows from the nested data.newResult.data.result[].list mirror', () => {
    const body = { data: { newResult: { data: { result: [{ list: [{ timestamp: '1', data: {} }] }] } } } }
    expect(parseListRows(body)).toHaveLength(1)
  })
  it('returns [] for empty/garbage/missing shapes (never throws)', () => {
    expect(parseListRows(null)).toEqual([])
    expect(parseListRows({})).toEqual([])
    expect(parseListRows({ data: { result: null } })).toEqual([])
    expect(parseListRows({ data: { result: [{ list: null }] } })).toEqual([])
    expect(parseListRows('nope')).toEqual([])
  })
})

describe('toIso', () => {
  const iso = '2026-07-03T00:00:00.000Z'
  const ms = Date.parse(iso)
  it('passes an ISO string through unchanged', () => {
    expect(toIso(iso)).toBe(iso)
  })
  it('treats a plain ms number as ms', () => {
    expect(toIso(ms)).toBe(iso)
  })
  it('collapses nanosecond epochs to ms', () => {
    expect(toIso(String(ms * 1_000_000))).toBe(iso)
    expect(toIso(ms * 1_000_000)).toBe(iso)
  })
  it('promotes a seconds epoch to ms', () => {
    expect(toIso(Math.floor(ms / 1000))).toBe(iso)
  })
  it('returns empty for null/blank/NaN', () => {
    expect(toIso(undefined)).toBe('')
    expect(toIso(null)).toBe('')
    expect(toIso('')).toBe('')
    expect(toIso('not-a-date')).toBe('not-a-date') // non-numeric string is treated as ISO passthrough
  })
})

describe('normalizeLogRow / normalizeLogs', () => {
  it('projects a O11y log row into {id,timestamp,severity,service,body}', () => {
    const isoT = '2026-07-03T00:00:00.000Z'
    const ns = String(Date.parse(isoT) * 1_000_000) // ns epoch as O11y emits
    const row = {
      timestamp: ns,
      data: { id: 'log-1', severity_text: 'ERROR', 'service.name': 'iam', body: 'boom' },
    }
    const l = normalizeLogRow(row, 0)
    expect(l.id).toBe('log-1')
    expect(l.severity).toBe('error') // lowercased
    expect(l.service).toBe('iam')
    expect(l.body).toBe('boom')
    expect(l.timestamp).toBe(isoT)
  })
  it('tolerates column-name variants and synthesizes an id when absent', () => {
    const l = normalizeLogRow({ timestamp: 5, data: { level: 'warn', serviceName: 'cloud', message: 'hi' } }, 3)
    expect(l.severity).toBe('warn')
    expect(l.service).toBe('cloud')
    expect(l.body).toBe('hi')
    expect(l.id).toBe('5-3') // ts-idx fallback
  })
  it('maps a full query_range logs response, newest-first order preserved', () => {
    const body = {
      data: { result: [{ list: [{ timestamp: '2', data: { body: 'newer' } }, { timestamp: '1', data: { body: 'older' } }] }] },
    }
    const rows = normalizeLogs(body)
    expect(rows.map((r) => r.body)).toEqual(['newer', 'older'])
  })
  it('empty result → empty list (honest empty, not a throw)', () => {
    expect(normalizeLogs({ data: { result: [] } })).toEqual([])
  })
})

describe('normalizeTraceSpan / normalizeSpans', () => {
  it('projects a span row into {id,traceId,name,service,durationNano,status}', () => {
    const row = {
      timestamp: 1751500800000,
      data: { spanID: 's1', traceID: 't1', name: 'GET /v1/chat', serviceName: 'gateway', durationNano: 12345, statusCode: '200' },
    }
    const s = normalizeTraceSpan(row, 0)
    expect(s.id).toBe('s1')
    expect(s.traceId).toBe('t1')
    expect(s.name).toBe('GET /v1/chat')
    expect(s.service).toBe('gateway')
    expect(s.durationNano).toBe(12345)
    expect(s.status).toBe('200')
  })
  it('durationNano is null when absent/blank (honest —, not 0)', () => {
    expect(normalizeTraceSpan({ data: { spanID: 's' } }, 0).durationNano).toBeNull()
    expect(normalizeTraceSpan({ data: { spanID: 's', durationNano: '' } }, 0).durationNano).toBeNull()
  })
  it('maps a full query_range traces response', () => {
    const body = { data: { result: [{ list: [{ timestamp: '1', data: { traceID: 't', name: 'op' } }] }] } }
    expect(normalizeSpans(body)).toHaveLength(1)
  })
})
