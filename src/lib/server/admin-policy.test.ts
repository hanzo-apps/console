import { describe, it, expect } from 'vitest'

import { emailOnBrand, isAdminGranted, gateAllows, ownerAllowed, orgFor } from './admin-policy'

describe('admin gate — email on brand domain', () => {
  it('accepts an exact brand-domain email, case-insensitively', () => {
    expect(emailOnBrand('z@hanzo.ai', 'hanzo.ai')).toBe(true)
    expect(emailOnBrand('Z@HANZO.AI', 'hanzo.ai')).toBe(true)
  })
  it('rejects another domain and the empty email', () => {
    expect(emailOnBrand('davelorenzini@gmail.com', 'hanzo.ai')).toBe(false)
    expect(emailOnBrand('', 'hanzo.ai')).toBe(false)
    // a hanzo.ai admin must NOT reach a lux host
    expect(emailOnBrand('z@hanzo.ai', 'lux.network')).toBe(false)
  })
})

describe('admin gate — IAM admin flag', () => {
  it('grants org or global admins, denies plain members', () => {
    expect(isAdminGranted({ isAdmin: true, isGlobalAdmin: false })).toBe(true)
    expect(isAdminGranted({ isAdmin: false, isGlobalAdmin: true })).toBe(true)
    expect(isAdminGranted({ isAdmin: false, isGlobalAdmin: false })).toBe(false)
  })
})

describe('admin gate — combined (allow verified @hanzo.ai+admin, deny others)', () => {
  const admin = { email: 'z@hanzo.ai', emailVerified: true, isAdmin: true, isGlobalAdmin: true }
  it('allows the verified brand admin', () => {
    expect(gateAllows(admin, 'hanzo.ai')).toBe(true)
  })
  it('denies a non-brand email even when an IAM admin', () => {
    expect(gateAllows({ email: 'davelorenzini@gmail.com', emailVerified: true, isAdmin: true, isGlobalAdmin: false }, 'hanzo.ai')).toBe(false)
  })
  it('denies a brand email that is NOT an IAM admin', () => {
    expect(gateAllows({ email: 'member@hanzo.ai', emailVerified: true, isAdmin: false, isGlobalAdmin: false }, 'hanzo.ai')).toBe(false)
  })
  it('denies a brand admin whose email is NOT verified', () => {
    expect(gateAllows({ email: 'z@hanzo.ai', emailVerified: false, isAdmin: true, isGlobalAdmin: true }, 'hanzo.ai')).toBe(false)
  })
})

describe('tenant scoping — ownerAllowed (cross-tenant read gap closed)', () => {
  const global = { isGlobalAdmin: true, orgScope: 'hanzo' }
  const brand = { isGlobalAdmin: false, orgScope: 'hanzo' }
  it('lets a global admin reference any org', () => {
    expect(ownerAllowed('adnexus', global)).toBe(true)
    expect(ownerAllowed('lux', global)).toBe(true)
  })
  it('pins a brand admin to their own org', () => {
    expect(ownerAllowed('hanzo', brand)).toBe(true)
    expect(ownerAllowed('adnexus', brand)).toBe(false)
  })
  it('allows a null owner (caller-scoped endpoint)', () => {
    expect(ownerAllowed(null, brand)).toBe(true)
  })
  it('allows the metadata owner only on org-list endpoints', () => {
    expect(ownerAllowed('admin', { ...brand, orgMetadataOk: true })).toBe(true)
    // 'built-in' dual-recognition was deliberately dropped (v0.7.15,
    // 9b59dec — "standardize the global-admin org on 'admin'") so the gate
    // matches commerce/ai/gateway. The canonical global-admin metadata org is
    // 'admin' ONLY; 'built-in' must now be rejected even on org-list endpoints.
    expect(ownerAllowed('built-in', { ...brand, orgMetadataOk: true })).toBe(false)
    expect(ownerAllowed('admin', { ...brand, orgMetadataOk: false })).toBe(false)
  })
})

describe('tenant scoping — orgFor (KMS never crosses a brand admin to another org)', () => {
  it('honors the requested org for a global admin', () => {
    expect(orgFor({ isGlobalAdmin: true, orgScope: 'hanzo' }, 'adnexus')).toBe('adnexus')
  })
  it('falls back to the scope when a global admin requests nothing', () => {
    expect(orgFor({ isGlobalAdmin: true, orgScope: 'hanzo' }, null)).toBe('hanzo')
  })
  it('IGNORES a requested org for a brand admin (no secret leak across orgs)', () => {
    expect(orgFor({ isGlobalAdmin: false, orgScope: 'hanzo' }, 'adnexus')).toBe('hanzo')
  })
})
