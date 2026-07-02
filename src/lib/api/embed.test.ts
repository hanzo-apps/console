import { describe, it, expect } from 'vitest'

import { normalizeEmbedStatus } from './embed'

/**
 * The embed status client normalizer. It must degrade a drifted/partial payload to
 * "not entitled / not reachable" (never throw, never claim an app is live or that a
 * caller may frame it when the shape is off — fail closed, no cross-tenant frame).
 */
describe('normalizeEmbedStatus', () => {
  it('normalizes an entitled + reachable payload', () => {
    expect(
      normalizeEmbedStatus('cms', {
        app: 'cms',
        origin: 'https://cms.hanzo.ai',
        embedUrl: 'https://cms.hanzo.ai/admin',
        reachable: true,
        entitled: true,
        phase: 'ready',
      }),
    ).toEqual({
      app: 'cms',
      origin: 'https://cms.hanzo.ai',
      embedUrl: 'https://cms.hanzo.ai/admin',
      reachable: true,
      entitled: true,
      phase: 'ready',
    })
  })

  it('normalizes a NOT-entitled payload: entitled false, empty embedUrl kept', () => {
    const s = normalizeEmbedStatus('cms', {
      origin: 'https://cms.hanzo.ai',
      embedUrl: '',
      reachable: false,
      entitled: false,
      phase: 'not-entitled',
    })
    expect(s.entitled).toBe(false)
    expect(s.embedUrl).toBe('') // an explicit '' is kept — never falls back to origin
    expect(s.reachable).toBe(false)
    expect(s.phase).toBe('not-entitled')
  })

  it('treats a not-provisioned payload as not reachable (entitled but down)', () => {
    const s = normalizeEmbedStatus('erp', {
      origin: 'https://erp.hanzo.ai',
      embedUrl: 'https://erp.hanzo.ai/app',
      reachable: false,
      entitled: true,
      phase: 'not-provisioned',
    })
    expect(s.reachable).toBe(false)
    expect(s.entitled).toBe(true)
    expect(s.phase).toBe('not-provisioned')
  })

  it('falls back embedUrl to origin only when the field is MISSING, and defaults the phase', () => {
    const s = normalizeEmbedStatus('help', { origin: 'https://help.hanzo.ai', reachable: true, entitled: true })
    expect(s.embedUrl).toBe('https://help.hanzo.ai')
    expect(s.phase).toBe('ready')
  })

  it('fails closed: garbage/empty/partial payloads are NOT entitled and NOT reachable', () => {
    for (const raw of [null, undefined, 42, 'nope', {}, { reachable: 'true' }, { reachable: 1 }, { entitled: 'true' }]) {
      const s = normalizeEmbedStatus('cms', raw)
      expect(s.reachable).toBe(false)
      expect(s.entitled).toBe(false) // a stale server (no `entitled`) → provision panel, never a frame
      expect(s.app).toBe('cms')
    }
  })

  it('a reachable-but-not-entitled payload still yields NO entitlement (no frame)', () => {
    const s = normalizeEmbedStatus('cms', { reachable: true, origin: 'https://cms.hanzo.ai' })
    expect(s.entitled).toBe(false)
  })
})
