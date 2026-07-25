/**
 * CRM as Base views — the demonstration that a CRM is just a curated set of
 * @hanzo/data views over the same object/field/record model that powers every
 * Base collection. The live cloud `/v1/crm` entities (companies / contacts /
 * opportunities) are expressed HERE as `FieldDefinition[]` collection schemas plus
 * pure record mappers, then rendered by the SAME `RecordsView` (table ⇆ board,
 * filter, sort, group, detail) the generic Base records surface uses.
 *
 * Pure (no React, no I/O): schemas + mappers in, records out — trivially testable.
 * The mappers adapt the two shapes @hanzo/data expects: money as
 * `{ amount, currencyCode }` (the API stores minor units → dollars here) and
 * timestamps as epoch-ms (the API returns epoch-seconds); relations become a
 * `{ id, name }` object so the cell shows the linked record's NAME, not its id.
 */
import type { FieldDefinition, SelectOption, TagColor } from '@hanzo/data'
import { STAGES, type Company, type Contact, type Opportunity } from '~/lib/api/crm'

/** Title-case a SCREAMING_SNAKE stage value ("NEW" → "New"). */
const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

// Monochrome-leaning: the early, non-semantic stages read neutral (gray); the later
// stages keep a restrained progression cue toward the "won" state (green = CUSTOMER).
const STAGE_COLOR: Record<string, TagColor> = {
  NEW: 'gray', SCREENING: 'gray', MEETING: 'amber', PROPOSAL: 'teal', CUSTOMER: 'green',
}

/** The opportunity stage options (drives the select cell + the pipeline board lanes). */
export const STAGE_OPTIONS: SelectOption[] = STAGES.map((s) => ({ value: s, label: titleCase(s), color: STAGE_COLOR[s] ?? 'gray' }))

const secToMs = (s: number): number | null => (s ? s * 1000 : null)
const minorToMajor = (n: number): number => (n ? n / 100 : 0)

// ── schemas ───────────────────────────────────────────────────────────────────
export const COMPANY_FIELDS: FieldDefinition[] = [
  { name: 'name', label: 'Name', type: 'text', width: 200 },
  { name: 'domainName', label: 'Domain', type: 'url', width: 180 },
  { name: 'employees', label: 'Employees', type: 'number', width: 120 },
  { name: 'arr', label: 'ARR', type: 'currency', width: 150, metadata: { currencyCode: 'USD' } },
  { name: 'idealCustomerProfile', label: 'ICP', type: 'boolean', width: 90 },
  { name: 'city', label: 'City', type: 'text', width: 140 },
  { name: 'country', label: 'Country', type: 'text', width: 110 },
  { name: 'linkedinLink', label: 'LinkedIn', type: 'url', width: 200 },
  { name: 'createdAt', label: 'Created', type: 'dateTime', width: 170, readOnly: true },
]

export const CONTACT_FIELDS: FieldDefinition[] = [
  { name: 'name', label: 'Name', type: 'text', width: 190 },
  { name: 'email', label: 'Email', type: 'email', width: 210 },
  { name: 'jobTitle', label: 'Title', type: 'text', width: 160 },
  { name: 'company', label: 'Company', type: 'relation', width: 180, metadata: { labelField: 'name' } },
  { name: 'phone', label: 'Phone', type: 'phone', width: 150 },
  { name: 'city', label: 'City', type: 'text', width: 130 },
  { name: 'createdAt', label: 'Created', type: 'dateTime', width: 170, readOnly: true },
]

export const OPPORTUNITY_FIELDS: FieldDefinition[] = [
  { name: 'name', label: 'Name', type: 'text', width: 220 },
  { name: 'stage', label: 'Stage', type: 'select', width: 140, metadata: { options: STAGE_OPTIONS } },
  { name: 'amount', label: 'Amount', type: 'currency', width: 150, metadata: { currencyCode: 'USD' } },
  { name: 'company', label: 'Company', type: 'relation', width: 180, metadata: { labelField: 'name' } },
  { name: 'closeDate', label: 'Close date', type: 'date', width: 150 },
  { name: 'createdAt', label: 'Created', type: 'dateTime', width: 170, readOnly: true },
]

// ── record mappers (entity → @hanzo/data record) ──────────────────────────────
export function companyRecord(c: Company): Record<string, unknown> {
  return {
    ...c,
    arr: { amount: minorToMajor(c.arr), currencyCode: c.currency || 'USD' },
    createdAt: secToMs(c.createdAt),
  }
}

export function contactRecord(c: Contact, companyName?: (id: string) => string | undefined): Record<string, unknown> {
  return {
    ...c,
    name: `${c.firstName} ${c.lastName}`.trim() || c.email || '(no name)',
    company: c.companyId ? { id: c.companyId, name: companyName?.(c.companyId) ?? c.companyId } : null,
    createdAt: secToMs(c.createdAt),
  }
}

export function opportunityRecord(o: Opportunity, companyName?: (id: string) => string | undefined): Record<string, unknown> {
  return {
    ...o,
    amount: { amount: minorToMajor(o.amount), currencyCode: o.currency || 'USD' },
    company: o.companyId ? { id: o.companyId, name: companyName?.(o.companyId) ?? o.companyId } : null,
    closeDate: secToMs(o.closeDate),
    createdAt: secToMs(o.createdAt),
  }
}

/** Company id → SelectOption (name), for the relation filter/editor injection. */
export function companyOptions(companies: Company[]): SelectOption[] {
  return companies.map((c) => ({ value: c.id, label: c.name || c.domainName || c.id }))
}

/** A lookup from company id to display name. */
export function companyNameLookup(companies: Company[]): (id: string) => string | undefined {
  const map = new Map(companies.map((c) => [c.id, c.name || c.domainName || c.id]))
  return (id: string) => map.get(id)
}
