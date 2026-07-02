import { describe, it, expect } from 'vitest'

import { brandDomain, serviceOrigin, studioOrigin, erpOrigin, helpOrigin, EMBED_FALLBACK_DOMAIN } from './embed-hosts'

/**
 * White-label host derivation for the embedded apps. These pin that a Lux/Zoo
 * console frames ITS OWN brand's Studio/ERP/Help (never Hanzo's), that dev/bare
 * hosts fall back safely, and that the service label is prefixed onto the brand's
 * registrable domain (not the full console host).
 */
describe('brandDomain', () => {
  it('drops the leading service label to the registrable domain', () => {
    expect(brandDomain('console.hanzo.ai')).toBe('hanzo.ai')
    expect(brandDomain('cloud.hanzo.ai')).toBe('hanzo.ai')
    expect(brandDomain('admin.hanzo.ai')).toBe('hanzo.ai')
    expect(brandDomain('cloud.lux.cloud')).toBe('lux.cloud')
    expect(brandDomain('admin.zoo.cloud')).toBe('zoo.cloud')
  })

  it('returns an apex host unchanged', () => {
    expect(brandDomain('hanzo.ai')).toBe('hanzo.ai')
    expect(brandDomain('lux.cloud')).toBe('lux.cloud')
  })

  it('strips a port', () => {
    expect(brandDomain('console.hanzo.ai:443')).toBe('hanzo.ai')
    expect(brandDomain('localhost:4000')).toBe(EMBED_FALLBACK_DOMAIN)
  })

  it('falls back for dev / single-label / IP / empty hosts', () => {
    expect(brandDomain('localhost')).toBe(EMBED_FALLBACK_DOMAIN)
    expect(brandDomain('127.0.0.1')).toBe(EMBED_FALLBACK_DOMAIN)
    expect(brandDomain('')).toBe(EMBED_FALLBACK_DOMAIN)
    expect(brandDomain(null)).toBe(EMBED_FALLBACK_DOMAIN)
    expect(brandDomain(undefined)).toBe(EMBED_FALLBACK_DOMAIN)
  })

  it('honors a custom fallback', () => {
    expect(brandDomain('localhost', 'lux.cloud')).toBe('lux.cloud')
  })
})

describe('serviceOrigin / per-service helpers', () => {
  it('prefixes the service label onto the brand domain', () => {
    expect(serviceOrigin('cms', 'console.hanzo.ai')).toBe('https://cms.hanzo.ai')
    expect(serviceOrigin('erp', 'cloud.lux.cloud')).toBe('https://erp.lux.cloud')
  })

  it('lower-cases the service label', () => {
    expect(serviceOrigin('CMS', 'console.hanzo.ai')).toBe('https://cms.hanzo.ai')
  })

  it('studio/erp/help resolve per brand (never cross-brand)', () => {
    // Hanzo console → Hanzo services.
    expect(studioOrigin('console.hanzo.ai')).toBe('https://cms.hanzo.ai')
    expect(erpOrigin('console.hanzo.ai')).toBe('https://erp.hanzo.ai')
    expect(helpOrigin('console.hanzo.ai')).toBe('https://help.hanzo.ai')
    // Lux console → Lux services, NOT Hanzo's.
    expect(studioOrigin('cloud.lux.cloud')).toBe('https://cms.lux.cloud')
    expect(erpOrigin('cloud.lux.cloud')).toBe('https://erp.lux.cloud')
    expect(helpOrigin('cloud.lux.cloud')).toBe('https://help.lux.cloud')
  })

  it('dev host resolves to the hanzo brand default', () => {
    expect(studioOrigin('localhost')).toBe('https://cms.hanzo.ai')
    expect(erpOrigin(null)).toBe('https://erp.hanzo.ai')
  })
})
