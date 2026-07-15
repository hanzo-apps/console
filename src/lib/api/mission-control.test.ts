import { describe, expect, it } from 'vitest'

import {
  canControl,
  clampIndex,
  deviceRoster,
  eventLine,
  fmtRelative,
  isLive,
  mergeEvents,
  normalizeSessions,
  normalizeTargets,
  statusTone,
  type Session,
  type SessionEvent,
  type Target,
} from './mission-control'

const sess = (p: Partial<Session> & { id: string }): Session => ({
  agent: 'dev',
  status: 'running',
  events: 0,
  children: 0,
  ...p,
})

const target = (p: Partial<Target> & { id: string }): Target => ({
  label: p.id,
  kind: 'gpu',
  status: 'online',
  sessions: 0,
  running: 0,
  registered: true,
  ...p,
})

describe('normalizers (defensive)', () => {
  it('drops id-less session rows and folds unknown status to running', () => {
    const out = normalizeSessions({ sessions: [{ id: 's1', status: 'weird' }, { agent: 'x' }, { id: 's2', status: 'paused' }] })
    expect(out.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(out[0].status).toBe('running')
    expect(out[1].status).toBe('paused')
  })
  it('reads the compact lastEvent when present', () => {
    const [s] = normalizeSessions({ sessions: [{ id: 's1', lastEvent: { seq: 3, kind: 'log', preview: 'hi' } }] })
    expect(s.lastEvent).toEqual({ seq: 3, kind: 'log', actor: undefined, preview: 'hi', at: undefined })
  })
  it('folds an unknown target kind to machine and defaults status online', () => {
    const [t] = normalizeTargets({ targets: [{ id: 't1', label: 'x', kind: 'toaster', status: '' }] })
    expect(t.kind).toBe('machine')
    expect(t.status).toBe('online')
  })
})

describe('status helpers', () => {
  it('isLive / canControl only for running|paused', () => {
    expect(isLive('running')).toBe(true)
    expect(isLive('paused')).toBe(true)
    expect(isLive('done')).toBe(false)
    expect(canControl('error')).toBe(false)
  })
  it('statusTone maps each status', () => {
    expect(statusTone('running')).toBe('live')
    expect(statusTone('paused')).toBe('paused')
    expect(statusTone('done')).toBe('ok')
    expect(statusTone('error')).toBe('error')
  })
})

describe('eventLine', () => {
  it('pulls a human field from an object payload', () => {
    expect(eventLine({ message: 'hello' })).toBe('hello')
    expect(eventLine({ line: 'boot' })).toBe('boot')
    expect(eventLine({ command: 'ls' }, 'tool-call')).toBe('ls')
  })
  it('parses a JSON preview string', () => {
    expect(eventLine('{"text":"hi there"}')).toBe('hi there')
  })
  it('returns a plain string preview as-is', () => {
    expect(eventLine('raw log line')).toBe('raw log line')
  })
  it('falls back to the kind when nothing readable', () => {
    expect(eventLine({ foo: 1 }, 'status')).toBe('status')
    expect(eventLine('', 'log')).toBe('log')
    expect(eventLine(null, 'spawn')).toBe('spawn')
  })
})

describe('mergeEvents', () => {
  it('dedupes by seq and sorts ascending', () => {
    const prev: SessionEvent[] = [
      { id: 'a', sessionId: 's', seq: 1, kind: 'log' },
      { id: 'b', sessionId: 's', seq: 2, kind: 'log' },
    ]
    const incoming: SessionEvent[] = [
      { id: 'b2', sessionId: 's', seq: 2, kind: 'message' }, // dup seq — last wins
      { id: 'c', sessionId: 's', seq: 3, kind: 'log' },
    ]
    const out = mergeEvents(prev, incoming)
    expect(out.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(out[1].kind).toBe('message')
  })
})

describe('clampIndex', () => {
  it('clamps into range', () => {
    expect(clampIndex(-1, 3)).toBe(0)
    expect(clampIndex(5, 3)).toBe(2)
    expect(clampIndex(1, 3)).toBe(1)
    expect(clampIndex(0, 0)).toBe(0)
  })
})

describe('deviceRoster (composition, no double count)', () => {
  const targets = [target({ id: 't1', label: 'Spark', kind: 'gpu', host: 'spark' })]
  const sessions = [
    sess({ id: 's1', target: 't1', status: 'running' }), // dispatched to t1
    sess({ id: 's2', host: 'spark', status: 'paused' }), // on t1's host
    sess({ id: 's3', host: 'evo', status: 'running' }), // ambient host
    sess({ id: 's4', status: 'done' }), // unassigned
  ]

  it('unions registered targets + hosts, maps each session once', () => {
    const roster = deviceRoster(sessions, targets)
    const total = roster.reduce((n, d) => n + d.sessions.length, 0)
    expect(total).toBe(4) // no double count

    const t1 = roster.find((d) => d.id === 't1')!
    expect(t1.registered).toBe(true)
    expect(t1.sessions.map((s) => s.id).sort()).toEqual(['s1', 's2'])
    expect(t1.running).toBe(1) // s1 running, s2 paused

    const evo = roster.find((d) => d.id === 'host:evo')!
    expect(evo.registered).toBe(false)
    expect(evo.running).toBe(1)

    const un = roster.find((d) => d.id === 'unassigned')!
    expect(un.sessions.map((s) => s.id)).toEqual(['s4'])
    expect(un.running).toBe(0)
  })

  it('sorts most-active first', () => {
    const roster = deviceRoster(sessions, targets)
    expect(roster[0].id).toBe('t1') // running 1, total 2
    expect(roster[roster.length - 1].id).toBe('unassigned') // running 0
  })

  it('a hostless target only counts explicit dispatch', () => {
    const roster = deviceRoster(
      [sess({ id: 'x', host: 'spark', status: 'running' })],
      [target({ id: 't2', label: 'Cloud', kind: 'cloud' })], // no host
    )
    const t2 = roster.find((d) => d.id === 't2')!
    expect(t2.sessions).toHaveLength(0) // host match disabled without a target host
    expect(roster.find((d) => d.id === 'host:spark')?.sessions).toHaveLength(1)
  })
})

describe('fmtRelative', () => {
  const now = new Date('2026-07-15T12:00:00Z').getTime()
  it('renders relative buckets, em-dash for missing', () => {
    expect(fmtRelative(undefined, now)).toBe('—')
    expect(fmtRelative('nonsense', now)).toBe('—')
    expect(fmtRelative(new Date(now - 10_000).toISOString(), now)).toBe('just now')
    expect(fmtRelative(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5m ago')
    expect(fmtRelative(new Date(now - 3 * 3600_000).toISOString(), now)).toBe('3h ago')
  })
})
