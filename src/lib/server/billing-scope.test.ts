import { describe, it, expect } from 'vitest'

import {
  BILLING_SUBJECT_KEYS,
  billingSubject,
  scopedBillingSearch,
  personalBillingOrgs,
} from './billing-scope'

/**
 * Tenant isolation for the `/billing/*` proxy. These prove the fix for the IDOR
 * where the proxy pinned only `?user=` while commerce filters subscriptions on
 * `?userId=` (leaving subscriptions cross-tenant) — the proxy now pins the FULL
 * subject-key set, so NO billing endpoint is left unfiltered regardless of which
 * param it reads.
 */

const env = (o: Record<string, string> = {}): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv

describe('BILLING_SUBJECT_KEYS mirrors commerce edge-auth', () => {
  it('is exactly {user, userId, customerId}', () => {
    // Kept identical to commerce/middleware/edgeauth.go billingSubjectKeys. If
    // commerce adds a subject param, this must too — else that endpoint leaks.
    expect([...BILLING_SUBJECT_KEYS]).toEqual(['user', 'userId', 'customerId'])
  })
})

describe('billingSubject', () => {
  it('bills a personal-billing-org member per-user as <org>/<name>', () => {
    expect(billingSubject('hanzo', 'alice', env({ PERSONAL_BILLING_ORGS: 'hanzo' }))).toBe('hanzo/alice')
  })
  it('bills a dedicated org per-org as <org>', () => {
    expect(billingSubject('maxpower', 'bob', env({ PERSONAL_BILLING_ORGS: 'hanzo' }))).toBe('maxpower')
  })
  it('lowercases + trims (no case-smuggled cross-tenant subject)', () => {
    expect(billingSubject('  MaxPower ', 'x', env({ PERSONAL_BILLING_ORGS: 'hanzo' }))).toBe('maxpower')
  })
  it('returns empty for an empty org (fails closed — proxy would 403 upstream)', () => {
    expect(billingSubject('', 'alice')).toBe('')
  })
  it('defaults the personal-billing set to {hanzo}', () => {
    expect(personalBillingOrgs(env({}))).toEqual(new Set(['hanzo']))
  })
})

describe('scopedBillingSearch — pins EVERY subject param to the server subject', () => {
  const params = (qs: string) => Object.fromEntries(new URLSearchParams(qs))

  it('sets user, userId AND customerId to the subject (subscriptions read userId — this closes the leak)', () => {
    const out = params(scopedBillingSearch('', 'maxpower'))
    expect(out.user).toBe('maxpower')
    expect(out.userId).toBe('maxpower') // subscriptions.go filters on this
    expect(out.customerId).toBe('maxpower') // payment-methods.go filters on this
  })

  it('OVERWRITES a client-forged subject on every key (no scope-widening)', () => {
    // The exploit: a browser tries to read the victim tenant by supplying params.
    const forged = 'user=victim&userId=victim&customerId=victim&org=victim'
    const out = params(scopedBillingSearch(forged, 'attacker'))
    expect(out.user).toBe('attacker')
    expect(out.userId).toBe('attacker')
    expect(out.customerId).toBe('attacker')
    expect(out.org).toBeUndefined() // org is stripped entirely
    expect(Object.values(out)).not.toContain('victim')
  })

  it('drops a client-supplied org (org is server-resolved via the header, never a query)', () => {
    expect(params(scopedBillingSearch('org=victim', 'me')).org).toBeUndefined()
  })

  it('passes NON-subject params through untouched (status, type, currency, start)', () => {
    const out = params(scopedBillingSearch('status=active&type=card&currency=usd&start=2026-01-01', 'me'))
    expect(out.status).toBe('active')
    expect(out.type).toBe('card')
    expect(out.currency).toBe('usd')
    expect(out.start).toBe('2026-01-01')
    expect(out.userId).toBe('me')
  })

  it('two distinct tenants never share a scoped query (isolation)', () => {
    const a = scopedBillingSearch('', billingSubject('acme', 'u', env({ PERSONAL_BILLING_ORGS: 'hanzo' })))
    const b = scopedBillingSearch('', billingSubject('globex', 'u', env({ PERSONAL_BILLING_ORGS: 'hanzo' })))
    expect(a).not.toBe(b)
    expect(params(a).userId).toBe('acme')
    expect(params(b).userId).toBe('globex')
    // Neither tenant's scoped query contains the other's subject.
    expect(a).not.toContain('globex')
    expect(b).not.toContain('acme')
  })
})
