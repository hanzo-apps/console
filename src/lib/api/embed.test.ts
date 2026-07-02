import { describe, it, expect } from 'vitest'

import { normalizeEmbedStatus } from './embed'

/**
 * The embed status client normalizer. It must degrade a drifted/partial payload to
 * "not reachable" (never throw, never claim an app is live when the shape is off).
 */
describe('normalizeEmbedStatus', () => {
  it('normalizes a reachable payload', () => {
    expect(
      normalizeEmbedStatus('cms', {
        app: 'cms',
        origin: 'https://cms.hanzo.ai',
        embedUrl: 'https://cms.hanzo.ai/admin',
        reachable: true,
        phase: 'ready',
      }),
    ).toEqual({
      app: 'cms',
      origin: 'https://cms.hanzo.ai',
      embedUrl: 'https://cms.hanzo.ai/admin',
      reachable: true,
      phase: 'ready',
    })
  })

  it('treats a not-provisioned payload as not reachable', () => {
    const s = normalizeEmbedStatus('erp', {
      origin: 'https://erp.hanzo.ai',
      embedUrl: 'https://erp.hanzo.ai/app',
      reachable: false,
      phase: 'not-provisioned',
    })
    expect(s.reachable).toBe(false)
    expect(s.phase).toBe('not-provisioned')
    expect(s.origin).toBe('https://erp.hanzo.ai')
  })

  it('falls back embedUrl to origin when absent, and defaults the phase', () => {
    const s = normalizeEmbedStatus('help', { origin: 'https://help.hanzo.ai', reachable: true })
    expect(s.embedUrl).toBe('https://help.hanzo.ai')
    expect(s.phase).toBe('ready')
  })

  it('never throws and never claims reachable on a garbage/empty payload', () => {
    for (const raw of [null, undefined, 42, 'nope', {}, { reachable: 'true' }, { reachable: 1 }]) {
      const s = normalizeEmbedStatus('cms', raw)
      expect(s.reachable).toBe(false)
      expect(s.phase).toBe('not-provisioned')
      expect(s.app).toBe('cms')
    }
  })
})
