import { describe, it, expect } from 'vitest'

import { resolveConfig, isAdminHost, isBillingOnlyHost, brandFromHost } from './index'

/**
 * Per-host admin login client (admin.hanzo.ai global-admin cutover).
 *
 * On an admin console host the OAuth client must be the admin-org app
 * (`admin-console`) so IAM resolves the global-admin identity (owner=admin);
 * every normal host keeps the brand's cloud client. Pure host→config logic,
 * called with explicit hosts (no window needed).
 */
describe('config: per-host admin login client', () => {
  it('admin.<brand> selects the admin-org OAuth app (client + appName)', () => {
    const c = resolveConfig('admin.hanzo.ai')
    expect(c.iamClientId).toBe('admin-console')
    expect(c.iamAppName).toBe('admin-console')
  })

  it('admin host keeps the brand + brand IAM issuer, but switches the ORG to the reserved admin org', () => {
    const c = resolveConfig('admin.hanzo.ai')
    expect(c.brand).toBe('hanzo')
    expect(c.iamUrl).toBe('https://hanzo.id')
    // The `admin-console` app is registered in the reserved `admin` org — login MUST
    // resolve there (owner=admin), so BOTH the app and the org switch on an admin host.
    expect(c.iamOrgName).toBe('admin')
  })

  it('admin.hanzo.ai resolves the FULL operator auth config (app + client + org)', () => {
    const c = resolveConfig('admin.hanzo.ai')
    expect(c.iamAppName).toBe('admin-console')
    expect(c.iamClientId).toBe('admin-console')
    expect(c.iamOrgName).toBe('admin')
  })

  it('a tenant host (console.hanzo.ai) is UNCHANGED — brand app + brand org', () => {
    const c = resolveConfig('console.hanzo.ai')
    expect(c.iamClientId).toBe('hanzo-cloud')
    expect(c.iamAppName).toBe('hanzo-cloud')
    expect(c.iamOrgName).toBe('hanzo')
  })

  it('normal hosts keep the brand cloud client — cache is host-keyed, not brand-keyed', () => {
    // Resolve the admin host FIRST to prove it does not poison the brand's
    // cache entry (both are brand=hanzo; a brand-keyed cache would collide).
    resolveConfig('admin.hanzo.ai')
    expect(resolveConfig('cloud.hanzo.ai').iamClientId).toBe('hanzo-cloud')
    expect(resolveConfig('console.hanzo.ai').iamClientId).toBe('hanzo-cloud')
  })

  it('the reserved admin org is ONE global app+org across every brand', () => {
    expect(resolveConfig('admin.lux.network').iamClientId).toBe('admin-console')
    expect(resolveConfig('admin.lux.network').iamOrgName).toBe('admin')
    expect(resolveConfig('admin.lux.network').brand).toBe('lux')
    expect(resolveConfig('admin.zoo.cloud').iamClientId).toBe('admin-console')
    expect(resolveConfig('admin.zoo.cloud').iamOrgName).toBe('admin')
  })
})

describe('white-label cloud tenants (7stars / yotoda)', () => {
  it('resolves the brand from the tenant host (incl. subdomains)', () => {
    expect(brandFromHost('7stars.dev')).toBe('7stars')
    expect(brandFromHost('cloud.7stars.dev')).toBe('7stars')
    expect(brandFromHost('console.7stars.dev:443')).toBe('7stars')
    expect(brandFromHost('yotoda.tech')).toBe('yotoda')
    expect(brandFromHost('cloud.yotoda.tech')).toBe('yotoda')
  })

  it('authenticates against the hanzo.id issuer (no own .id) with the per-brand org + app', () => {
    const s = resolveConfig('cloud.7stars.dev')
    expect(s.brand).toBe('7stars')
    expect(s.brandName).toBe('7Stars Cloud')
    expect(s.iamUrl).toBe('https://hanzo.id')
    expect(s.iamOrgName).toBe('7stars')
    expect(s.iamClientId).toBe('7stars-cloud')
    expect(s.iamAppName).toBe('7stars-cloud')

    const y = resolveConfig('cloud.yotoda.tech')
    expect(y.brand).toBe('yotoda')
    expect(y.brandName).toBe('Yotoda Cloud')
    expect(y.iamUrl).toBe('https://hanzo.id')
    expect(y.iamOrgName).toBe('yotoda')
    expect(y.iamClientId).toBe('yotoda-cloud')
  })

  it('carries its own per-brand billing + docs host', () => {
    expect(resolveConfig('cloud.7stars.dev').billingUrl).toBe('https://billing.7stars.dev')
    expect(resolveConfig('cloud.7stars.dev').docsUrl).toBe('https://docs.7stars.dev')
    expect(resolveConfig('cloud.yotoda.tech').billingUrl).toBe('https://billing.yotoda.tech')
    expect(resolveConfig('cloud.yotoda.tech').docsUrl).toBe('https://docs.yotoda.tech')
  })

  it('admin.<tenant> still uses the ONE global admin app+org, keeping the brand', () => {
    expect(resolveConfig('admin.7stars.dev').iamClientId).toBe('admin-console')
    expect(resolveConfig('admin.7stars.dev').iamOrgName).toBe('admin')
    expect(resolveConfig('admin.7stars.dev').brand).toBe('7stars')
    // …but its IAM issuer stays hanzo.id (the tenant has no own issuer).
    expect(resolveConfig('admin.7stars.dev').iamUrl).toBe('https://hanzo.id')
  })
})

describe('isAdminHost', () => {
  it('matches admin.<host> case- and port-insensitively', () => {
    expect(isAdminHost('admin.hanzo.ai')).toBe(true)
    expect(isAdminHost('ADMIN.Hanzo.ai:443')).toBe(true)
  })

  it('is a strict admin. prefix — no false positives', () => {
    expect(isAdminHost('cloud.hanzo.ai')).toBe(false)
    expect(isAdminHost('myadmin.hanzo.ai')).toBe(false)
    // requires the literal `admin.` boundary — a host merely starting with the
    // letters "admin" is NOT an admin host (no false positive).
    expect(isAdminHost('administrator.hanzo.ai')).toBe(false)
    expect(isAdminHost('')).toBe(false)
    expect(isAdminHost(null)).toBe(false)
  })

  it('does not change brand resolution', () => {
    expect(brandFromHost('admin.hanzo.ai')).toBe('hanzo')
  })
})

describe('billing-only shell host', () => {
  it('matches billing.<brand> case- and port-insensitively', () => {
    expect(isBillingOnlyHost('billing.hanzo.ai')).toBe(true)
    expect(isBillingOnlyHost('BILLING.Lux.cloud:443')).toBe(true)
    expect(isBillingOnlyHost('billing.zoo.cloud')).toBe(true)
  })

  it('is a strict billing. prefix — no false positives', () => {
    expect(isBillingOnlyHost('cloud.hanzo.ai')).toBe(false)
    expect(isBillingOnlyHost('mybilling.hanzo.ai')).toBe(false)
    expect(isBillingOnlyHost('')).toBe(false)
    expect(isBillingOnlyHost(null)).toBe(false)
  })

  it('resolveConfig marks the billing host billing-only, keeping the brand', () => {
    const c = resolveConfig('billing.hanzo.ai')
    expect(c.billingOnly).toBe(true)
    expect(c.brand).toBe('hanzo')
    // billing.<brand> keeps the brand's own billing portal URL + IAM.
    expect(c.iamOrgName).toBe('hanzo')
  })

  it('a normal console host is NOT billing-only', () => {
    expect(resolveConfig('cloud.hanzo.ai').billingOnly).toBe(false)
    expect(resolveConfig('console.hanzo.ai').billingOnly).toBe(false)
  })

  it('resolves billing-only per brand (lux/zoo billing hosts)', () => {
    expect(resolveConfig('billing.lux.cloud').billingOnly).toBe(true)
    expect(resolveConfig('billing.lux.cloud').brand).toBe('lux')
    expect(resolveConfig('billing.zoo.cloud').billingOnly).toBe(true)
    expect(resolveConfig('billing.zoo.cloud').brand).toBe('zoo')
  })
})
