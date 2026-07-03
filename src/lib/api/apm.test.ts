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
  normalizeLog,
  normalizeLogs,
  logsQueryRangeBody,
} from './apm'

describe('apmWindow', () => {
  it('produces ns strings and ms numbers for the same window', () => {
    const w = apmWindow(3600)
    expect(w.endMs - w.startMs).toBe(3600 * 1000)
    // ns = ms * 1e6
    expect(w.startNs).toBe(String(w.startMs * 1_000_000))
    expect(w.endNs).toBe(String(w.endMs * 1_000_000))
    // ns strings are integer-only (no exponent) so SigNoz parses them
    expect(w.startNs).toMatch(/^\d+$/)
    expect(w.endNs).toMatch(/^\d+$/)
  })
})

describe('normalizeService', () => {
  it('maps the SigNoz ServiceItem wire shape', () => {
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
  it('maps a grouped error (the SigNoz Error struct)', () => {
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
  it('reads SigNoz nested data.{title,description,tags,widgets}', () => {
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

describe('logsQueryRangeBody', () => {
  it('builds a SigNoz v4 logs LIST query (newest-first, limit, no filter)', () => {
    const b = logsQueryRangeBody({ start: 1000, end: 2000, limit: 50 }) as Record<string, unknown>
    expect(b.start).toBe(1000)
    expect(b.end).toBe(2000)
    const cq = b.compositeQuery as Record<string, unknown>
    expect(cq.queryType).toBe('builder')
    expect(cq.panelType).toBe('list')
    const A = (cq.builderQueries as Record<string, Record<string, unknown>>).A
    expect(A.dataSource).toBe('logs')
    expect(A.aggregateOperator).toBe('noop')
    expect(A.limit).toBe(50)
    expect(A.pageSize).toBe(50)
    expect(A.orderBy).toEqual([{ columnName: 'timestamp', order: 'desc' }])
    expect((A.filters as { items: unknown[] }).items).toEqual([])
  })

  it('adds a body-contains filter when a query is given, and defaults the limit', () => {
    const b = logsQueryRangeBody({ start: 1, end: 2, query: 'timeout' }) as Record<string, unknown>
    const A = ((b.compositeQuery as Record<string, unknown>).builderQueries as Record<string, Record<string, unknown>>).A
    expect(A.limit).toBe(200) // default
    const items = (A.filters as { items: Array<Record<string, unknown>> }).items
    expect(items).toHaveLength(1)
    expect(items[0].op).toBe('contains')
    expect(items[0].value).toBe('timeout')
    expect((items[0].key as { key: string }).key).toBe('body')
  })
})

describe('normalizeLog', () => {
  it('maps a SigNoz v4 list item (data.{body,severity_text,resources_string})', () => {
    const l = normalizeLog({
      timestamp: '2026-07-01T10:00:00Z',
      data: {
        id: 'log-1',
        body: 'connection reset by peer',
        severity_text: 'error',
        resources_string: { 'service.name': 'cloud-api', 'k8s.pod.name': 'cloud-api-abc' },
      },
    })
    expect(l.id).toBe('log-1')
    expect(l.body).toBe('connection reset by peer')
    expect(l.severity).toBe('ERROR') // uppercased
    expect(l.service).toBe('cloud-api')
    expect(l.timestampMs).toBe(Date.parse('2026-07-01T10:00:00Z'))
  })

  it('derives severity from the OTel severity_number when no text, and normalizes ns epochs', () => {
    const l = normalizeLog({ timestamp: 1_767_000_000_000_000_000, data: { body: 'x', severity_number: 17, attributes_string: { 'service.name': 'gateway' } } })
    expect(l.severity).toBe('ERROR') // 17 → ERROR
    expect(l.service).toBe('gateway')
    // ns → ms (÷1e6)
    expect(l.timestampMs).toBe(Math.floor(1_767_000_000_000_000_000 / 1e6))
  })

  it('tolerates a flat row and degrades missing fields, never throws', () => {
    const flat = normalizeLog({ timestamp: 0, body: 'flat message', severity: 'warn', service: 'ai' })
    expect(flat.body).toBe('flat message')
    expect(flat.severity).toBe('WARN')
    expect(flat.service).toBe('ai')
    const empty = normalizeLog(undefined)
    expect(empty).toEqual({ timestampMs: 0, severity: '', body: '', service: '', id: '0' })
  })
})

describe('normalizeLogs', () => {
  it('flattens data.result[].list[] and drops empty rows', () => {
    const out = normalizeLogs({
      status: 'success',
      data: {
        resultType: 'list',
        result: [
          {
            queryName: 'A',
            list: [
              { timestamp: '2026-07-01T10:00:00Z', data: { body: 'a', severity_text: 'info', resources_string: { 'service.name': 's1' } } },
              { timestamp: '2026-07-01T10:01:00Z', data: { body: '', severity_number: 0 } }, // no body, no severity → dropped
              { timestamp: '2026-07-01T10:02:00Z', data: { body: 'c', severity_text: 'debug' } },
            ],
          },
        ],
      },
    })
    expect(out.map((l) => l.body)).toEqual(['a', 'c'])
    expect(out[0].service).toBe('s1')
  })

  it('tolerates a bare array of rows and garbage → []', () => {
    expect(normalizeLogs([{ body: 'x', severity_text: 'info' }]).map((l) => l.body)).toEqual(['x'])
    expect(normalizeLogs(null)).toEqual([])
    expect(normalizeLogs('nope')).toEqual([])
  })
})
