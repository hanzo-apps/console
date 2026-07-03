import { describe, it, expect } from 'vitest'
import type { Company, Contact, Opportunity } from '~/lib/api/crm'
import {
  COMPANY_FIELDS,
  OPPORTUNITY_FIELDS,
  STAGE_OPTIONS,
  companyRecord,
  contactRecord,
  opportunityRecord,
  companyOptions,
  companyNameLookup,
} from './collections'

const company: Company = {
  id: 'c1', name: 'Acme', domainName: 'acme.com', employees: 50, city: 'SF', country: 'US',
  arr: 4200000 /* cents */, currency: 'USD', idealCustomerProfile: true, linkedinLink: '', xLink: '',
  createdAt: 1_700_000_000, updatedAt: 1_700_000_000,
}
const contact: Contact = {
  id: 'p1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@acme.com', phone: '', jobTitle: 'CTO',
  city: 'London', companyId: 'c1', linkedinLink: '', xLink: '', createdAt: 1_700_000_500, updatedAt: 0,
}
const opp: Opportunity = {
  id: 'o1', name: 'Acme — enterprise', amount: 5_000_000 /* cents */, currency: 'USD', stage: 'PROPOSAL',
  closeDate: 1_710_000_000, companyId: 'c1', pointOfContactId: 'p1', createdAt: 1_700_000_900, updatedAt: 0,
}

describe('CRM as Base views — schemas', () => {
  it('exposes the expected collection fields', () => {
    expect(COMPANY_FIELDS.find((f) => f.name === 'arr')?.type).toBe('currency')
    expect(OPPORTUNITY_FIELDS.find((f) => f.name === 'stage')?.type).toBe('select')
    expect(OPPORTUNITY_FIELDS.find((f) => f.name === 'company')?.type).toBe('relation')
  })
  it('stage options cover every stage with a color', () => {
    expect(STAGE_OPTIONS.map((o) => o.value)).toContain('CUSTOMER')
    expect(STAGE_OPTIONS.every((o) => Boolean(o.color))).toBe(true)
    expect(STAGE_OPTIONS.find((o) => o.value === 'NEW')?.label).toBe('New')
  })
})

describe('record mappers', () => {
  it('company: minor units → dollars, seconds → ms', () => {
    const r = companyRecord(company)
    expect(r.arr).toEqual({ amount: 42000, currencyCode: 'USD' })
    expect(r.createdAt).toBe(1_700_000_000_000)
  })
  it('contact: joins the name and resolves the company relation to a named object', () => {
    const r = contactRecord(contact, companyNameLookup([company]))
    expect(r.name).toBe('Ada Lovelace')
    expect(r.company).toEqual({ id: 'c1', name: 'Acme' })
  })
  it('opportunity: money + close date + company relation', () => {
    const r = opportunityRecord(opp, companyNameLookup([company]))
    expect(r.amount).toEqual({ amount: 50000, currencyCode: 'USD' })
    expect(r.company).toEqual({ id: 'c1', name: 'Acme' })
    expect(r.closeDate).toBe(1_710_000_000_000)
    expect(r.stage).toBe('PROPOSAL')
  })
  it('company relation falls back to the id when the name is unknown', () => {
    const r = contactRecord(contact) // no lookup
    expect(r.company).toEqual({ id: 'c1', name: 'c1' })
  })
})

describe('companyOptions', () => {
  it('maps companies to id→name select options', () => {
    expect(companyOptions([company])).toEqual([{ value: 'c1', label: 'Acme' }])
  })
})
