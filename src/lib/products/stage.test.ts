import { describe, it, expect } from 'vitest'

import { listed, reachable, stageOf, operator, customer, type Stage, type Viewer } from './stage'
import { destinationsFor, productSubpages, stageAt, subpageSlug } from './match-core'
import type { CatalogEntry, ProductRoute } from './registry'
import { isSuperAdminAccount } from '~/lib/auth/admin'

/**
 * The ONE visibility decision, proved over fixtures.
 *
 * The registry cannot be imported under vitest at all (icon ESM), which is the same
 * reason `match-core` and `brand-scope` are pure — so a fixture proves the
 * PREDICATE here and `deploy/registry.test.ts` proves the DATA (which entry carries
 * which stage) off the source.
 *
 * Four viewers, because the interesting cases are the two in the middle: a person
 * whose org took the opt-in is NOT an operator, and an operator is not someone who
 * opted in.
 */
const anyone: Viewer = customer
const optedIn: Viewer = { admin: false, beta: true }
const admin: Viewer = { admin: true, beta: false }

const C = () => null
const mod = (id: string, stage?: Stage, extra: Record<string, unknown> = {}): CatalogEntry =>
  ({
    id,
    label: id,
    icon: C,
    description: id,
    category: 'AI',
    status: 'enabled',
    kind: 'module',
    routes: [{ path: '', component: C }] as ProductRoute[],
    ...(stage ? { stage } : {}),
    ...extra,
  }) as unknown as CatalogEntry

// One product per stage, plus a GA product carrying an admin-only tab (Models ›
// Routing in the real catalog) — the case that proves the two levels share an axis.
const chat = mod('chat')
const labs = mod('labs', 'beta')
const forge = mod('forge', 'alpha')
const overlord = mod('overlord', 'admin')
const models = mod('models', undefined, {
  subpages: [
    { slug: 'blend', label: 'Blend' },
    { slug: 'routing', label: 'Routing', stage: 'admin' },
    { slug: 'tuner', label: 'Tuner', stage: 'beta' },
  ],
  routes: [
    { path: '', component: C },
    { path: ':tab', component: C },
  ],
})

const CATALOG: CatalogEntry[] = [chat, labs, forge, overlord, models]

/** The catalog a viewer browses — what `visibleCatalog` composes over brand+entitlement. */
const listing = (v: Viewer): string[] => CATALOG.filter((e) => listed(stageOf(e), v)).map((e) => e.id)

describe('stageOf — unset is ga', () => {
  it('reads a declared stage and defaults the rest to ga', () => {
    expect(stageOf(chat)).toBe('ga')
    expect(stageOf(labs)).toBe('beta')
    expect(stageOf(forge)).toBe('alpha')
    expect(stageOf(overlord)).toBe('admin')
  })
})

describe('a GA product shows for everyone', () => {
  it('is listed for a new account, an opted-in org, and an operator alike', () => {
    for (const v of [anyone, optedIn, admin]) expect(listing(v)).toContain('chat')
  })
  it('resolves at its own address for all three', () => {
    for (const v of [anyone, optedIn, admin]) expect(reachable(stageAt(CATALOG, ['chat']), v)).toBe(true)
  })
})

describe('a beta product hides until the org opts in, then shows', () => {
  it('is absent out of the box', () => {
    expect(listing(anyone)).not.toContain('labs')
  })
  it('appears once the org opted in — the only thing that changed is the viewer', () => {
    expect(listing(optedIn)).toContain('labs')
  })
  it('resolves by URL either way — hiding is a nav decision, not a 404', () => {
    expect(reachable(stageAt(CATALOG, ['labs']), anyone)).toBe(true)
    expect(reachable(stageAt(CATALOG, ['labs']), optedIn)).toBe(true)
  })
})

describe('an alpha product stays hidden but its URL resolves', () => {
  it('is listed for nobody but the operator — not even for an org that took beta', () => {
    expect(listing(anyone)).not.toContain('forge')
    expect(listing(optedIn)).not.toContain('forge')
    expect(listing(admin)).toContain('forge')
  })
  it('renders for anyone who knows the address', () => {
    expect(reachable(stageAt(CATALOG, ['forge']), anyone)).toBe(true)
  })
})

describe('an admin product is invisible AND unreachable for a non-admin', () => {
  it('is listed for no customer, however they are configured', () => {
    expect(listing(anyone)).not.toContain('overlord')
    expect(listing(optedIn)).not.toContain('overlord')
  })
  it('does not resolve for them either — the one stage the router withholds', () => {
    expect(reachable(stageAt(CATALOG, ['overlord']), anyone)).toBe(false)
    expect(reachable(stageAt(CATALOG, ['overlord']), optedIn)).toBe(false)
  })
  it('is listed and reachable for the reserved admin org', () => {
    expect(listing(admin)).toContain('overlord')
    expect(reachable(stageAt(CATALOG, ['overlord']), admin)).toBe(true)
  })
  it('cannot be reached by opting in — admin is membership, never a toggle', () => {
    // The escape hatch a customer CAN flip is `beta`. Turning it on moves beta and
    // nothing else; there is no viewer a customer can construct that admits admin.
    expect(listed('admin', { admin: false, beta: true })).toBe(false)
    expect(reachable('admin', { admin: false, beta: true })).toBe(false)
  })
})

describe('the viewer is bound to org membership, not to a claim', () => {
  it("admin is `owner === 'admin'` — the equality IAM's own IsSuperAdmin uses", () => {
    expect(isSuperAdminAccount({ owner: 'admin', name: 'z' } as never)).toBe(true)
    expect(isSuperAdminAccount({ owner: 'hanzo', name: 'z' } as never)).toBe(false)
    // An org admin OF THEIR OWN org is a customer here: conflating the two scopes is
    // the privilege escalation the reserved org exists to prevent.
    expect(isSuperAdminAccount({ owner: 'maxpower', name: 'dave', isAdmin: true } as never)).toBe(false)
    expect(isSuperAdminAccount(null)).toBe(false)
  })
})

describe('one axis, both levels — a sub-page carries the same stage', () => {
  it('hides an admin and a beta tab from a new account', () => {
    expect(productSubpages(models, anyone).map((s) => s.slug)).toEqual(
      ['', 'blend', 'settings', 'logs', 'metrics', 'status'],
    )
  })
  it('reveals the beta tab to an opted-in org, still not the admin one', () => {
    const slugs = productSubpages(models, optedIn).map((s) => s.slug)
    expect(slugs).toContain('tuner')
    expect(slugs).not.toContain('routing')
  })
  it('gives the operator both', () => {
    const slugs = productSubpages(models, operator).map((s) => s.slug)
    expect(slugs).toEqual(expect.arrayContaining(['routing', 'tuner']))
  })
  it('will not let a module light a tab the viewer cannot see', () => {
    expect(subpageSlug(models, 'routing', anyone)).toBe('')
    expect(subpageSlug(models, 'routing', operator)).toBe('routing')
  })
  it('reads the deeper stage at an address — the tab is what was asked for', () => {
    expect(stageAt(CATALOG, ['models'])).toBe('ga')
    expect(stageAt(CATALOG, ['models', 'routing'])).toBe('admin')
    expect(stageAt(CATALOG, ['models', 'tuner'])).toBe('beta')
    // So a customer is refused the admin tab of a product they may otherwise open.
    expect(reachable(stageAt(CATALOG, ['models', 'routing']), anyone)).toBe(false)
    expect(reachable(stageAt(CATALOG, ['models']), anyone)).toBe(true)
  })
})

describe('⌘K offers exactly what the nav lists', () => {
  const ids = (v: Viewer) =>
    destinationsFor(CATALOG, v).filter((d) => d.kind === 'product').map((d) => d.entry.id)

  it('cannot jump to a surface the rail hides', () => {
    expect(ids(anyone)).toEqual(['chat', 'models'])
    expect(ids(optedIn)).toEqual(['chat', 'labs', 'models'])
  })
  it('indexes a sub-page under the same rule as its product', () => {
    const subs = (v: Viewer) =>
      destinationsFor(CATALOG, v).filter((d) => d.kind === 'subpage').map((d) => d.subpage.slug)
    expect(subs(anyone)).toEqual(['blend'])
    expect(subs(optedIn)).toEqual(expect.arrayContaining(['blend', 'tuner']))
    expect(subs(optedIn)).not.toContain('routing')
    expect(subs(operator)).toEqual(expect.arrayContaining(['blend', 'routing', 'tuner']))
  })
})

describe('the two named viewers say what they mean', () => {
  it('a customer is a new account: GA only', () => {
    expect(listing(customer)).toEqual(['chat', 'models'])
  })
  it('an operator narrows nothing — the default where a call is not a nav decision', () => {
    expect(listing(operator)).toEqual(CATALOG.map((e) => e.id))
  })
})
