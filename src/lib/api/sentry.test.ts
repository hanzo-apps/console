import { describe, expect, it } from 'vitest'

import {
  normalizeProject,
  normalizeProjects,
  normalizeDsn,
  normalizeIssue,
  normalizeIssues,
  normalizeEvent,
  normalizeEvents,
  normalizeIssueDetail,
  normalizeDiscover,
  normalizeLog,
  normalizeLogs,
  normalizeTrace,
  normalizeTraces,
  normalizeSpan,
  normalizeTraceDetail,
  normalizeStats,
} from './sentry'

describe('projects', () => {
  it('maps a project + dsn, tolerating snake_case', () => {
    const p = normalizeProject({ id: 'web', name: 'Web', platform: 'javascript', dsn: 'https://k@api.hanzo.ai/v1/event/web', last_event: '2026-07-10T00:00:00Z' })
    expect(p.id).toBe('web')
    expect(p.name).toBe('Web')
    expect(p.dsn).toContain('/v1/event/web')
    expect(p.lastEvent).toBe('2026-07-10T00:00:00Z')
    expect(p.status).toBe('active')
  })
  it('unwraps a list and drops idless rows; defaults name/slug from id', () => {
    const list = normalizeProjects({ data: [{ slug: 'api' }, { nope: true }] })
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('api')
    expect(list[0].name).toBe('api')
  })
  it('normalizeDsn reads a bare string or {dsn}', () => {
    expect(normalizeDsn('https://x@h/v1/sentinel/p')).toBe('https://x@h/v1/sentinel/p')
    expect(normalizeDsn({ data: { dsn: 'd1' } })).toBe('d1')
    expect(normalizeDsn(null)).toBe('')
  })
})

describe('issues', () => {
  it('maps the group with a sparkline series + regressed/status', () => {
    const i = normalizeIssue({
      id: 'g1',
      type: 'TypeError',
      value: 'x is undefined',
      culprit: 'render',
      level: 'error',
      status: 'ignored',
      count: 128,
      userCount: 12,
      isRegressed: true,
      firstSeen: 'a',
      lastSeen: 'b',
      stats: [1, 2, 3, 4],
      project: 'web',
    })
    expect(i.id).toBe('g1')
    expect(i.type).toBe('TypeError')
    expect(i.status).toBe('ignored')
    expect(i.count).toBe(128)
    expect(i.userCount).toBe(12)
    expect(i.regressed).toBe(true)
    expect(i.stats).toEqual([1, 2, 3, 4])
    expect(i.project).toBe('web')
  })
  it('flattens a [[ts,count]] sparkline and defaults level/type/status', () => {
    const i = normalizeIssue({ id: 'g', status: 'bogus', stats: [[1000, 5], [2000, 9]] })
    expect(i.level).toBe('error')
    expect(i.type).toBe('Error')
    expect(i.status).toBe('unresolved')
    expect(i.stats).toEqual([5, 9])
  })
  it('unwraps {items}/{data}/bare array and drops idless rows', () => {
    expect(normalizeIssues({ data: { items: [{ id: 'a' }, { id: 'b' }] } })).toHaveLength(2)
    expect(normalizeIssues([{ id: 'a' }, { junk: 1 }])).toHaveLength(1)
    expect(normalizeIssues(null)).toEqual([])
  })
  it('never throws on garbage', () => {
    expect(() => normalizeIssue(null)).not.toThrow()
    expect(normalizeIssue('x').id).toBe('')
  })
})

describe('events / issue detail', () => {
  it('reads frames from exception.values[0].stacktrace.frames + tags map + breadcrumbs.values', () => {
    const ev = normalizeEvent({
      id: 'e1',
      exception: { values: [{ stacktrace: { frames: [{ function: 'main', filename: 'app.ts', lineno: 10, in_app: true, context: [[9, 'a()'], [10, 'boom()']] }] } }] },
      tags: { environment: 'prod', release: '1.2.0' },
      breadcrumbs: { values: [{ category: 'http', message: 'GET /x', level: 'info' }] },
      trace_id: 't1',
      contexts: { os: { name: 'linux' } },
    })
    expect(ev.id).toBe('e1')
    expect(ev.frames).toHaveLength(1)
    expect(ev.frames[0].function).toBe('main')
    expect(ev.frames[0].inApp).toBe(true)
    expect(ev.frames[0].context[1]).toEqual([10, 'boom()'])
    expect(ev.tags.find((t) => t.key === 'release')?.value).toBe('1.2.0')
    expect(ev.breadcrumbs[0].message).toBe('GET /x')
    expect(ev.traceId).toBe('t1')
    expect(ev.contexts.os.name).toBe('linux')
  })
  it('reads flat frames + a tag-array; anonymous frame default', () => {
    const ev = normalizeEvent({ id: 'e', frames: [{ lineno: 3 }], tags: [{ key: 'env', value: 'dev' }] })
    expect(ev.frames[0].function).toBe('<anonymous>')
    expect(ev.tags[0]).toEqual({ key: 'env', value: 'dev' })
  })
  it('normalizeEvents unwraps a list', () => {
    expect(normalizeEvents({ data: [{ id: 'a' }, { id: 'b' }] })).toHaveLength(2)
  })
  it('issue detail: {issue, latestEvent} and a bare issue carrying latestEvent', () => {
    const d = normalizeIssueDetail({ data: { issue: { id: 'g' }, latestEvent: { id: 'e', value: 'boom' } } })
    expect(d.issue?.id).toBe('g')
    expect(d.latestEvent?.message).toBe('boom')
    const bare = normalizeIssueDetail({ id: 'g2', latestEvent: null })
    expect(bare.issue?.id).toBe('g2')
    expect(bare.latestEvent).toBeNull()
  })
})

describe('discover', () => {
  it('projects rows, derives columns from the union of keys, and reads a series', () => {
    const res = normalizeDiscover({
      data: [
        { 'count()': 42, transaction: '/api/a' },
        { 'count()': 7, transaction: '/api/b', 'p95()': 120 },
      ],
      series: [[1000, 5], [2000, 9]],
    })
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0]['count()']).toBe(42)
    expect(res.fields).toEqual(expect.arrayContaining(['count()', 'transaction', 'p95()']))
    expect(res.series).toEqual([{ ts: 1_000_000, value: 5 }, { ts: 2_000_000, value: 9 }])
  })
  it('honors explicit meta.fields ordering and tolerates empty', () => {
    const res = normalizeDiscover({ meta: { fields: ['transaction', 'count()'] }, data: [{ transaction: 'x', 'count()': 1 }] })
    expect(res.fields).toEqual(['transaction', 'count()'])
    expect(normalizeDiscover(null).rows).toEqual([])
  })
})

describe('logs', () => {
  it('maps a log line, lowercases the level, flattens attributes', () => {
    const l = normalizeLog({ id: 'l1', timestamp: 't', severity_text: 'ERROR', body: 'boom', logger: 'svc', attributes: { region: 'sfo3' } }, 0)
    expect(l.id).toBe('l1')
    expect(l.level).toBe('error')
    expect(l.message).toBe('boom')
    expect(l.attributes.region).toBe('sfo3')
  })
  it('synthesizes an id from timestamp+index when absent; defaults level info', () => {
    const l = normalizeLog({ timestamp: 'ts', message: 'x' }, 3)
    expect(l.id).toBe('ts-3')
    expect(l.level).toBe('info')
  })
  it('normalizeLogs unwraps {results}', () => {
    expect(normalizeLogs({ results: [{ message: 'a' }, { message: 'b' }] })).toHaveLength(2)
  })
})

describe('traces', () => {
  it('maps a trace list row and drops idless rows', () => {
    const t = normalizeTrace({ traceId: 'tr1', transaction: 'GET /x', durationMs: 210, spanCount: 12, errorCount: 1, status: 'ok' })
    expect(t.traceId).toBe('tr1')
    expect(t.durationMs).toBe(210)
    expect(t.spanCount).toBe(12)
    expect(normalizeTraces([{ transaction: 'no id' }])).toEqual([])
  })
  it('maps a span + the detail waterfall', () => {
    const s = normalizeSpan({ span_id: 's1', parent_span_id: 's0', op: 'db.query', description: 'SELECT', durationMs: 30 })
    expect(s.spanId).toBe('s1')
    expect(s.parentSpanId).toBe('s0')
    expect(s.op).toBe('db.query')
    const d = normalizeTraceDetail({ traceId: 'tr', transaction: 'GET /x', durationMs: 100, spans: [{ spanId: 'a' }, { spanId: 'b' }] })
    expect(d.traceId).toBe('tr')
    expect(d.spans).toHaveLength(2)
  })
})

describe('stats', () => {
  it('widens [unixSeconds,count] pairs to epoch-ms', () => {
    expect(normalizeStats([[1_700_000_000, 5], [1_700_000_060, 9]])).toEqual([
      { ts: 1_700_000_000_000, value: 5 },
      { ts: 1_700_000_060_000, value: 9 },
    ])
  })
  it('accepts {data:[[…]]} and object rows; garbage → []', () => {
    expect(normalizeStats({ data: [[1000, 2]] })).toEqual([{ ts: 1_000_000, value: 2 }])
    expect(normalizeStats([{ ts: 1_700_000_000_000, value: 4 }])).toEqual([{ ts: 1_700_000_000_000, value: 4 }])
    expect(normalizeStats(null)).toEqual([])
  })
})
