import { describe, it, expect } from 'vitest'

import { isSuperAdminAccount } from './admin'
import type { Account } from '~/lib/api'

const acct = (over: Partial<Account>): Account => ({ owner: 'maxpower', name: 'dave', ...over }) as Account

describe('isSuperAdminAccount — super-admin signal', () => {
  it('null/undefined account is never a super admin', () => {
    expect(isSuperAdminAccount(null)).toBe(false)
    expect(isSuperAdminAccount(undefined)).toBe(false)
  })

  it('membership in the reserved `admin` org IS super admin', () => {
    expect(isSuperAdminAccount(acct({ owner: 'admin', name: 'z' }))).toBe(true)
  })

  it('a tenant org admin is NOT a super admin (own-org admin ≠ platform admin)', () => {
    expect(isSuperAdminAccount(acct({ owner: 'maxpower', isAdmin: true }))).toBe(false)
  })

  it('honors the NEW canonical `isSuperAdmin` claim', () => {
    expect(isSuperAdminAccount(acct({ isSuperAdmin: true } as Partial<Account>))).toBe(true)
  })

  it('IGNORES the legacy `isGlobalAdmin` claim on the client (the server owns back-compat)', () => {
    // The console projects the canonical `isSuperAdmin` field (server `accountOf`); a bare
    // legacy claim without owner==='admin' is NOT a super admin on the client.
    expect(isSuperAdminAccount(acct({ isGlobalAdmin: true } as Partial<Account>))).toBe(false)
    // And a real `isSuperAdmin:false` is never resurrected by a stale legacy field.
    expect(isSuperAdminAccount(acct({ isSuperAdmin: false, isGlobalAdmin: true } as Partial<Account>))).toBe(false)
  })
})
