import { describe, it, expect } from 'vitest'

import {
  PAGE_SIZE,
  orgTitle,
  initialsOf,
  roleFor,
  factsFor,
  cardFor,
  sortOrgs,
  paginate,
  pickerView,
  type PickerContext,
} from './logic'
import type { Organization } from '~/lib/api'

const org = (name: string, extra: Partial<Organization> = {}): Organization => ({
  owner: 'admin',
  name,
  ...extra,
})

const ctx = (over: Partial<PickerContext> = {}): PickerContext => ({
  ownOrg: 'hanzo',
  isSuperAdmin: false,
  callerIsAdmin: false,
  ...over,
})

describe('orgTitle', () => {
  it('prefers displayName', () => {
    expect(orgTitle(org('ad-nexus', { displayName: 'Ad Nexus' }))).toBe('Ad Nexus')
  })
  it('title-cases the slug when no displayName', () => {
    expect(orgTitle(org('ad-nexus'))).toBe('Ad Nexus')
    expect(orgTitle(org('maxpower'))).toBe('Maxpower')
  })
})

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf(org('x', { displayName: 'Ad Nexus' }))).toBe('AN')
  })
  it('takes the first two letters of a single word', () => {
    expect(initialsOf(org('hanzo'))).toBe('HA')
  })
  it('splits a hyphenated slug into words', () => {
    expect(initialsOf(org('ad-nexus'))).toBe('AN')
  })
  it('falls back to ? for an empty label', () => {
    expect(initialsOf(org(''))).toBe('?')
  })
})

describe('roleFor — honest, never fabricated', () => {
  it('global admin viewing another org → Super admin', () => {
    expect(roleFor(org('adnexus'), ctx({ isSuperAdmin: true }))).toBe('Super admin')
  })
  it('own org, caller is admin → Admin', () => {
    expect(roleFor(org('hanzo'), ctx({ callerIsAdmin: true }))).toBe('Admin')
  })
  it('own org, not admin → Member', () => {
    expect(roleFor(org('hanzo'), ctx())).toBe('Member')
  })
  it('global admin viewing their OWN org → Admin', () => {
    expect(roleFor(org('hanzo'), ctx({ isSuperAdmin: true, callerIsAdmin: true }))).toBe('Admin')
  })
})

describe('factsFor — only present fields become facts', () => {
  it('is empty when the org carries no facts', () => {
    expect(factsFor(org('hanzo'))).toEqual([])
  })
  it('derives a Created fact (date only) from createdTime', () => {
    expect(factsFor(org('hanzo', { createdTime: '2024-06-01T12:00:00Z' }))).toEqual([
      { label: 'Created', value: '2024-06-01' },
    ])
  })
  it('ignores an unparseable timestamp', () => {
    expect(factsFor(org('hanzo', { createdTime: 'not-a-date' }))).toEqual([])
  })
  it('adds a Website fact stripped of its scheme', () => {
    expect(factsFor(org('hanzo', { websiteUrl: 'https://hanzo.ai' }))).toEqual([
      { label: 'Website', value: 'hanzo.ai' },
    ])
  })
})

describe('cardFor — the full view-model', () => {
  it('assembles key/title/initials/logo/role/facts', () => {
    const card = cardFor(
      org('adnexus', { displayName: 'Ad Nexus', logo: 'https://cdn/ad.png', createdTime: '2023-01-02T00:00:00Z' }),
      ctx({ isSuperAdmin: true }),
    )
    expect(card).toEqual({
      key: 'admin/adnexus',
      name: 'adnexus',
      title: 'Ad Nexus',
      initials: 'AN',
      logo: 'https://cdn/ad.png',
      role: 'Super admin',
      facts: [{ label: 'Created', value: '2023-01-02' }],
    })
  })
  it('logo defaults to empty string when absent', () => {
    expect(cardFor(org('hanzo'), ctx()).logo).toBe('')
  })
})

describe('sortOrgs — alphabetical by label, non-mutating', () => {
  it('sorts case-insensitively by display label', () => {
    const input = [org('z', { displayName: 'zed' }), org('a', { displayName: 'Alpha' }), org('m', { displayName: 'mid' })]
    expect(sortOrgs(input).map((o) => o.name)).toEqual(['a', 'm', 'z'])
  })
  it('does not mutate the input array', () => {
    const input = [org('b'), org('a')]
    sortOrgs(input)
    expect(input.map((o) => o.name)).toEqual(['b', 'a'])
  })
})

describe('paginate — client slice with honest remainder', () => {
  const many = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => i)
  it('shows one page and reports the remainder', () => {
    const p = paginate(many, 1)
    expect(p.visible).toHaveLength(PAGE_SIZE)
    expect(p.hasMore).toBe(true)
    expect(p.remaining).toBe(5)
  })
  it('page 2 shows everything', () => {
    const p = paginate(many, 2)
    expect(p.visible).toHaveLength(PAGE_SIZE + 5)
    expect(p.hasMore).toBe(false)
    expect(p.remaining).toBe(0)
  })
  it('no more when the list fits one page', () => {
    const p = paginate([1, 2, 3], 1)
    expect(p.hasMore).toBe(false)
    expect(p.remaining).toBe(0)
  })
})

describe('pickerView — filter → sort → paginate → cards', () => {
  const orgs = [
    org('zoo', { displayName: 'Zoo' }),
    org('adnexus', { displayName: 'Ad Nexus' }),
    org('hanzo', { displayName: 'Hanzo' }),
    org('lux', { displayName: 'Lux Network' }),
  ]

  it('sorts alphabetically and returns card view-models', () => {
    const v = pickerView(orgs, '', 1, ctx({ isSuperAdmin: true }))
    expect(v.cards.map((c) => c.title)).toEqual(['Ad Nexus', 'Hanzo', 'Lux Network', 'Zoo'])
    expect(v.total).toBe(4)
    expect(v.shown).toBe(4)
    expect(v.hasMore).toBe(false)
  })

  it('filters by a literal substring (case-insensitive)', () => {
    const v = pickerView(orgs, 'network', 1, ctx({ isSuperAdmin: true }))
    expect(v.cards.map((c) => c.name)).toEqual(['lux'])
    expect(v.total).toBe(1)
  })

  it('treats the query as a literal, not a wildcard', () => {
    // A '.' must not match everything — it is a plain substring, not a regex.
    const v = pickerView(orgs, '.', 1, ctx())
    expect(v.total).toBe(0)
    expect(v.cards).toEqual([])
  })

  it('paginates a long list and grows with the page', () => {
    const big = Array.from({ length: PAGE_SIZE + 3 }, (_, i) =>
      org(`org${String(i).padStart(3, '0')}`, { displayName: `Org ${String(i).padStart(3, '0')}` }),
    )
    const p1 = pickerView(big, '', 1, ctx({ isSuperAdmin: true }))
    expect(p1.shown).toBe(PAGE_SIZE)
    expect(p1.hasMore).toBe(true)
    expect(p1.remaining).toBe(3)
    const p2 = pickerView(big, '', 2, ctx({ isSuperAdmin: true }))
    expect(p2.shown).toBe(PAGE_SIZE + 3)
    expect(p2.hasMore).toBe(false)
  })
})

// ONE PERSON, MANY ORGS — and each card states the role it was actually granted.
//
// roleFor's last branch used to carry a comment calling itself unreachable
// ("a non-global-admin only ever sees their own org"). The picker now lists
// memberships, so that branch runs for every joined org — and it answered
// "Member" for all of them, including one the person administers. Measured
// live: dave, admin of maxpower, read "Member" on the maxpower card.
describe('roleFor — the membership is the truth once you can see more than one org', () => {
  const org = (name: string) => ({ owner: 'admin', name }) as Organization
  const base = { ownOrg: 'hanzo', isSuperAdmin: false, callerIsAdmin: false }

  it('states the granted role for a joined org, not a guess', () => {
    expect(roleFor(org('maxpower'), { ...base, roles: { maxpower: 'admin' } })).toBe('Admin')
    expect(roleFor(org('acme'), { ...base, roles: { acme: 'owner' } })).toBe('Owner')
    expect(roleFor(org('other'), { ...base, roles: { other: 'member' } })).toBe('Member')
  })

  it('prefers the membership over the own-org inference', () => {
    // Their home org, where the account flag says plain member but the
    // membership says admin — the membership is the grant.
    expect(roleFor(org('hanzo'), { ...base, roles: { hanzo: 'admin' } })).toBe('Admin')
  })

  it('falls back to the own-org inference when no membership row exists', () => {
    expect(roleFor(org('hanzo'), base)).toBe('Member')
    expect(roleFor(org('hanzo'), { ...base, callerIsAdmin: true })).toBe('Admin')
  })

  it('still calls a super admin viewing another tenant what they are', () => {
    expect(roleFor(org('maxpower'), { ...base, isSuperAdmin: true })).toBe('Super admin')
  })
})
