import { describe, expect, it } from 'vitest'

import {
  type ZtSections,
  emptySections,
  rowName,
  rowStatus,
  sectionCount,
  allSectionsDown,
  liveCount,
  deriveTopology,
  topologyIsEmpty,
  POSTURE,
} from './logic'

const sections = (over: Partial<ZtSections>): ZtSections => ({ ...emptySections, ...over })

describe('rowName / rowStatus', () => {
  it('prefers name, falls back through id/host', () => {
    expect(rowName({ name: 'edge-1' }, 'x')).toBe('edge-1')
    expect(rowName({ host: 'h.internal' }, 'x')).toBe('h.internal')
    expect(rowName({}, 'fallback')).toBe('fallback')
  })
  it('reads status/state/health', () => {
    expect(rowStatus({ status: 'online' })).toBe('online')
    expect(rowStatus({ health: 'healthy' })).toBe('healthy')
    expect(rowStatus({})).toBeUndefined()
  })
})

describe('sectionCount — honest null vs count', () => {
  it('null section → null (renders em-dash), loaded → length', () => {
    expect(sectionCount(null)).toBeNull()
    expect(sectionCount([])).toBe(0)
    expect(sectionCount([{}, {}, {}])).toBe(3)
  })
})

describe('allSectionsDown', () => {
  it('true only when every section is null', () => {
    expect(allSectionsDown(emptySections)).toBe(true)
    expect(allSectionsDown(sections({ routers: [] }))).toBe(false)
    expect(allSectionsDown(sections({ services: [{ name: 'a' }] }))).toBe(false)
  })
})

describe('liveCount', () => {
  it('counts active/online/healthy/up/connected', () => {
    expect(liveCount([{ status: 'online' }, { status: 'down' }, { state: 'connected' }])).toBe(2)
    expect(liveCount(null)).toBe(0)
    expect(liveCount([{ status: 'pending' }])).toBe(0)
  })
})

describe('deriveTopology', () => {
  it('maps real rows into router/service columns with status', () => {
    const t = deriveTopology(
      sections({
        routers: [{ name: 'r1', status: 'online' }],
        services: [{ name: 's1', status: 'active' }],
      }),
    )
    expect(t.router.map((n) => n.name)).toEqual(['r1'])
    expect(t.router[0].status).toBe('online')
    expect(t.service[0].kind).toBe('service')
    expect(t.service[0].status).toBe('active')
  })
  it('caps each column at perColumn', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `r${i}` }))
    const t = deriveTopology(sections({ routers: many }), 6)
    expect(t.router).toHaveLength(6)
  })
  it('empty when sections are null', () => {
    const t = deriveTopology(emptySections)
    expect(topologyIsEmpty(t)).toBe(true)
  })
})

describe('POSTURE — the platform transport suite', () => {
  it('states the real PQ primitives', () => {
    expect(POSTURE.kem).toBe('ML-KEM-768')
    expect(POSTURE.sig).toBe('ML-DSA-65')
    expect(POSTURE.transport).toBe('Hanzo zap')
  })
})
