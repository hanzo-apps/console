import { describe, it, expect } from 'vitest'

import {
  clampedBrandDomain,
  embedOrigin,
  embedTarget,
  isEmbedApp,
  isUp,
  EMBED_APPS,
  brandOrgForHost,
  isEntitled,
  EMBED_OWNERSHIP,
} from './embed-probe'

/**
 * The `/embed-status` probe logic. The SSRF clamp is the security-critical part —
 * a forged Host header must never steer the server probe to an attacker host.
 */
describe('clampedBrandDomain (SSRF clamp)', () => {
  it('keeps a known brand domain', () => {
    expect(clampedBrandDomain('console.hanzo.ai')).toBe('hanzo.ai')
    expect(clampedBrandDomain('cloud.lux.cloud')).toBe('lux.cloud')
    expect(clampedBrandDomain('admin.zoo.cloud')).toBe('zoo.cloud')
    expect(clampedBrandDomain('cloud.pars.cloud')).toBe('pars.cloud')
  })

  it('falls back to the hanzo brand for an UNKNOWN / forged host (no SSRF)', () => {
    expect(clampedBrandDomain('console.evil.com')).toBe('hanzo.ai')
    expect(clampedBrandDomain('attacker.internal')).toBe('hanzo.ai')
    expect(clampedBrandDomain('169.254.169.254')).toBe('hanzo.ai') // cloud metadata IP
    expect(clampedBrandDomain('localhost')).toBe('hanzo.ai')
    expect(clampedBrandDomain('')).toBe('hanzo.ai')
    expect(clampedBrandDomain(null)).toBe('hanzo.ai')
  })
})

describe('embedOrigin / embedTarget', () => {
  it('builds `<app>.<clamped brand domain>` + the landing path', () => {
    expect(embedOrigin('cms', 'console.hanzo.ai')).toBe('https://cms.hanzo.ai')
    expect(embedTarget('cms', 'console.hanzo.ai')).toEqual({
      origin: 'https://cms.hanzo.ai',
      embedUrl: 'https://cms.hanzo.ai/admin',
    })
    expect(embedTarget('erp', 'cloud.lux.cloud')).toEqual({
      origin: 'https://erp.lux.cloud',
      embedUrl: 'https://erp.lux.cloud/app',
    })
    expect(embedTarget('help', 'console.hanzo.ai')).toEqual({
      origin: 'https://help.hanzo.ai',
      embedUrl: 'https://help.hanzo.ai/helpdesk',
    })
  })

  it('an unknown host still resolves to a hanzo-brand target (never the forged host)', () => {
    expect(embedOrigin('cms', 'console.evil.com')).toBe('https://cms.hanzo.ai')
  })
})

describe('isEmbedApp', () => {
  it('admits only the three real apps', () => {
    expect(isEmbedApp('cms')).toBe(true)
    expect(isEmbedApp('erp')).toBe(true)
    expect(isEmbedApp('help')).toBe(true)
    expect(isEmbedApp('iam')).toBe(false)
    expect(isEmbedApp('')).toBe(false)
    expect(isEmbedApp('__proto__')).toBe(false)
    expect(Object.keys(EMBED_APPS).sort()).toEqual(['cms', 'erp', 'help'])
  })
})

describe('isUp (liveness classifier)', () => {
  it('treats app responses (2xx/3xx/401/403) as up', () => {
    for (const s of [200, 201, 204, 301, 302, 303, 307, 401, 403]) expect(isUp(s)).toBe(true)
  })
  it('treats 404 and 5xx as down (the unprovisioned/erroring state)', () => {
    for (const s of [404, 500, 502, 503, 504]) expect(isUp(s)).toBe(false)
  })
  it('treats a zero/invalid status (network error sentinel) as down', () => {
    expect(isUp(0)).toBe(false)
  })
})

describe('brandOrgForHost', () => {
  it('maps a console host to its owning brand org', () => {
    expect(brandOrgForHost('console.hanzo.ai')).toBe('hanzo')
    expect(brandOrgForHost('cloud.lux.cloud')).toBe('lux')
    expect(brandOrgForHost('admin.zoo.cloud')).toBe('zoo')
    expect(brandOrgForHost('cloud.pars.cloud')).toBe('pars')
  })
  it('a forged/unknown host maps to the hanzo brand org (clamped, never attacker-chosen)', () => {
    expect(brandOrgForHost('console.evil.com')).toBe('hanzo')
    expect(brandOrgForHost('localhost')).toBe('hanzo')
    expect(brandOrgForHost(null)).toBe('hanzo')
  })
})

describe('isEntitled (server-side embed gate)', () => {
  it('every app is brand-owned today (no shared app)', () => {
    expect(EMBED_OWNERSHIP).toEqual({ cms: 'brand', erp: 'brand', help: 'brand' })
  })

  it('a brand-org member is entitled to their brand app', () => {
    expect(isEntitled('cms', 'hanzo', 'hanzo', false)).toBe(true)
    expect(isEntitled('erp', 'lux', 'lux', false)).toBe(true)
    expect(isEntitled('help', 'hanzo', 'hanzo', false)).toBe(true)
  })

  it('a CUSTOMER org is NOT entitled (no cross-tenant frame)', () => {
    expect(isEntitled('cms', 'maxpower', 'hanzo', false)).toBe(false)
    expect(isEntitled('erp', 'maxpower', 'hanzo', false)).toBe(false)
    expect(isEntitled('help', 'maxpower', 'hanzo', false)).toBe(false)
  })

  it('a global admin is entitled regardless of their own org', () => {
    expect(isEntitled('cms', 'admin', 'hanzo', true)).toBe(true)
    expect(isEntitled('help', 'maxpower', 'hanzo', true)).toBe(true)
  })

  it('an empty/blank caller org is NEVER entitled (fail closed)', () => {
    expect(isEntitled('cms', '', 'hanzo', false)).toBe(false)
    expect(isEntitled('cms', '', '', false)).toBe(false) // no org both sides → still refused
  })
})
