import { describe, expect, it } from 'vitest'

import { normalizeIssue, normalizeIssues, normalizeIssueDetail } from './apm'

describe('normalizeIssue', () => {
  it('maps the wire fields with sane defaults', () => {
    const i = normalizeIssue({
      id: 'abc',
      fingerprint: 'fp1',
      type: 'TypeError',
      value: 'boom',
      culprit: 'handle in svc.py',
      level: 'warning',
      status: 'resolved',
      count: 42,
      regressed: true,
      firstSeen: '2026-07-10T00:00:00Z',
      lastSeen: '2026-07-10T01:00:00Z',
      serviceName: 'api',
    })
    expect(i.id).toBe('abc')
    expect(i.type).toBe('TypeError')
    expect(i.status).toBe('resolved')
    expect(i.count).toBe(42)
    expect(i.regressed).toBe(true)
    expect(i.serviceName).toBe('api')
  })

  it('defaults level to error and coerces an unknown status to unresolved', () => {
    const i = normalizeIssue({ id: 'x', status: 'bogus' })
    expect(i.level).toBe('error')
    expect(i.status).toBe('unresolved')
    expect(i.count).toBe(0)
    expect(i.regressed).toBe(false)
  })

  it('never throws on garbage input', () => {
    expect(() => normalizeIssue(null)).not.toThrow()
    expect(() => normalizeIssue(undefined)).not.toThrow()
    expect(normalizeIssue('nope').id).toBe('')
  })
})

describe('normalizeIssues', () => {
  it('unwraps the {status,data:{items}} render envelope', () => {
    const body = { status: 'success', data: { items: [{ id: 'a', type: 'E' }, { id: 'b', type: 'F' }], total: 2 } }
    const rows = normalizeIssues(body)
    expect(rows).toHaveLength(2)
    expect(rows[0].id).toBe('a')
    expect(rows[1].type).toBe('F')
  })

  it('accepts a bare {items} body and a bare array', () => {
    expect(normalizeIssues({ items: [{ id: 'a' }] })).toHaveLength(1)
    expect(normalizeIssues([{ id: 'a' }, { id: 'b' }])).toHaveLength(2)
  })

  it('returns [] for empty / malformed bodies', () => {
    expect(normalizeIssues(null)).toEqual([])
    expect(normalizeIssues({ status: 'success', data: {} })).toEqual([])
    expect(normalizeIssues({ data: 'nope' })).toEqual([])
  })
})

describe('normalizeIssueDetail', () => {
  it('unwraps the envelope and parses the issue + latest occurrence frames', () => {
    const body = {
      status: 'success',
      data: {
        issue: { id: 'a', type: 'TypeError', status: 'unresolved' },
        latestEvent: {
          eventId: 'e1',
          value: 'boom',
          frames: [{ function: 'main', module: 'app', inApp: true, lineno: 10 }],
        },
      },
    }
    const d = normalizeIssueDetail(body)
    expect(d.issue?.id).toBe('a')
    expect(d.latestEvent?.value).toBe('boom')
    expect(d.latestEvent?.frames).toHaveLength(1)
    expect(d.latestEvent?.frames[0].inApp).toBe(true)
    expect(d.latestEvent?.frames[0].lineno).toBe(10)
  })

  it('tolerates a missing latestEvent and a bare body', () => {
    const d = normalizeIssueDetail({ data: { issue: { id: 'a' } } })
    expect(d.issue?.id).toBe('a')
    expect(d.latestEvent).toBeNull()

    const bare = normalizeIssueDetail({ issue: { id: 'z' }, latestEvent: null })
    expect(bare.issue?.id).toBe('z')
    expect(bare.latestEvent).toBeNull()
  })
})
