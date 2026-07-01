import { describe, it, expect } from 'vitest'

import { resolveConfig, isAdminHost, brandFromHost } from './index'

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

  it('admin host keeps the brand + brand IAM issuer/org — only the client changes', () => {
    const c = resolveConfig('admin.hanzo.ai')
    expect(c.brand).toBe('hanzo')
    expect(c.iamUrl).toBe('https://hanzo.id')
    expect(c.iamOrgName).toBe('hanzo')
  })

  it('normal hosts keep the brand cloud client — cache is host-keyed, not brand-keyed', () => {
    // Resolve the admin host FIRST to prove it does not poison the brand's
    // cache entry (both are brand=hanzo; a brand-keyed cache would collide).
    resolveConfig('admin.hanzo.ai')
    expect(resolveConfig('cloud.hanzo.ai').iamClientId).toBe('hanzo-cloud')
    expect(resolveConfig('console.hanzo.ai').iamClientId).toBe('hanzo-cloud')
  })

  it('the reserved admin org is ONE global app across every brand', () => {
    expect(resolveConfig('admin.lux.network').iamClientId).toBe('admin-console')
    expect(resolveConfig('admin.lux.network').brand).toBe('lux')
    expect(resolveConfig('admin.zoo.cloud').iamClientId).toBe('admin-console')
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
