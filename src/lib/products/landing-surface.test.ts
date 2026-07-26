import { describe, it, expect } from 'vitest'
import type { HanzoSurface } from '@hanzogui/shell'

import { landingSurface, SIGN_IN } from './landing-surface'

/** A stand-in for the canonical `cloud.hanzo.ai` surface: its CTAs aim AT the
 *  console, which is a self-link when the console itself renders the header. */
const base: HanzoSurface = {
  id: 'cloud',
  host: 'cloud.hanzo.ai',
  productId: 'cloud',
  brandName: 'Hanzo Cloud',
  localNav: [{ id: 'pricing', label: 'Pricing', href: '/pricing' }],
  secondaryCTA: { id: 'key', label: 'Get API key', href: 'https://console.hanzo.ai/api-keys', external: true },
  primaryCTA: { id: 'console', label: 'Open Console', href: 'https://console.hanzo.ai', external: true },
  preFooter: { heading: 'Ship it', actions: [] },
}

describe('landingSurface', () => {
  it('re-points BOTH header actions at the one sign-in path', () => {
    const s = landingSurface(base)
    expect(s.primaryCTA.href).toBe(SIGN_IN)
    expect(s.secondaryCTA.href).toBe(SIGN_IN)
  })

  it('never leaves a cross-origin self-link (the dead-button class)', () => {
    const s = landingSurface(base)
    for (const cta of [s.primaryCTA, s.secondaryCTA]) {
      expect(cta.href.startsWith('/')).toBe(true)
      expect(cta.href).not.toMatch(/^https?:/)
      expect(cta.external).toBe(false)
    }
  })

  it('labels the primary action for what it does here', () => {
    expect(landingSurface(base).primaryCTA.label).toBe('Sign in')
  })

  it('preserves IDENTITY — brand, nav and taxonomy are untouched', () => {
    const s = landingSurface(base)
    expect(s.id).toBe(base.id)
    expect(s.host).toBe(base.host)
    expect(s.productId).toBe(base.productId)
    expect(s.brandName).toBe(base.brandName)
    expect(s.localNav).toEqual(base.localNav)
    expect(s.preFooter).toEqual(base.preFooter)
  })

  it('is pure — the canonical surface is not mutated', () => {
    const snapshot = JSON.parse(JSON.stringify(base)) as HanzoSurface
    landingSurface(base)
    expect(base).toEqual(snapshot)
  })
})
