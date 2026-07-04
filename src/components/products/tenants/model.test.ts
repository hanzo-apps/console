import { describe, it, expect } from 'vitest'

import {
  parseMetadata,
  composeTenant,
  composeTenants,
  deriveResellerParents,
  buildResellerTree,
  flattenTree,
  treeIsInferred,
  filterTenants,
  type Tenant,
  type TenantOrgInput,
  type TenantCustomerInput,
  type TenantClusterInput,
} from './model'

const org = (name: string, extra: Partial<TenantOrgInput> = {}): TenantOrgInput => ({ name, ...extra })
const cust = (o: string, extra: Partial<TenantCustomerInput> = {}): TenantCustomerInput => ({ org: o, ...extra })

describe('parseMetadata', () => {
  it('parses a JSON string', () => {
    expect(parseMetadata('{"parentOrg":"acme"}')).toEqual({ parentOrg: 'acme' })
  })
  it('passes an object through', () => {
    expect(parseMetadata({ parentOrg: 'acme' })).toEqual({ parentOrg: 'acme' })
  })
  it('returns {} for garbage / empty (never throws)', () => {
    expect(parseMetadata('not json')).toEqual({})
    expect(parseMetadata(undefined)).toEqual({})
    expect(parseMetadata('')).toEqual({})
  })
})

describe('composeTenant', () => {
  it('composes brand from IAM, billing from cockpit, cluster from platform', () => {
    const t = composeTenant(
      org('acme', { displayName: 'Acme Inc', logo: 'https://x/logo.png' }),
      cust('acme', { plan: 'growth', status: 'active', users: 4, balanceCents: 5000, ownerEmail: 'z@acme.com' }),
      { org: 'acme', name: 'acme-k8s', phase: 'ready' },
    )
    expect(t.display).toBe('Acme Inc')
    expect(t.logo).toBe('https://x/logo.png')
    expect(t.plan).toBe('growth')
    expect(t.status).toBe('active')
    expect(t.users).toBe(4)
    expect(t.balanceCents).toBe(5000)
    expect(t.cluster).toBe('acme-k8s')
    expect(t.clusterStatus).toBe('ready')
    expect(t.isCustomer).toBe(true)
  })

  it('an IAM-only org (no cockpit) lists with honest empty billing', () => {
    const t = composeTenant(org('brandonly'), undefined, undefined)
    expect(t.display).toBe('brandonly')
    expect(t.plan).toBeUndefined()
    expect(t.status).toBe('unknown')
    expect(t.balanceCents).toBeUndefined()
    expect(t.cluster).toBeUndefined()
    expect(t.isCustomer).toBe(false)
  })

  it('reads an explicit metadata parentOrg (the real follow-up column)', () => {
    const t = composeTenant(org('sub', { metadata: '{"parentOrg":"reseller"}' }), undefined, undefined)
    expect(t.parentOrg).toBe('reseller')
    expect(t.parentHint).toBe('metadata')
  })

  it('never fabricates a number from a non-number', () => {
    const t = composeTenant(org('x'), cust('x', { users: NaN as unknown as number }), undefined)
    expect(t.users).toBeUndefined()
  })
})

describe('composeTenants join', () => {
  it('joins orgs to cockpit + clusters by org name, first cluster wins', () => {
    const orgs = [org('a', { displayName: 'A' }), org('b')]
    const customers = [cust('a', { plan: 'starter' })]
    const clusters: TenantClusterInput[] = [
      { org: 'a', name: 'a-1' },
      { org: 'a', name: 'a-2' },
    ]
    const ts = composeTenants(orgs, customers, clusters)
    expect(ts).toHaveLength(2)
    expect(ts[0].plan).toBe('starter')
    expect(ts[0].cluster).toBe('a-1') // first cluster
    expect(ts[1].isCustomer).toBe(false) // b has no cockpit row
  })
})

describe('deriveResellerParents (owner-email inference)', () => {
  it('derives a parent when one owner owns multiple orgs', () => {
    const base = composeTenants(
      [org('parentco'), org('childco')],
      [cust('parentco', { ownerEmail: 'boss@x.com' }), cust('childco', { ownerEmail: 'boss@x.com' })],
      [],
    )
    const derived = deriveResellerParents(base)
    const child = derived.find((t) => t.org === 'childco')!
    const parent = derived.find((t) => t.org === 'parentco')!
    // The alphabetically-first org (childco) is the home; parentco becomes its child.
    // (Deterministic: home = sorted[0] = 'childco'.)
    expect([child.parentOrg, parent.parentOrg].filter(Boolean)).toHaveLength(1)
    const withParent = derived.find((t) => t.parentOrg)!
    expect(withParent.parentHint).toBe('owner')
  })

  it('does NOT infer a parent for a single-org owner (no fabrication)', () => {
    const base = composeTenants([org('solo')], [cust('solo', { ownerEmail: 'a@b.com' })], [])
    const derived = deriveResellerParents(base)
    expect(derived[0].parentOrg).toBeUndefined()
  })

  it('metadata parent is never overridden by owner inference', () => {
    const base = composeTenants(
      [org('a', { metadata: '{"parentOrg":"real"}' }), org('b')],
      [cust('a', { ownerEmail: 'x@y.com' }), cust('b', { ownerEmail: 'x@y.com' })],
      [],
    )
    const derived = deriveResellerParents(base)
    expect(derived.find((t) => t.org === 'a')!.parentOrg).toBe('real')
    expect(derived.find((t) => t.org === 'a')!.parentHint).toBe('metadata')
  })
})

describe('buildResellerTree', () => {
  const mk = (o: string, parent?: string): Tenant => ({
    org: o,
    display: o,
    status: 'active',
    isCustomer: true,
    parentOrg: parent,
    parentHint: parent ? 'metadata' : undefined,
  })

  it('nests children under their parent', () => {
    const tree = buildResellerTree([mk('reseller'), mk('sub1', 'reseller'), mk('sub2', 'reseller'), mk('indie')])
    const reseller = tree.find((n) => n.tenant.org === 'reseller')!
    expect(reseller.children.map((c) => c.tenant.org).sort()).toEqual(['sub1', 'sub2'])
    // A parent that isn't in the list → the child is a root, not lost.
    expect(tree.some((n) => n.tenant.org === 'indie')).toBe(true)
  })

  it('a child whose parent is absent becomes a root (never dropped)', () => {
    const tree = buildResellerTree([mk('orphan', 'ghost')])
    expect(tree).toHaveLength(1)
    expect(tree[0].tenant.org).toBe('orphan')
  })

  it('is cycle-safe (a→b, b→a does not infinite-loop)', () => {
    const tree = buildResellerTree([mk('a', 'b'), mk('b', 'a')])
    // One attaches under the other; the second falls back to a root. No throw/hang.
    const flat = flattenTree(tree)
    expect(flat).toHaveLength(2)
  })

  it('resellers (with children) sort before leaf tenants', () => {
    const tree = buildResellerTree([mk('zzz-reseller'), mk('sub', 'zzz-reseller'), mk('aaa-leaf')])
    expect(tree[0].tenant.org).toBe('zzz-reseller') // has children → first
  })
})

describe('flattenTree', () => {
  it('produces depth-annotated rows in tree order', () => {
    const tree = buildResellerTree([
      { org: 'r', display: 'r', status: 'active', isCustomer: true },
      { org: 's', display: 's', status: 'active', isCustomer: true, parentOrg: 'r', parentHint: 'metadata' },
    ])
    const flat = flattenTree(tree)
    expect(flat.map((f) => [f.tenant.org, f.depth])).toEqual([
      ['r', 0],
      ['s', 1],
    ])
  })
})

describe('treeIsInferred + filterTenants', () => {
  it('flags an inferred tree (owner-derived parent)', () => {
    expect(treeIsInferred([{ org: 'a', display: 'a', status: 'active', isCustomer: true, parentHint: 'owner' }])).toBe(true)
    expect(treeIsInferred([{ org: 'a', display: 'a', status: 'active', isCustomer: true, parentHint: 'metadata' }])).toBe(false)
  })

  it('filters by org and display, case-insensitive', () => {
    const ts: Tenant[] = [
      { org: 'acme', display: 'Acme Inc', status: 'active', isCustomer: true },
      { org: 'globex', display: 'Globex', status: 'active', isCustomer: true },
    ]
    expect(filterTenants(ts, 'ACME').map((t) => t.org)).toEqual(['acme'])
    expect(filterTenants(ts, 'inc').map((t) => t.org)).toEqual(['acme'])
    expect(filterTenants(ts, '')).toHaveLength(2)
  })
})
