import { describe, it, expect } from 'vitest'

import {
  rows,
  enumLabel,
  usd,
  int,
  pct,
  today,
  normalizeSummary,
  ownershipSlices,
  convertibleCapital,
  validateStakeholder,
  validateShareForm,
  validateShareClassForm,
  validateSafeForm,
  validateRoundForm,
  STAKEHOLDER_TYPES,
  ROUND_TYPES,
  type CapTableSummary,
} from './captable'

describe('rows — tolerates the inconsistent list shapes', () => {
  it('reads a BARE array (stakeholders, share-classes)', () => {
    expect(rows([{ id: '1' }, { id: '2' }])).toHaveLength(2)
  })
  it('reads a {data} envelope (shares, safes, rounds, …)', () => {
    expect(rows({ data: [{ id: '1' }] })).toHaveLength(1)
  })
  it('reads {items}/{rows} too, and honest [] on garbage', () => {
    expect(rows({ items: [{ id: 'a' }] })).toHaveLength(1)
    expect(rows({ rows: [{ id: 'b' }] })).toHaveLength(1)
    expect(rows(null)).toEqual([])
    expect(rows({ nope: 1 })).toEqual([])
    expect(rows('str')).toEqual([])
  })
  it('drops non-object rows', () => {
    expect(rows([{ id: '1' }, 5, null, 'x'])).toHaveLength(1)
  })
})

describe('enumLabel — ENUM_TOKEN → readable', () => {
  it('title-cases + de-underscores', () => {
    expect(enumLabel('POST_MONEY')).toBe('Post money')
    expect(enumLabel('COMMON')).toBe('Common')
    expect(enumLabel('CONVERTS_TO_FUTURE_ROUND')).toBe('Converts to future round')
    expect(enumLabel('')).toBe('—')
  })
})

describe('format helpers (pure)', () => {
  it('int with separators', () => {
    expect(int(1000000)).toBe('1,000,000')
    expect(int(0)).toBe('0')
  })
  it('usd — dollar floats, not cents', () => {
    expect(usd(1000)).toBe('$1,000')
    expect(usd(1234.5)).toBe('$1,234.5')
    expect(usd(NaN)).toBe('$0')
  })
  it('pct fixed to 2dp', () => {
    expect(pct(25)).toBe('25.00%')
    expect(pct(12.345)).toBe('12.35%')
  })
  it('today is an ISO date', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

const summary = (over: Partial<CapTableSummary> = {}): CapTableSummary => ({
  company: { id: 'acme', name: 'Acme' },
  totals: { outstandingShares: 1000, grantedOptions: 200, fullyDilutedShares: 1200, stakeholders: 2, shareClasses: 1 },
  byStakeholder: [
    { stakeholderId: 's1', name: 'Alice', shares: 800, options: 0, fullyDiluted: 800, ownershipPct: 66.67 },
    { stakeholderId: 's2', name: 'Bob', shares: 200, options: 200, fullyDiluted: 400, ownershipPct: 33.33 },
  ],
  byShareClass: [{ shareClassId: 'c1', name: 'Common', classType: 'COMMON', authorized: 10000, issued: 1000 }],
  convertibles: { safes: { count: 1, capital: 100000 }, notes: { count: 0, capital: 0 } },
  rounds: { count: 1, totalRaised: 250000 },
  ...over,
})

describe('normalizeSummary — the computed cap table (server-side math, mirrored)', () => {
  it('reads the real backend shape verbatim', () => {
    const s = normalizeSummary({
      company: { id: 'acme', name: 'Acme' },
      totals: { outstandingShares: 1000, grantedOptions: 200, fullyDilutedShares: 1200, stakeholders: 2, shareClasses: 1 },
      byStakeholder: [{ stakeholderId: 's1', name: 'Alice', shares: 800, options: 0, fullyDiluted: 800, ownershipPct: 66.67 }],
      byShareClass: [{ shareClassId: 'c1', name: 'Common', classType: 'COMMON', authorized: 10000, issued: 1000 }],
      convertibles: { safes: { count: 1, capital: 100000 }, notes: { count: 0, capital: 0 } },
      rounds: { count: 1, totalRaised: 250000 },
    })
    expect(s.totals.fullyDilutedShares).toBe(1200)
    expect(s.byStakeholder[0].ownershipPct).toBe(66.67)
    expect(s.byShareClass[0].issued).toBe(1000)
    expect(s.convertibles.safes.capital).toBe(100000)
    expect(s.rounds.totalRaised).toBe(250000)
  })
  it('degrades a garbage/partial payload to honest zeros, never throws', () => {
    const s = normalizeSummary(null)
    expect(s.totals.fullyDilutedShares).toBe(0)
    expect(s.byStakeholder).toEqual([])
    expect(s.byShareClass).toEqual([])
    expect(s.convertibles.safes.count).toBe(0)
    expect(s.rounds.count).toBe(0)
  })
})

describe('presentation derivation', () => {
  it('ownershipSlices: fully-diluted holders, largest first, zero-holders dropped', () => {
    const s = summary({
      byStakeholder: [
        { stakeholderId: 's2', name: 'Bob', shares: 200, options: 200, fullyDiluted: 400, ownershipPct: 33.33 },
        { stakeholderId: 's1', name: 'Alice', shares: 800, options: 0, fullyDiluted: 800, ownershipPct: 66.67 },
        { stakeholderId: 's3', name: 'Empty', shares: 0, options: 0, fullyDiluted: 0, ownershipPct: 0 },
      ],
    })
    expect(ownershipSlices(s)).toEqual([
      { label: 'Alice', value: 800 },
      { label: 'Bob', value: 400 },
    ])
  })
  it('convertibleCapital = SAFEs + notes', () => {
    expect(convertibleCapital(summary())).toBe(100000)
    expect(convertibleCapital(summary({ convertibles: { safes: { count: 1, capital: 100000 }, notes: { count: 2, capital: 50000 } } }))).toBe(150000)
  })
})

describe('form validators mirror the bundle write boundary', () => {
  it('stakeholder: name, valid email, known type + relationship', () => {
    expect(validateStakeholder({ name: '', email: 'a@x.com', stakeholderType: 'INDIVIDUAL', currentRelationship: 'FOUNDER' })).toMatch(/name/i)
    expect(validateStakeholder({ name: 'A', email: 'bad', stakeholderType: 'INDIVIDUAL', currentRelationship: 'FOUNDER' })).toMatch(/email/i)
    expect(validateStakeholder({ name: 'A', email: 'a@x.com', stakeholderType: 'NOPE', currentRelationship: 'FOUNDER' })).toMatch(/type/i)
    expect(validateStakeholder({ name: 'A', email: 'a@x.com', stakeholderType: 'INDIVIDUAL', currentRelationship: 'NOPE' })).toMatch(/relationship/i)
    expect(validateStakeholder({ name: 'A', email: 'a@x.com', stakeholderType: 'INDIVIDUAL', currentRelationship: 'FOUNDER' })).toBeNull()
    expect(STAKEHOLDER_TYPES).toContain('INDIVIDUAL')
  })
  it('shares: stakeholder + class refs, unique cert, whole positive quantity', () => {
    const ok = { stakeholderId: 's1', shareClassId: 'c1', certificateId: 'CS-1', quantity: 1000, status: 'ACTIVE' }
    expect(validateShareForm({ ...ok, stakeholderId: '' })).toMatch(/stakeholder/i)
    expect(validateShareForm({ ...ok, shareClassId: '' })).toMatch(/share class/i)
    expect(validateShareForm({ ...ok, certificateId: ' ' })).toMatch(/certificate/i)
    expect(validateShareForm({ ...ok, quantity: 0 })).toMatch(/greater than 0/i)
    expect(validateShareForm({ ...ok, quantity: 1.5 })).toMatch(/whole number/i)
    expect(validateShareForm(ok)).toBeNull()
  })
  it('share class: name, known type, authorized ≥ 1', () => {
    const ok = { name: 'Common', classType: 'COMMON', initialSharesAuthorized: 10000, pricePerShare: 0.0001, parValue: 0.0001, votesPerShare: 1 }
    expect(validateShareClassForm({ ...ok, name: '' })).toMatch(/name/i)
    expect(validateShareClassForm({ ...ok, classType: 'NOPE' })).toMatch(/type/i)
    expect(validateShareClassForm({ ...ok, initialSharesAuthorized: 0 })).toMatch(/at least 1/i)
    expect(validateShareClassForm(ok)).toBeNull()
  })
  it('SAFE: id, stakeholder, positive capital', () => {
    const ok = { publicId: 'SAFE-1', stakeholderId: 's1', capital: 100000, type: 'POST_MONEY', status: 'ACTIVE' }
    expect(validateSafeForm({ ...ok, publicId: ' ' })).toMatch(/SAFE id/i)
    expect(validateSafeForm({ ...ok, stakeholderId: '' })).toMatch(/stakeholder/i)
    expect(validateSafeForm({ ...ok, capital: 0 })).toMatch(/greater than 0/i)
    expect(validateSafeForm(ok)).toBeNull()
  })
  it('round: name, known type; a PRICED round needs a class + price', () => {
    expect(validateRoundForm({ name: '', roundType: 'PRICED', targetAmount: 1000 })).toMatch(/name/i)
    expect(validateRoundForm({ name: 'Seed', roundType: 'NOPE', targetAmount: 1000 })).toMatch(/type/i)
    expect(validateRoundForm({ name: 'Seed', roundType: 'PRICED', targetAmount: 1000 })).toMatch(/share class/i)
    expect(validateRoundForm({ name: 'Seed', roundType: 'PRICED', targetAmount: 1000, shareClassId: 'c1', pricePerShare: 0 })).toMatch(/price per share/i)
    expect(validateRoundForm({ name: 'Seed', roundType: 'PRICED', targetAmount: 1000, shareClassId: 'c1', pricePerShare: 1.25 })).toBeNull()
    // a non-priced round (SAFE/CONVERTIBLE) needs no class/price
    expect(validateRoundForm({ name: 'Angel', roundType: 'SAFE', targetAmount: 500000 })).toBeNull()
    expect(ROUND_TYPES).toContain('PRICED')
  })
})
