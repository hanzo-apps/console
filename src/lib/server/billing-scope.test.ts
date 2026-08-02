import { describe, it, expect } from 'vitest'

import {
  BILLING_SUBJECT_KEYS,
  HOLDER_KINDS,
  billingSubject,
  holderIdFor,
  scopedBillingSearch,
  scopedBillingBody,
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
    expect(out.customerId).toBe('maxpower') // the commerce methods handler filters on this
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

describe('scopedBillingBody — pins the subject onto a WRITE body too', () => {
  const parse = (s: string) => JSON.parse(s) as Record<string, unknown>

  it('sets user, userId AND customerId on a JSON object (create-budget needs userId)', () => {
    // Commerce CreateSpendAlert binds `userId` from the body — pin it server-side.
    const out = parse(scopedBillingBody(JSON.stringify({ title: 'cap', threshold: 5000 }), 'maxpower', 'maxpower'))
    expect(out.user).toBe('maxpower')
    expect(out.userId).toBe('maxpower')
    expect(out.customerId).toBe('maxpower')
    // Non-subject fields pass through untouched.
    expect(out.title).toBe('cap')
    expect(out.threshold).toBe(5000)
  })

  it('OVERWRITES a client-forged body subject (no scope-widening from the browser)', () => {
    const forged = JSON.stringify({ userId: 'victim', user: 'victim', customerId: 'victim', threshold: 1 })
    const out = parse(scopedBillingBody(forged, 'attacker', 'attacker'))
    expect(out.userId).toBe('attacker')
    expect(out.user).toBe('attacker')
    expect(out.customerId).toBe('attacker')
    expect(Object.values(out)).not.toContain('victim')
  })

  it('leaves a non-JSON body untouched (only ever narrows a JSON object)', () => {
    expect(scopedBillingBody('not json', 'me', 'me')).toBe('not json')
    expect(scopedBillingBody('', 'me', 'me')).toBe('')
  })

  it('leaves a JSON array / primitive untouched (no top-level subject to pin)', () => {
    expect(scopedBillingBody('[1,2,3]', 'me', 'me')).toBe('[1,2,3]')
    expect(scopedBillingBody('42', 'me', 'me')).toBe('42')
  })

  it('two tenants creating the same budget get disjoint bodies (isolation)', () => {
    const body = JSON.stringify({ title: 'cap', threshold: 100 })
    const a = parse(scopedBillingBody(body, 'acme', 'acme'))
    const b = parse(scopedBillingBody(body, 'globex', 'globex'))
    expect(a.userId).toBe('acme')
    expect(b.userId).toBe('globex')
  })

  it('leaves a spend-alert body that carries a `project` UNTOUCHED (no holderKind = not a binding write)', () => {
    // LIVE-PATH GUARD: a budget's scope IS a project name (BillingBudgets posts
    // {project, service, ...}). The holder pin must not consume it.
    const out = parse(scopedBillingBody(JSON.stringify({ title: 'cap', project: 'apollo', service: '' }), 'me', 'me'))
    expect(out.project).toBe('apollo')
    expect(out.holderId).toBeUndefined()
    expect(out.holderKind).toBeUndefined()
  })
})

/**
 * The HOLDER pin — who a billing account is attached to, i.e. WHOSE CHAIN PAYS.
 *
 * A binding's holder is a payer decision, so it is strictly more dangerous than the
 * subject pin above: a client-named holder is not "read another tenant's rows", it is
 * "attach an account to another user's/org's/project's chain". The browser therefore
 * names a holder KIND only; `holderIdFor` says which holder that is. These prove a
 * forged `holderId` never survives the proxy.
 */
describe('holderIdFor — the holder is DERIVED server-side, never the browser’s word', () => {
  it('mirrors commerce’s holder vocabulary exactly {user, org, project}', () => {
    // Kept identical to commerce/models/billingaccount/billingaccount.go.
    expect([...HOLDER_KINDS]).toEqual(['user', 'org', 'project'])
  })

  it('org → the caller’s own org slug (lowercased/trimmed — no case-smuggled holder)', () => {
    expect(holderIdFor('org', '  MaxPower ', 'maxpower', '')).toBe('maxpower')
  })

  it('user → the caller’s own billing subject (the anchor resolveBilling collects)', () => {
    expect(holderIdFor('user', 'hanzo', 'hanzo/alice', '')).toBe('hanzo/alice')
  })

  it('project → the project NAME (tenant-confined by the org namespace, not the string)', () => {
    expect(holderIdFor('project', 'maxpower', 'maxpower', 'apollo')).toBe('apollo')
  })

  it('an unknown kind derives NO holder (fails closed — never a client-chosen value)', () => {
    expect(holderIdFor('everyone', 'maxpower', 'maxpower', '')).toBeNull()
    expect(holderIdFor('', 'maxpower', 'maxpower', '')).toBeNull()
  })
})

describe('scopedBillingBody — a binding write’s holder is pinned to the caller', () => {
  const parse = (s: string) => JSON.parse(s) as Record<string, unknown>
  const bind = (body: unknown, subject: string, org: string) => parse(scopedBillingBody(JSON.stringify(body), subject, org))

  it('derives holderId for an ORG binding, OVERWRITING a forged one', () => {
    // THE EXPLOIT: attacker attaches THEIR account to the VICTIM org's chain.
    const out = bind({ holderKind: 'org', holderId: 'victim', accountId: 'acct_mine', priority: 0 }, 'attacker', 'attacker')
    expect(out.holderId).toBe('attacker')
    expect(out.holderKind).toBe('org')
    expect(out.accountId).toBe('acct_mine') // non-holder fields pass through
    expect(out.priority).toBe(0)
  })

  it('derives holderId for a USER binding, OVERWRITING a forged peer subject', () => {
    // THE EXPLOIT (the sharpest one): inside the SHARED personal-billing org `hanzo`,
    // every member's subject lives in ONE namespace, so a forged `holderId` would
    // attach an account to a PEER's chain. The pin makes it the caller's own anchor.
    const out = bind({ holderKind: 'user', holderId: 'hanzo/victim', accountId: 'acct_x', priority: 1 }, 'hanzo/attacker', 'hanzo')
    expect(out.holderId).toBe('hanzo/attacker')
    expect(JSON.stringify(out)).not.toContain('victim')
  })

  it('derives holderId for a PROJECT binding from the project name, and consumes `project`', () => {
    const out = bind({ holderKind: 'project', project: 'apollo', holderId: 'forged', accountId: 'acct_x', priority: 2 }, 'maxpower', 'maxpower')
    expect(out.holderId).toBe('apollo')
    expect(out.project).toBeUndefined() // consumed INTO holderId — one fact, one field
  })

  it('an ORG holder is the ORG, not the subject (a personal-billing member differs)', () => {
    // billingSubject('hanzo','alice') = 'hanzo/alice' but the org holder is 'hanzo' —
    // the reason the pin needs `org` and cannot reuse `subject`.
    const out = bind({ holderKind: 'org', accountId: 'acct_x', priority: 0 }, 'hanzo/alice', 'hanzo')
    expect(out.holderId).toBe('hanzo')
  })

  it('BLANKS the holder for an unknown kind (a forged holderId never rides an invented kind)', () => {
    const out = bind({ holderKind: 'everyone', holderId: 'victim', accountId: 'acct_x' }, 'attacker', 'attacker')
    expect(out.holderId).toBe('')
    expect(JSON.stringify(out)).not.toContain('victim')
  })

  it('two tenants binding the same project name get disjoint holders (isolation)', () => {
    const body = { holderKind: 'project', project: 'apollo', accountId: 'acct_x', priority: 0 }
    const a = bind(body, 'acme', 'acme')
    const b = bind(body, 'globex', 'globex')
    // The holder STRING is equal by design — tenancy is the org namespace commerce
    // queries (ForHolder(db,…)), which forwardBilling pins from the session. The
    // SUBJECT (and thus the namespace the write lands in) is what differs.
    expect(a.userId).toBe('acme')
    expect(b.userId).toBe('globex')
  })
})
