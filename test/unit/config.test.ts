import { describe, it, expect } from 'vitest'

import { brandFromHost, resolveConfig, branding } from '~/config'

/**
 * ONE console image serves every brand; the brand is resolved at runtime from
 * the request hostname. Misrouting a host to the wrong brand means the wrong IAM
 * issuer / org scope — an auth failure — so the host→brand map is pinned here.
 */
describe('brandFromHost', () => {
  it('defaults to hanzo for empty/unknown hosts', () => {
    expect(brandFromHost('')).toBe('hanzo')
    expect(brandFromHost(null)).toBe('hanzo')
    expect(brandFromHost(undefined)).toBe('hanzo')
    expect(brandFromHost('random.example.com')).toBe('hanzo')
  })

  it('maps hanzo hosts', () => {
    expect(brandFromHost('console.hanzo.ai')).toBe('hanzo')
    expect(brandFromHost('hanzo.ai')).toBe('hanzo')
    expect(brandFromHost('hanzo.id')).toBe('hanzo')
  })

  it('maps lux hosts (cloud, network, id)', () => {
    expect(brandFromHost('console.lux.cloud')).toBe('lux')
    expect(brandFromHost('lux.network')).toBe('lux')
    expect(brandFromHost('os.lux.network')).toBe('lux')
    expect(brandFromHost('lux.id')).toBe('lux')
  })

  it('maps zoo hosts (cloud, ngo, network, zoolabs.id)', () => {
    expect(brandFromHost('console.zoo.cloud')).toBe('zoo')
    expect(brandFromHost('zoo.ngo')).toBe('zoo')
    expect(brandFromHost('zoo.network')).toBe('zoo')
    expect(brandFromHost('zoolabs.id')).toBe('zoo')
  })

  it('maps pars hosts (cloud, network, AND id — symmetric with the other brands)', () => {
    expect(brandFromHost('pars.cloud')).toBe('pars')
    expect(brandFromHost('console.pars.cloud')).toBe('pars')
    expect(brandFromHost('pars.network')).toBe('pars')
    // Regression: every other brand maps its `.id` host; pars must too.
    expect(brandFromHost('pars.id')).toBe('pars')
  })

  it('is case- and port-insensitive', () => {
    expect(brandFromHost('CONSOLE.LUX.CLOUD')).toBe('lux')
    expect(brandFromHost('console.hanzo.ai:4000')).toBe('hanzo')
    expect(brandFromHost('  console.zoo.cloud  ')).toBe('zoo')
  })

  it('does not match a brand merely contained in a different TLD', () => {
    // endsWith('.hanzo.ai') guard, not a substring match.
    expect(brandFromHost('nothanzo.ai')).toBe('hanzo') // falls through to default
    expect(brandFromHost('hanzo.ai.evil.com')).toBe('hanzo') // default, not lux/zoo
  })
})

describe('resolveConfig', () => {
  it('resolves per-brand IAM identity, shared cloud/billing', () => {
    const lux = resolveConfig('console.lux.cloud')
    expect(lux.brand).toBe('lux')
    expect(lux.brandName).toBe('Lux Cloud')
    expect(lux.iamUrl).toBe('https://lux.id')
    expect(lux.iamOrgName).toBe('lux')
    expect(lux.iamAppName).toBe('lux-cloud')
    expect(lux.iamClientId).toBe('lux-cloud')
    expect(lux.platformUrl).toMatch(/^https:\/\//)
    expect(lux.billingUrl).toMatch(/^https:\/\//)
  })

  it('zoo uses zoolabs.id issuer (NOT zoo.id)', () => {
    const zoo = resolveConfig('console.zoo.cloud')
    expect(zoo.iamUrl).toBe('https://zoolabs.id')
    expect(zoo.iamOrgName).toBe('zoo')
  })
})

describe('branding', () => {
  it('builds a "<Brand> Console" wordmark for the current host', () => {
    // jsdom url is console.hanzo.ai -> hanzo brand.
    expect(branding.name).toBe('Hanzo Cloud Console')
    expect(branding.short).toBe('Cloud Console')
  })
})
