import { describe, it, expect } from 'vitest'

import { resolveConfig, isAdminHost, isBillingOnlyHost, isMarketingHost, isAdsHost, isSocialHost, isSentryHost, isPlatformHost, shellFromHost, brandFromHost, cloudAudience, studioUrl, type ShellId } from './index'

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

  it('resolves the brand under a padded / ported / trailing-dot host (admin-gate boundary)', () => {
    // A mis-resolve here would swap the admin-gate adminDomain onto the default
    // brand. Normalization must strip a trailing port even when whitespace-padded
    // (trim-before-port) and a trailing FQDN root dot.
    expect(brandFromHost('  lux.network:8443  ')).toBe('lux')
    expect(brandFromHost('\tcloud.7stars.dev:443\n')).toBe('7stars')
    expect(brandFromHost('lux.network.')).toBe('lux')
    expect(brandFromHost('cloud.7stars.dev.')).toBe('7stars')
    expect(brandFromHost('LUX.NETWORK.:443')).toBe('lux')
    // A lookalike must still fall to the default even with a trailing dot / port.
    expect(brandFromHost('evil7stars.dev.')).toBe('hanzo')
    expect(brandFromHost('lux.network.evil.com:443')).toBe('hanzo')
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

  it('derives a per-brand pay.<brand> host (white-label-safe — never crosses brands)', () => {
    // The Wallet "Top up" links here in a new tab; each brand gets ITS OWN payment host.
    expect(resolveConfig('console.hanzo.ai').payUrl).toBe('https://pay.hanzo.ai')
    expect(resolveConfig('cloud.lux.cloud').payUrl).toBe('https://pay.lux.cloud')
    expect(resolveConfig('cloud.zoo.cloud').payUrl).toBe('https://pay.zoo.cloud')
    expect(resolveConfig('cloud.7stars.dev').payUrl).toBe('https://pay.7stars.dev')
    // A non-hanzo brand NEVER links to pay.hanzo.ai (white-label isolation).
    expect(resolveConfig('cloud.lux.cloud').payUrl).not.toContain('hanzo')
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

/**
 * marketing-only shell host — the host→mode twin of billing-only for the new
 * `/v1/marketing` domain seam: marketing.<brand> boots the console into the ONE
 * Marketing product (config.marketingOnly), the SAME image, keeping the brand.
 */
describe('marketing-only shell host', () => {
  it('matches marketing.<brand> case- and port-insensitively', () => {
    expect(isMarketingHost('marketing.hanzo.ai')).toBe(true)
    expect(isMarketingHost('MARKETING.Lux.cloud:443')).toBe(true)
    expect(isMarketingHost('marketing.zoo.cloud')).toBe(true)
  })

  it('is a strict marketing. prefix — no false positives', () => {
    expect(isMarketingHost('cloud.hanzo.ai')).toBe(false)
    expect(isMarketingHost('mymarketing.hanzo.ai')).toBe(false)
    expect(isMarketingHost('')).toBe(false)
    expect(isMarketingHost(null)).toBe(false)
  })

  it('resolveConfig marks the marketing host marketing-only, keeping the brand', () => {
    const c = resolveConfig('marketing.hanzo.ai')
    expect(c.marketingOnly).toBe(true)
    expect(c.brand).toBe('hanzo')
    // marketing-only is orthogonal to billing-only — never both.
    expect(c.billingOnly).toBe(false)
  })

  it('a normal console host is NOT marketing-only', () => {
    expect(resolveConfig('cloud.hanzo.ai').marketingOnly).toBe(false)
    expect(resolveConfig('console.hanzo.ai').marketingOnly).toBe(false)
    // and a billing host is billing-only, not marketing-only.
    expect(resolveConfig('billing.hanzo.ai').marketingOnly).toBe(false)
  })

  it('resolves marketing-only per brand (lux/zoo marketing hosts)', () => {
    expect(resolveConfig('marketing.lux.cloud').marketingOnly).toBe(true)
    expect(resolveConfig('marketing.lux.cloud').brand).toBe('lux')
    expect(resolveConfig('marketing.zoo.cloud').marketingOnly).toBe(true)
    expect(resolveConfig('marketing.zoo.cloud').brand).toBe('zoo')
  })
})

/**
 * ads-only shell host — the host→mode twin of billing-only for the new `/v1/ads`
 * domain seam: ads.<brand> boots the console into the ONE Ads product
 * (config.adsOnly), the SAME image, keeping the brand.
 */
describe('ads-only shell host', () => {
  it('matches ads.<brand> case- and port-insensitively', () => {
    expect(isAdsHost('ads.hanzo.ai')).toBe(true)
    expect(isAdsHost('ADS.Lux.cloud:443')).toBe(true)
    expect(isAdsHost('ads.zoo.cloud')).toBe(true)
  })

  it('is a strict ads. prefix — no false positives', () => {
    expect(isAdsHost('cloud.hanzo.ai')).toBe(false)
    expect(isAdsHost('myads.hanzo.ai')).toBe(false)
    expect(isAdsHost('')).toBe(false)
    expect(isAdsHost(null)).toBe(false)
  })

  it('resolveConfig marks the ads host ads-only, keeping the brand', () => {
    const c = resolveConfig('ads.hanzo.ai')
    expect(c.adsOnly).toBe(true)
    expect(c.brand).toBe('hanzo')
    // ads-only is orthogonal to billing-only — never both.
    expect(c.billingOnly).toBe(false)
  })

  it('a normal console host is NOT ads-only', () => {
    expect(resolveConfig('cloud.hanzo.ai').adsOnly).toBe(false)
    expect(resolveConfig('console.hanzo.ai').adsOnly).toBe(false)
    // and a billing host is billing-only, not ads-only.
    expect(resolveConfig('billing.hanzo.ai').adsOnly).toBe(false)
  })

  it('resolves ads-only per brand (lux/zoo ads hosts)', () => {
    expect(resolveConfig('ads.lux.cloud').adsOnly).toBe(true)
    expect(resolveConfig('ads.lux.cloud').brand).toBe('lux')
    expect(resolveConfig('ads.zoo.cloud').adsOnly).toBe(true)
    expect(resolveConfig('ads.zoo.cloud').brand).toBe('zoo')
  })
})

/**
 * social-only shell host — the host→mode twin of billing-only for the new
 * `/v1/social` domain seam: social.<brand> boots the console into the ONE Social
 * product (config.socialOnly), the SAME image, keeping the brand.
 */
describe('social-only shell host', () => {
  it('matches social.<brand> case- and port-insensitively', () => {
    expect(isSocialHost('social.hanzo.ai')).toBe(true)
    expect(isSocialHost('SOCIAL.Lux.cloud:443')).toBe(true)
    expect(isSocialHost('social.zoo.cloud')).toBe(true)
  })

  it('is a strict social. prefix — no false positives', () => {
    expect(isSocialHost('cloud.hanzo.ai')).toBe(false)
    expect(isSocialHost('mysocial.hanzo.ai')).toBe(false)
    expect(isSocialHost('')).toBe(false)
    expect(isSocialHost(null)).toBe(false)
  })

  it('resolveConfig marks the social host social-only, keeping the brand', () => {
    const c = resolveConfig('social.hanzo.ai')
    expect(c.socialOnly).toBe(true)
    expect(c.brand).toBe('hanzo')
    // social-only is orthogonal to billing-only — never both.
    expect(c.billingOnly).toBe(false)
  })

  it('a normal console host is NOT social-only', () => {
    expect(resolveConfig('cloud.hanzo.ai').socialOnly).toBe(false)
    expect(resolveConfig('console.hanzo.ai').socialOnly).toBe(false)
    // and a billing host is billing-only, not social-only.
    expect(resolveConfig('billing.hanzo.ai').socialOnly).toBe(false)
  })

  it('resolves social-only per brand (lux/zoo social hosts)', () => {
    expect(resolveConfig('social.lux.cloud').socialOnly).toBe(true)
    expect(resolveConfig('social.lux.cloud').brand).toBe('lux')
    expect(resolveConfig('social.zoo.cloud').socialOnly).toBe(true)
    expect(resolveConfig('social.zoo.cloud').brand).toBe('zoo')
  })
})

/**
 * cloudAudience — the RFC 8707 resource a forwarded user bearer is scoped to so the
 * cloud API accepts it. It is the brand cloud client id (`<brand>-cloud`), read off
 * the brand's own `iamApp`, host-aware, and — critically — the SAME cloud audience on
 * an admin host, where the LOGIN app switches to admin-console but the resource the
 * token is presented to is still the brand cloud API. admin-console is NOT in cloud's
 * allowlist, which is exactly why the admin-aggregate must scope to this value.
 */
describe('cloudAudience — the cloud API resource for the forwarded bearer', () => {
  it('is the brand cloud client id (<brand>-cloud), resolved from the host', () => {
    expect(cloudAudience('cloud.hanzo.ai')).toBe('hanzo-cloud')
    expect(cloudAudience('console.hanzo.ai')).toBe('hanzo-cloud')
    expect(cloudAudience('cloud.lux.network')).toBe('lux-cloud')
    expect(cloudAudience('cloud.zoo.cloud')).toBe('zoo-cloud')
    expect(cloudAudience('cloud.pars.network')).toBe('pars-cloud')
  })

  it('is the brand cloud audience EVEN on an admin host (never the admin-console login app)', () => {
    // The admin host logs in as admin-console (org admin)…
    expect(resolveConfig('admin.hanzo.ai').iamClientId).toBe('admin-console')
    // …but a bearer forwarded to the cloud API must carry the cloud audience cloud
    // trusts. admin-console is NOT in cloud's allowlist — this was the /v1/admin/* 403.
    expect(cloudAudience('admin.hanzo.ai')).toBe('hanzo-cloud')
    expect(cloudAudience('admin.lux.network')).toBe('lux-cloud')
    expect(cloudAudience('admin.zoo.cloud')).toBe('zoo-cloud')
  })

  it('defaults to the hanzo cloud audience for an unknown host', () => {
    expect(cloudAudience(undefined)).toBe('hanzo-cloud')
    expect(cloudAudience('')).toBe('hanzo-cloud')
  })
})

/**
 * The UNIFIED product-shell model — ONE `shell: ShellId` resolved by `shellFromHost`,
 * of which the four `*Only` booleans are legacy `shell === '<x>'` aliases. Proves all
 * FIVE faces (billing/marketing/ads/social/sentry) resolve at the config level and stay
 * orthogonal to the brand (a face host keeps its own brand). Called with explicit hosts.
 */
describe('config: unified product shell (five faces)', () => {
  const FACE_HOST: Record<Exclude<ShellId, 'console'>, string> = {
    billing: 'billing.hanzo.ai',
    marketing: 'marketing.hanzo.ai',
    ads: 'ads.hanzo.ai',
    social: 'social.hanzo.ai',
    sentry: 'sentry.hanzo.ai',
    dns: 'dns.hanzo.ai',
    platform: 'platform.hanzo.ai',
  }

  it('resolveConfig(host).shell is the host face; a full-console host is "console"', () => {
    for (const [face, host] of Object.entries(FACE_HOST)) {
      expect(resolveConfig(host).shell).toBe(face)
    }
    expect(resolveConfig('cloud.hanzo.ai').shell).toBe('console')
    expect(resolveConfig('console.hanzo.ai').shell).toBe('console')
    expect(resolveConfig('admin.hanzo.ai').shell).toBe('console')
  })

  it('the four *Only booleans are the shell aliases — exactly one true per face, none on console', () => {
    const b = resolveConfig('billing.hanzo.ai')
    expect([b.billingOnly, b.marketingOnly, b.adsOnly, b.socialOnly]).toEqual([true, false, false, false])
    const m = resolveConfig('marketing.hanzo.ai')
    expect([m.billingOnly, m.marketingOnly, m.adsOnly, m.socialOnly]).toEqual([false, true, false, false])
    const a = resolveConfig('ads.hanzo.ai')
    expect([a.billingOnly, a.marketingOnly, a.adsOnly, a.socialOnly]).toEqual([false, false, true, false])
    const s = resolveConfig('social.hanzo.ai')
    expect([s.billingOnly, s.marketingOnly, s.adsOnly, s.socialOnly]).toEqual([false, false, false, true])
    // sentry is a face with NO legacy boolean (all four false) — it reads `shell`.
    const se = resolveConfig('sentry.hanzo.ai')
    expect([se.billingOnly, se.marketingOnly, se.adsOnly, se.socialOnly]).toEqual([false, false, false, false])
    expect(se.shell).toBe('sentry')
    // console: every boolean false.
    const c = resolveConfig('cloud.hanzo.ai')
    expect([c.billingOnly, c.marketingOnly, c.adsOnly, c.socialOnly]).toEqual([false, false, false, false])
  })

  it('isSentryHost + shellFromHost agree, and the sentry host is strict', () => {
    expect(isSentryHost('sentry.hanzo.ai')).toBe(true)
    expect(isSentryHost('SENTRY.Lux.cloud:443')).toBe(true)
    expect(isSentryHost('mysentry.hanzo.ai')).toBe(false)
    expect(isSentryHost('')).toBe(false)
    expect(shellFromHost('sentry.lux.cloud')).toBe('sentry')
  })

  it('isPlatformHost + shellFromHost agree, and the platform host is strict', () => {
    // platform.<brand> boots the embedded PaaS control-plane face (apps/deploys/drift),
    // NOT the full-console catalog grid — the live console.hanzo.ai vs platform.hanzo.ai fix.
    expect(isPlatformHost('platform.hanzo.ai')).toBe(true)
    expect(isPlatformHost('PLATFORM.Lux.cloud:443')).toBe(true)
    expect(isPlatformHost('myplatform.hanzo.ai')).toBe(false)
    expect(isPlatformHost('')).toBe(false)
    expect(resolveConfig('platform.hanzo.ai').shell).toBe('platform')
    expect(resolveConfig('platform.lux.cloud').shell).toBe('platform')
    // orthogonal to brand — platform.lux.cloud is the lux brand wearing the Platform face
    expect(resolveConfig('platform.lux.cloud').brand).toBe('lux')
    // a full-console host is NOT the platform face
    expect(resolveConfig('console.hanzo.ai').shell).toBe('console')
  })

  it('WHITE-LABEL: a face never crosses a brand — every face host keeps its own brand', () => {
    expect(brandFromHost('sentry.hanzo.ai')).toBe('hanzo')
    expect(brandFromHost('marketing.lux.cloud')).toBe('lux')
    expect(brandFromHost('ads.zoo.ngo')).toBe('zoo')
    expect(brandFromHost('social.pars.cloud')).toBe('pars')
    // …and the brand's IAM is unchanged by the face (still the brand's own issuer/app).
    expect(resolveConfig('sentry.lux.cloud').iamOrgName).toBe(resolveConfig('cloud.lux.cloud').iamOrgName)
    expect(resolveConfig('marketing.zoo.ngo').iamAppName).toBe(resolveConfig('cloud.zoo.ngo').iamAppName)
  })
})

/**
 * studioUrl — the ONE gate the Studio embed reads. WHITE-LABEL LAW: only a brand
 * with its OWN Studio instance gets a URL; every other brand gets null (the honest
 * not-provisioned card) — NEVER another brand's instance leaking cross-brand.
 */
describe('studioUrl — brand-scoped Studio embed origin', () => {
  it('resolves hanzo hosts to the hanzo Studio', () => {
    expect(studioUrl('cloud.hanzo.ai')).toBe('https://studio.hanzo.ai')
    expect(studioUrl('console.hanzo.ai')).toBe('https://studio.hanzo.ai')
  })

  it('NEVER hands another brand the hanzo Studio — null → honest card', () => {
    for (const host of ['cloud.lux.network', 'console.zoo.cloud', 'cloud.pars.network', 'console.7stars.dev']) {
      expect(studioUrl(host)).toBeNull()
    }
  })
})
