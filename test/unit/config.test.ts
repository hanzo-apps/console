import { describe, it, expect } from 'vitest'

import { brandFromHost, envFromHost, resolveConfig, branding } from '~/config'

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

/**
 * ONE image serves mainnet/testnet/devnet; the env tier is resolved from the
 * host's env label. A non-prod console MUST NOT bounce sign-in to the prod
 * issuer, so the host→env map (and the per-env issuer it implies) is pinned here.
 */
describe('envFromHost', () => {
  it('defaults to mainnet when there is no env label', () => {
    expect(envFromHost('console.hanzo.ai')).toBe('mainnet')
    expect(envFromHost('hanzo.ai')).toBe('mainnet')
    expect(envFromHost('')).toBe('mainnet')
    expect(envFromHost(null)).toBe('mainnet')
    expect(envFromHost(undefined)).toBe('mainnet')
  })

  it('detects devnet / testnet from the env label (any service host)', () => {
    expect(envFromHost('console.devnet.hanzo.ai')).toBe('devnet')
    expect(envFromHost('id.devnet.hanzo.ai')).toBe('devnet')
    expect(envFromHost('api.devnet.hanzo.ai')).toBe('devnet')
    expect(envFromHost('console.testnet.hanzo.ai')).toBe('testnet')
    expect(envFromHost('api.testnet.hanzo.ai')).toBe('testnet')
  })

  it('is case- and port-insensitive', () => {
    expect(envFromHost('CONSOLE.DEVNET.HANZO.AI:4000')).toBe('devnet')
    expect(envFromHost('  console.testnet.hanzo.ai  ')).toBe('testnet')
  })

  it('matches the env LABEL, not a substring (devnetwork ≠ devnet)', () => {
    expect(envFromHost('devnetwork.hanzo.ai')).toBe('mainnet')
    expect(envFromHost('testnetic.hanzo.ai')).toBe('mainnet')
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

  it('mainnet hanzo keeps the prod vanity issuer', () => {
    const m = resolveConfig('console.hanzo.ai')
    expect(m.brand).toBe('hanzo')
    expect(m.env).toBe('mainnet')
    expect(m.iamUrl).toBe('https://hanzo.id')
  })

  it('devnet hanzo resolves the per-env issuer (NOT prod hanzo.id) — the sign-in bounce fix', () => {
    const dev = resolveConfig('console.devnet.hanzo.ai')
    expect(dev.brand).toBe('hanzo')
    expect(dev.env).toBe('devnet')
    expect(dev.iamUrl).toBe('https://id.devnet.hanzo.ai')
    // org/app/client are unchanged across envs — only the issuer host moves.
    expect(dev.iamOrgName).toBe('hanzo')
    expect(dev.iamAppName).toBe('hanzo-cloud')
    expect(dev.iamClientId).toBe('hanzo-cloud')
  })

  it('testnet hanzo resolves its own per-env issuer (one image serves testnet too)', () => {
    const t = resolveConfig('console.testnet.hanzo.ai')
    expect(t.env).toBe('testnet')
    expect(t.iamUrl).toBe('https://id.testnet.hanzo.ai')
  })
})

describe('branding', () => {
  it('builds a "<Brand> Console" wordmark for the current host', () => {
    // jsdom url is console.hanzo.ai -> hanzo brand.
    expect(branding.name).toBe('Hanzo Cloud Console')
    expect(branding.short).toBe('Cloud Console')
  })
})
