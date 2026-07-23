import { describe, it, expect } from 'vitest'

import {
  WIZARD_STEPS,
  STRUCTURE_OPTIONS,
  JURISDICTION_OPTIONS,
  structureLabel,
  jurisdictionLabel,
  stepIndex,
  stepDone,
  currentStep,
  stepStatus,
  nextHappyStage,
  isStubStep,
  foundersEquityBps,
  equityPct,
  kycVerifiedCount,
  allKycVerified,
  validateFounders,
  validateStructure,
  filingStatusLabel,
  genesisStatusLabel,
  normalizeFounder,
  normalizeFormation,
  normalizeView,
  normalizeKycSessions,
  KYC_VERIFIED,
  KYC_PENDING,
  type Formation,
  type Founder,
} from './company'

// A minimal formation at a given stage, with overrides.
const form = (over: Partial<Formation> = {}): Formation => ({
  org: 'acme',
  structure: 'c-corp',
  jurisdiction: 'DE',
  name: 'Acme, Inc.',
  stage: 'structure',
  founders: [],
  paid: false,
  documentIds: [],
  signed: false,
  alreadyIncorporated: false,
  imported: false,
  importedDocs: [],
  capTableImported: false,
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

const founder = (over: Partial<Founder> = {}): Founder => ({
  name: 'Alice',
  email: 'alice@acme.com',
  equityBps: 5000,
  kycStatus: KYC_PENDING,
  ...over,
})

describe('wizard shape', () => {
  it('is the 8-step happy path in order', () => {
    expect(WIZARD_STEPS.map((s) => s.key)).toEqual([
      'structure', 'founders', 'kyc', 'payment', 'documents', 'esign', 'genesis', 'company',
    ])
  })
  it('maps kyc onto the founders stage (an action within it, not its own stage)', () => {
    expect(WIZARD_STEPS.find((s) => s.key === 'kyc')?.stage).toBe('founders')
    expect(WIZARD_STEPS.find((s) => s.key === 'founders')?.stage).toBe('founders')
  })
  it('marks ONLY kyc + esign as stub-backed (honest pending)', () => {
    expect(isStubStep('kyc')).toBe(true)
    expect(isStubStep('esign')).toBe(true)
    for (const k of ['structure', 'founders', 'payment', 'documents', 'genesis', 'company'] as const)
      expect(isStubStep(k)).toBe(false)
  })
  it('stepIndex is the wizard order', () => {
    expect(stepIndex('structure')).toBe(0)
    expect(stepIndex('company')).toBe(7)
  })
})

describe('stepDone — derived purely from the formation data', () => {
  it('structure done only when entity+jurisdiction+name are all set', () => {
    expect(stepDone('structure', form())).toBe(true)
    expect(stepDone('structure', form({ name: '  ' }))).toBe(false)
    expect(stepDone('structure', form({ structure: '' }))).toBe(false)
    expect(stepDone('structure', form({ jurisdiction: '' }))).toBe(false)
  })
  it('founders done when ≥1 founder', () => {
    expect(stepDone('founders', form({ founders: [] }))).toBe(false)
    expect(stepDone('founders', form({ founders: [founder()] }))).toBe(true)
  })
  it('kyc done ONLY when every founder is backend-verified (never client-assumed)', () => {
    expect(stepDone('kyc', form({ founders: [founder({ kycStatus: KYC_PENDING })] }))).toBe(false)
    expect(stepDone('kyc', form({ founders: [founder({ kycStatus: KYC_VERIFIED }), founder({ email: 'b@x.com', kycStatus: KYC_PENDING })] }))).toBe(false)
    expect(stepDone('kyc', form({ founders: [founder({ kycStatus: KYC_VERIFIED })] }))).toBe(true)
  })
  it('payment/documents/esign/genesis/company each read their own backend fact', () => {
    expect(stepDone('payment', form({ paid: true }))).toBe(true)
    expect(stepDone('payment', form({ paid: false }))).toBe(false)
    expect(stepDone('documents', form({ documentIds: ['d1'] }))).toBe(true)
    expect(stepDone('documents', form({ documentIds: [] }))).toBe(false)
    expect(stepDone('esign', form({ signed: true }))).toBe(true)
    expect(stepDone('genesis', form({ genesis: { root: '0xabc', at: 1, status: 'pending' } }))).toBe(true)
    expect(stepDone('genesis', form({ genesis: { root: '', at: 0, status: 'pending' } }))).toBe(false)
    expect(stepDone('company', form({ stage: 'company' }))).toBe(true)
    expect(stepDone('company', form({ stage: 'genesis' }))).toBe(false)
  })
})

describe('currentStep + stepStatus', () => {
  it('current = first not-done step in wizard order', () => {
    expect(currentStep(form({ structure: '' }))).toBe('structure')
    expect(currentStep(form({ founders: [] }))).toBe('founders')
    expect(currentStep(form({ founders: [founder({ kycStatus: KYC_PENDING })] }))).toBe('kyc')
    expect(currentStep(form({ founders: [founder({ kycStatus: KYC_VERIFIED })], paid: false }))).toBe('payment')
  })
  it('all done → company', () => {
    const done = form({ founders: [founder({ kycStatus: KYC_VERIFIED })], paid: true, documentIds: ['d'], signed: true, genesis: { root: '0x1', at: 1, status: 'anchored' }, stage: 'company' })
    expect(currentStep(done)).toBe('company')
  })
  it('status is done/current/upcoming', () => {
    const f = form({ founders: [founder({ kycStatus: KYC_PENDING })] }) // current step = kyc
    expect(stepStatus('structure', f)).toBe('done')
    expect(stepStatus('founders', f)).toBe('done')
    expect(stepStatus('kyc', f)).toBe('current')
    expect(stepStatus('payment', f)).toBe('upcoming')
  })
})

describe('nextHappyStage', () => {
  it('walks the machine happy path and stops at the terminal', () => {
    expect(nextHappyStage('structure')).toBe('founders')
    expect(nextHappyStage('founders')).toBe('payment')
    expect(nextHappyStage('genesis')).toBe('company')
    expect(nextHappyStage('company')).toBeNull()
    expect(nextHappyStage('import')).toBeNull()
  })
})

describe('equity + kyc math', () => {
  it('sums founder equity in bps', () => {
    expect(foundersEquityBps([founder({ equityBps: 6000 }), founder({ equityBps: 4000 })])).toBe(10000)
    expect(foundersEquityBps([])).toBe(0)
  })
  it('bps → percent', () => {
    expect(equityPct(2500)).toBe(25)
    expect(equityPct(1234)).toBe(12.34)
  })
  it('counts verified founders + the all-verified gate', () => {
    const fs = [founder({ kycStatus: KYC_VERIFIED }), founder({ email: 'b@x.com', kycStatus: KYC_PENDING })]
    expect(kycVerifiedCount(form({ founders: fs }))).toBe(1)
    expect(allKycVerified(form({ founders: fs }))).toBe(false)
    expect(allKycVerified(form({ founders: [] }))).toBe(false)
    expect(allKycVerified(form({ founders: [founder({ kycStatus: KYC_VERIFIED })] }))).toBe(true)
  })
})

describe('validators mirror the backend write boundary', () => {
  it('validateFounders: name+email required, equity 0..100%, valid email', () => {
    expect(validateFounders([])).toMatch(/at least one/i)
    expect(validateFounders([founder({ name: '' })])).toMatch(/name and an email/i)
    expect(validateFounders([founder({ email: 'nope' })])).toMatch(/valid email/i)
    expect(validateFounders([founder({ equityBps: 20000 })])).toMatch(/between 0 and 100/i)
    expect(validateFounders([founder()])).toBeNull()
  })
  it('validateStructure: entity + jurisdiction + name', () => {
    expect(validateStructure({ structure: '', jurisdiction: 'DE', name: 'X' })).toMatch(/entity/i)
    expect(validateStructure({ structure: 'llc', jurisdiction: '', name: 'X' })).toMatch(/jurisdiction/i)
    expect(validateStructure({ structure: 'llc', jurisdiction: 'WY', name: ' ' })).toMatch(/name/i)
    expect(validateStructure({ structure: 'llc', jurisdiction: 'WY', name: 'X' })).toBeNull()
  })
})

describe('honest labels (never claim a stub provider finished)', () => {
  it('filing degrades to pending manual review', () => {
    expect(filingStatusLabel(undefined)).toMatch(/not filed/i)
    expect(filingStatusLabel({ provider: 'stub', status: 'manual' })).toMatch(/pending.*manual/i)
    expect(filingStatusLabel({ provider: 'x', status: 'filed' })).toBe('Filed')
  })
  it('genesis anchor is honest until wired', () => {
    expect(genesisStatusLabel(undefined)).toMatch(/not recorded/i)
    expect(genesisStatusLabel({ root: '0x1', at: 1, status: 'pending' })).toMatch(/anchor pending/i)
    expect(genesisStatusLabel({ root: '0x1', at: 1, status: 'anchored' })).toMatch(/anchored/i)
  })
  it('vocabularies carry human labels', () => {
    expect(STRUCTURE_OPTIONS.map((o) => o.value)).toEqual(['c-corp', 'llc', 'dao-llc'])
    expect(JURISDICTION_OPTIONS.map((o) => o.value)).toEqual(['DE', 'WY'])
    expect(structureLabel('c-corp')).toBe('C-Corporation')
    expect(jurisdictionLabel('DE')).toBe('Delaware')
    expect(structureLabel('')).toBe('—')
  })
})

describe('normalizers (snake_case tolerant, honest defaults, never throw)', () => {
  it('normalizeFounder reads camelCase AND snake_case', () => {
    expect(normalizeFounder({ name: 'A', email: 'a@x.com', equityBps: 5000, kycStatus: 'verified' })).toEqual({
      name: 'A', email: 'a@x.com', equityBps: 5000, kycStatus: 'verified', kycRef: undefined,
    })
    expect(normalizeFounder({ name: 'B', email: 'b@x.com', equity_bps: 3000, kyc_status: 'failed', kyc_ref: 'r1' })).toEqual({
      name: 'B', email: 'b@x.com', equityBps: 3000, kycStatus: 'failed', kycRef: 'r1',
    })
  })
  it('normalizeFounder defaults a missing kyc status to pending (never verified)', () => {
    expect(normalizeFounder({ name: 'C', email: 'c@x.com' }).kycStatus).toBe(KYC_PENDING)
  })
  it('normalizeFormation degrades a partial/garbage payload to a real value', () => {
    const f = normalizeFormation({ org: 'acme', stage: 'payment', paid: true, founders: [{ name: 'A', email: 'a@x.com', equityBps: 10000, kycStatus: 'verified' }] })
    expect(f.stage).toBe('payment')
    expect(f.paid).toBe(true)
    expect(f.founders).toHaveLength(1)
    // garbage → honest defaults, no throw
    const g = normalizeFormation(null)
    expect(g.stage).toBe('structure')
    expect(g.founders).toEqual([])
    expect(g.documentIds).toEqual([])
  })
  it('normalizeView unwraps {formation, nextStages} and filters unknown stages', () => {
    const v = normalizeView({ formation: { org: 'a', stage: 'founders' }, nextStages: ['payment', 'bogus'] })
    expect(v.formation.stage).toBe('founders')
    expect(v.nextStages).toEqual(['payment'])
  })
  it('normalizeView tolerates a bare formation object (no envelope)', () => {
    const v = normalizeView({ org: 'a', stage: 'genesis' })
    expect(v.formation.stage).toBe('genesis')
    expect(v.nextStages).toEqual([])
  })
  it('normalizeKycSessions reads the sessions array + verifyUrl variants', () => {
    expect(normalizeKycSessions({ sessions: [{ email: 'a@x.com', ref: 'r', verify_url: 'https://v', status: 'pending' }] })).toEqual([
      { email: 'a@x.com', ref: 'r', verifyUrl: 'https://v', status: 'pending' },
    ])
    expect(normalizeKycSessions({})).toEqual([])
  })
})
