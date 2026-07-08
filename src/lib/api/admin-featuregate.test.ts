import { describe, it, expect } from 'vitest'

import { normalizeService, servicesFrom } from './admin-featuregate'

/**
 * Feature-gate admin client normalizers — OPTIONAL-SAFE parsing of cloud
 * `clients/featuregate` responses. The board must render honest values whatever
 * shape the backend sends, never a fabricated row.
 */
describe('normalizeService', () => {
  it('reads a full service row', () => {
    const s = normalizeService({
      service: 'chat',
      displayName: 'Chat',
      hosts: ['hanzo.chat', 'chat.hanzo.ai'],
      waitlistMode: true,
      description: 'AI chat',
      updatedAt: 1700,
      updatedBy: 'z@hanzo.ai',
    })
    expect(s).toEqual({
      service: 'chat',
      displayName: 'Chat',
      hosts: ['hanzo.chat', 'chat.hanzo.ai'],
      waitlistMode: true,
      description: 'AI chat',
      updatedAt: 1700,
      updatedBy: 'z@hanzo.ai',
    })
  })

  it('falls back displayName → service and coerces types', () => {
    const s = normalizeService({ service: 'api', waitlistMode: 'true', updatedAt: '42' })
    expect(s.displayName).toBe('api')
    expect(s.waitlistMode).toBe(true)
    expect(s.updatedAt).toBe(42)
    expect(s.hosts).toEqual([])
  })

  it('treats a missing/false mode as open and junk hosts as empty', () => {
    expect(normalizeService({ service: 'x' }).waitlistMode).toBe(false)
    expect(normalizeService({ service: 'x', hosts: 'nope' }).hosts).toEqual([])
    expect(normalizeService({ service: 'x', hosts: ['a', 2, null, 'b'] }).hosts).toEqual(['a', 'b'])
  })
})

describe('servicesFrom', () => {
  it('reads the { services: [...] } envelope', () => {
    const out = servicesFrom({ services: [{ service: 'chat', waitlistMode: true }, { service: 'api', waitlistMode: false }] })
    expect(out.map((s) => s.service)).toEqual(['chat', 'api'])
    expect(out.map((s) => s.waitlistMode)).toEqual([true, false])
  })

  it('tolerates a bare array and drops rows with no slug', () => {
    const out = servicesFrom([{ service: 'chat' }, { service: '' }, { waitlistMode: true }])
    expect(out.map((s) => s.service)).toEqual(['chat'])
  })

  it('is honest-empty on junk', () => {
    expect(servicesFrom(null)).toEqual([])
    expect(servicesFrom({})).toEqual([])
    expect(servicesFrom('nope')).toEqual([])
  })
})
