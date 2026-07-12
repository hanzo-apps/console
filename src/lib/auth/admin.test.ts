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

  it('honors the canonical `isSuperAdmin` claim', () => {
    expect(isSuperAdminAccount(acct({ isSuperAdmin: true } as Partial<Account>))).toBe(true)
  })
})
