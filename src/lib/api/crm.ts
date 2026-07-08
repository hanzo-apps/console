/**
 * CRM API — Hanzo CRM (companies, contacts, opportunities), the first Business-OS
 * brick over the REAL cloud `/v1/crm` surface (cloud `clients/crm`, a native-Go
 * per-org CRM on Base/SQLite — a port of Twenty's core model, NOT a NestJS proxy).
 *
 * Every call is same-origin, keyless and prefix-free (`originV1Url('crm/...')` →
 * `<origin>/v1/crm/...`, the CTO one-endpoint form). The console's OWN `app/v1`
 * user-bearer BFF serves the `crm` head — it mints a short-lived user-bound IAM token
 * server-side and forwards it; the cloud backend resolves the org from the token's
 * `owner` claim, so every read/write is org-scoped SERVER-SIDE and no credential
 * reaches the browser. This is the EXACT per-tenant path Agents/Evals/Prompts use (the
 * `crm` head is allow-listed in `proxy-allow.ts` CLOUD_HEADS). A cookie-only call would
 * 403 ("X-Org-Id required"), so the bearer BFF is mandatory — never a direct call.
 *
 * Routes (from cloud `clients/crm/crm.go`):
 *   GET/POST            /v1/crm/companies            list / create
 *   GET/PUT/DELETE      /v1/crm/companies/:id        detail / update / delete
 *   GET/POST            /v1/crm/contacts             list (?companyId=) / create
 *   GET/PUT/DELETE      /v1/crm/contacts/:id         detail / update / delete
 *   GET/POST            /v1/crm/opportunities        list (?stage=) / create
 *   GET/PUT/DELETE      /v1/crm/opportunities/:id    detail / update / delete
 *   GET                 /v1/crm/summary              per-org row counts
 *
 * Plain REST (raw JSON, real HTTP status). Payloads are normalized DEFENSIVELY —
 * a field rename upstream degrades a cell rather than throwing, and the list is read
 * from whichever envelope key the backend uses (`data` / `items` / `rows`, or a bare
 * array). PURE normalizers are unit-tested (crm.test.ts).
 */
import { restGet, restPost, restPut, restDelete, originV1Url } from './client'

const BASE = 'crm'
const enc = encodeURIComponent

// ── Coercion helpers (defensive; prompts.ts style) ──────────────────────────
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return 0
}
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Pull the first array found under any common envelope key (or the root). */
const arrayUnder = (payload: unknown, keys: string[]): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  if (payload && typeof payload === 'object') {
    for (const k of keys) {
      const v = (payload as Record<string, unknown>)[k]
      if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
    }
  }
  return []
}
const rows = (payload: unknown) => arrayUnder(payload, ['data', 'items', 'rows'])

// ── Domain types (mirror cloud clients/crm/store.go JSON tags) ───────────────

/** The Twenty opportunity pipeline (cloud rejects an unknown stage; '' → NEW). */
export const STAGES = ['NEW', 'SCREENING', 'MEETING', 'PROPOSAL', 'CUSTOMER'] as const
export type Stage = (typeof STAGES)[number]

export type Company = {
  id: string
  name: string
  domainName: string
  employees: number
  city: string
  country: string
  arr: number
  currency: string
  idealCustomerProfile: boolean
  linkedinLink: string
  xLink: string
  createdAt: number
  updatedAt: number
}

export type Contact = {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
  jobTitle: string
  city: string
  companyId: string
  linkedinLink: string
  xLink: string
  createdAt: number
  updatedAt: number
}

export type Opportunity = {
  id: string
  name: string
  amount: number
  currency: string
  stage: string
  closeDate: number
  companyId: string
  pointOfContactId: string
  createdAt: number
  updatedAt: number
}

export type Summary = { companies: number; contacts: number; opportunities: number }

/** Create/update bodies — only the writable fields (server owns id/org/timestamps). */
export type NewCompany = Partial<Omit<Company, 'id' | 'createdAt' | 'updatedAt'>> & { name: string }
export type NewContact = Partial<Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>>
export type NewOpportunity = Partial<Omit<Opportunity, 'id' | 'createdAt' | 'updatedAt'>> & { name: string }

// ── Normalizers (pure) ──────────────────────────────────────────────────────

export function normalizeCompany(raw: unknown): Company {
  const r = asRecord(raw)
  return {
    id: str(r.id),
    name: str(r.name),
    domainName: str(r.domainName),
    employees: num(r.employees),
    city: str(r.city),
    country: str(r.country),
    arr: num(r.arr),
    currency: str(r.currency) || 'USD',
    idealCustomerProfile: bool(r.idealCustomerProfile),
    linkedinLink: str(r.linkedinLink),
    xLink: str(r.xLink),
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
  }
}

export function normalizeContact(raw: unknown): Contact {
  const r = asRecord(raw)
  return {
    id: str(r.id),
    firstName: str(r.firstName),
    lastName: str(r.lastName),
    email: str(r.email),
    phone: str(r.phone),
    jobTitle: str(r.jobTitle),
    city: str(r.city),
    companyId: str(r.companyId),
    linkedinLink: str(r.linkedinLink),
    xLink: str(r.xLink),
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
  }
}

export function normalizeOpportunity(raw: unknown): Opportunity {
  const r = asRecord(raw)
  return {
    id: str(r.id),
    name: str(r.name),
    amount: num(r.amount),
    currency: str(r.currency) || 'USD',
    stage: str(r.stage) || 'NEW',
    closeDate: num(r.closeDate),
    companyId: str(r.companyId),
    pointOfContactId: str(r.pointOfContactId),
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
  }
}

export function normalizeSummary(raw: unknown): Summary {
  const r = asRecord(raw)
  return { companies: num(r.companies), contacts: num(r.contacts), opportunities: num(r.opportunities) }
}

export const normalizeCompanies = (p: unknown): Company[] => rows(p).map(normalizeCompany).filter((c) => c.id)
export const normalizeContacts = (p: unknown): Contact[] => rows(p).map(normalizeContact).filter((c) => c.id)
export const normalizeOpportunities = (p: unknown): Opportunity[] =>
  rows(p).map(normalizeOpportunity).filter((o) => o.id)

// ── Network methods (thin — one per documented route) ───────────────────────

export const CrmApi = {
  summary: (): Promise<Summary> => restGet<unknown>(originV1Url(`${BASE}/summary`)).then(normalizeSummary),

  companies: {
    list: (): Promise<Company[]> =>
      restGet<unknown>(originV1Url(`${BASE}/companies`)).then(normalizeCompanies),
    get: (id: string): Promise<Company> =>
      restGet<unknown>(originV1Url(`${BASE}/companies/${enc(id)}`)).then(normalizeCompany),
    create: (body: NewCompany): Promise<Company> =>
      restPost<unknown>(originV1Url(`${BASE}/companies`), body).then(normalizeCompany),
    update: (id: string, body: NewCompany): Promise<Company> =>
      restPut<unknown>(originV1Url(`${BASE}/companies/${enc(id)}`), body).then(normalizeCompany),
    remove: (id: string): Promise<void> => restDelete(originV1Url(`${BASE}/companies/${enc(id)}`)),
  },

  contacts: {
    list: (companyId?: string): Promise<Contact[]> =>
      restGet<unknown>(
        originV1Url(`${BASE}/contacts${companyId ? `?companyId=${enc(companyId)}` : ''}`),
      ).then(normalizeContacts),
    get: (id: string): Promise<Contact> =>
      restGet<unknown>(originV1Url(`${BASE}/contacts/${enc(id)}`)).then(normalizeContact),
    create: (body: NewContact): Promise<Contact> =>
      restPost<unknown>(originV1Url(`${BASE}/contacts`), body).then(normalizeContact),
    update: (id: string, body: NewContact): Promise<Contact> =>
      restPut<unknown>(originV1Url(`${BASE}/contacts/${enc(id)}`), body).then(normalizeContact),
    remove: (id: string): Promise<void> => restDelete(originV1Url(`${BASE}/contacts/${enc(id)}`)),
  },

  opportunities: {
    list: (stage?: string): Promise<Opportunity[]> =>
      restGet<unknown>(
        originV1Url(`${BASE}/opportunities${stage ? `?stage=${enc(stage)}` : ''}`),
      ).then(normalizeOpportunities),
    get: (id: string): Promise<Opportunity> =>
      restGet<unknown>(originV1Url(`${BASE}/opportunities/${enc(id)}`)).then(normalizeOpportunity),
    create: (body: NewOpportunity): Promise<Opportunity> =>
      restPost<unknown>(originV1Url(`${BASE}/opportunities`), body).then(normalizeOpportunity),
    update: (id: string, body: NewOpportunity): Promise<Opportunity> =>
      restPut<unknown>(originV1Url(`${BASE}/opportunities/${enc(id)}`), body).then(normalizeOpportunity),
    remove: (id: string): Promise<void> =>
      restDelete(originV1Url(`${BASE}/opportunities/${enc(id)}`)),
  },
}
