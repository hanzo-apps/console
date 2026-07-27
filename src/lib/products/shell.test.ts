import { afterEach, describe, expect, it } from 'vitest'
import { PRODUCT_SHELLS, shellFor, isProductShell } from './shell'
import {
  shellFromHost,
  isMarketingHost,
  isAdsHost,
  isSocialHost,
  isSentryHost,
  isDnsHost,
  brandFromHost,
  type ShellId,
} from '~/config'

// Proves the UNIFIED product-shell contract across ALL five faces (billing,
// marketing, ads, social, sentry): the descriptor is complete + honest, the ONE host
// resolver selects the right face, and — CRITICAL white-label invariant — the shell
// is ORTHOGONAL to the brand (a face never crosses a brand). Pure (host passed in /
// env restored), so no window mocking.

const ALL: ShellId[] = ['console', 'billing', 'marketing', 'ads', 'social', 'sentry', 'dns', 'tracker']
/** The single-product FACES (everything but the full console). */
const FACES: ShellId[] = ['billing', 'marketing', 'ads', 'social', 'sentry', 'dns', 'tracker']

afterEach(() => {
  delete process.env.NEXT_PUBLIC_PRODUCT_SHELL
  delete process.env.NEXT_PUBLIC_BILLING_ONLY
  delete process.env.NEXT_PUBLIC_MARKETING_ONLY
  delete process.env.NEXT_PUBLIC_ADS_ONLY
  delete process.env.NEXT_PUBLIC_SOCIAL_ONLY
})

describe('product-shell descriptor', () => {
  it('declares every shell id, keyed to itself (no face missing)', () => {
    for (const id of ALL) {
      expect(PRODUCT_SHELLS[id].id).toBe(id)
      expect(shellFor(id)).toBe(PRODUCT_SHELLS[id])
    }
    expect(Object.keys(PRODUCT_SHELLS).sort()).toEqual([...ALL].sort())
  })

  it('console is the full catalog (no root, no home, no wordmark, not a product shell)', () => {
    const c = shellFor('console')
    expect(c.rootId).toBeNull()
    expect(c.home).toBe('')
    expect(c.wordmark).toBe('')
    expect(isProductShell('console')).toBe(false)
  })

  it('EVERY face is a single-product shell — rootId === id === home, isProductShell true', () => {
    for (const id of FACES) {
      const s = shellFor(id)
      expect(s.rootId).toBe(id)
      expect(s.home).toBe(id)
      expect(isProductShell(id)).toBe(true)
    }
  })

  it('wordmarks: billing keeps mark-only; the newer faces wear their product wordmark', () => {
    expect(shellFor('billing').wordmark).toBe('') // legacy look, unchanged
    expect(shellFor('marketing').wordmark).toBe('Marketing')
    expect(shellFor('ads').wordmark).toBe('Ads')
    expect(shellFor('social').wordmark).toBe('Publish') // Social → Publish (display rename)
    expect(shellFor('sentry').wordmark).toBe('Sentry')
    expect(shellFor('dns').wordmark).toBe('DNS')
  })

  it('sentry boots into Issues, dns into Zones; every other face indexes on Overview', () => {
    expect(shellFor('sentry').indexLabel).toBe('Issues')
    expect(shellFor('dns').indexLabel).toBe('Zones')
    for (const id of ['billing', 'marketing', 'ads', 'social'] as ShellId[]) {
      expect(shellFor(id).indexLabel).toBe('Overview')
    }
  })
})

describe('shellFromHost — ONE resolver, five faces', () => {
  it('each dedicated host wears its face', () => {
    expect(shellFromHost('billing.hanzo.ai')).toBe('billing')
    expect(shellFromHost('marketing.hanzo.ai')).toBe('marketing')
    expect(shellFromHost('ads.hanzo.ai')).toBe('ads')
    expect(shellFromHost('social.hanzo.ai')).toBe('social')
    expect(shellFromHost('sentry.hanzo.ai')).toBe('sentry')
    expect(shellFromHost('dns.hanzo.ai')).toBe('dns')
    // works on any brand host, not just hanzo
    expect(shellFromHost('marketing.lux.cloud')).toBe('marketing')
    expect(shellFromHost('social.zoo.ngo')).toBe('social')
    expect(shellFromHost('dns.lux.cloud')).toBe('dns')
  })

  it('the host predicates agree with the resolver', () => {
    expect(isMarketingHost('marketing.hanzo.ai')).toBe(true)
    expect(isAdsHost('ads.hanzo.ai')).toBe(true)
    expect(isSocialHost('social.hanzo.ai')).toBe(true)
    expect(isSentryHost('sentry.hanzo.ai')).toBe(true)
    expect(isDnsHost('dns.hanzo.ai')).toBe(true)
    // a look-alike (mymarketing.) is NOT a face host
    expect(isMarketingHost('mymarketing.hanzo.ai')).toBe(false)
    expect(shellFromHost('mymarketing.hanzo.ai')).toBe('console')
  })

  it('every non-face host is the full console', () => {
    for (const h of ['cloud.hanzo.ai', 'console.hanzo.ai', 'admin.hanzo.ai', '']) {
      expect(shellFromHost(h)).toBe('console')
    }
    expect(shellFromHost(undefined)).toBe('console')
  })

  it('NEXT_PUBLIC_PRODUCT_SHELL overrides the host (dev/preview), for any face', () => {
    for (const id of FACES) {
      process.env.NEXT_PUBLIC_PRODUCT_SHELL = id
      expect(shellFromHost('cloud.hanzo.ai')).toBe(id)
    }
    process.env.NEXT_PUBLIC_PRODUCT_SHELL = 'console'
    expect(shellFromHost('sentry.hanzo.ai')).toBe('console')
  })

  it('the legacy NEXT_PUBLIC_{BILLING,MARKETING,ADS,SOCIAL}_ONLY=1 still select their face', () => {
    process.env.NEXT_PUBLIC_BILLING_ONLY = '1'
    expect(shellFromHost('cloud.hanzo.ai')).toBe('billing')
    delete process.env.NEXT_PUBLIC_BILLING_ONLY
    process.env.NEXT_PUBLIC_MARKETING_ONLY = '1'
    expect(shellFromHost('cloud.hanzo.ai')).toBe('marketing')
    delete process.env.NEXT_PUBLIC_MARKETING_ONLY
    process.env.NEXT_PUBLIC_ADS_ONLY = '1'
    expect(shellFromHost('cloud.hanzo.ai')).toBe('ads')
    delete process.env.NEXT_PUBLIC_ADS_ONLY
    process.env.NEXT_PUBLIC_SOCIAL_ONLY = '1'
    expect(shellFromHost('cloud.hanzo.ai')).toBe('social')
  })

  it('WHITE-LABEL: the shell is orthogonal to the brand — every face keeps the host brand', () => {
    // marketing.lux.cloud is the lux brand wearing the Marketing face, etc. A face
    // never crosses a brand.
    expect(brandFromHost('sentry.hanzo.ai')).toBe('hanzo')
    expect(brandFromHost('sentry.lux.cloud')).toBe('lux')
    expect(brandFromHost('marketing.zoo.ngo')).toBe('zoo')
    expect(brandFromHost('ads.lux.cloud')).toBe('lux')
    expect(brandFromHost('social.pars.cloud')).toBe('pars')
    expect(brandFromHost('dns.zoo.ngo')).toBe('zoo')
  })
})
