/**
 * CRM API — Hanzo CRM (companies, contacts, opportunities), the first
 * business-app subsystem ported native-Go onto Base
 * (cloud `clients/crm`, spec `universe/docs/architecture/unified-backend-go.md`).
 *
 * The DOCUMENTED contract is the cloud `/v1/crm` surface, called SAME-ORIGIN with
 * NO prefix (`originV1Url('crm')` → `<origin>/v1/crm`, the CTO one-endpoint-form).
 * `next.config.mjs` rewrites the `crm` head to the console's OWN user-bearer proxy
 * (`app/cloud`), which mints a short-lived user-bound IAM token server-side and
 * forwards it; the cloud backend resolves the org from the token's `owner` claim,
 * so every read/write is org-scoped SERVER-SIDE and NO credential reaches the
 * browser. This is the SAME per-tenant path Agents/Prompts/Evals use
 * (allow-listed in `proxy-allow.ts`).
 *
 * Routes (from cloud `clients/crm/crm.go`):
 *   - GET    /v1/crm/summary                      per-org counts
 *   - GET    /v1/crm/companies                    list companies
 *   - POST   /v1/crm/companies                    create a company
 *   - DELETE /v1/crm/companies/{id}               delete a company
 *   - GET    /v1/crm/contacts        (?companyId=) list contacts
 *   - POST   /v1/crm/contacts                     create a contact
 *   - DELETE /v1/crm/contacts/{id}                delete a contact
 *   - GET    /v1/crm/opportunities   (?stage=)     list opportunities
 *   - POST   /v1/crm/opportunities                create an opportunity
 *   - DELETE /v1/crm/opportunities/{id}           delete an opportunity
 *
 * Plain REST (raw JSON, real HTTP status), not the casibase envelope. Payloads are
 * normalized DEFENSIVELY (agents.ts style) — a field rename upstream degrades a
 * cell rather than throwing, and the list is read from whichever envelope key the
 * backend uses (`data` / `items` / `rows`, or a bare array).
 */
import { restGet, restPost, restDelete, originV1Url } from './client'

const BASE = 'crm'
const enc = encodeURIComponent

// ── Coercion helpers (defensive) ────────────────────────────────────────────
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : 0
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Pull the first array under a common envelope key (or a bare array). */
const arrayUnder = (payload: unknown): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  const r = asRecord(payload)
  for (const k of ['data', 'items', 'rows']) {
    const v = r[k]
    if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  }
  return []
}

// ── Domain types (mirror cloud clients/crm) ─────────────────────────────────

export type Company = {
  id: string
  name: string
  domainName: string
  employees: number
  city: string
  country: string
  /** annual recurring revenue, minor units (cents) of `currency`. */
  arr: number
  currency: string
  idealCustomerProfile: boolean
  linkedinLink: string
  xLink: string
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
}

/** The default Twenty pipeline stages. */
export const STAGES = ['NEW', 'SCREENING', 'MEETING', 'PROPOSAL', 'CUSTOMER'] as const
export type Stage = (typeof STAGES)[number]

export type Opportunity = {
  id: string
  name: string
  /** deal amount, minor units (cents) of `currency`. */
  amount: number
  currency: string
  stage: string
  closeDate: number
  companyId: string
  pointOfContactId: string
}

export type Summary = { companies: number; contacts: number; opportunities: number }

// ── Create bodies ───────────────────────────────────────────────────────────
export type NewCompany = { name: string; domainName?: string; employees?: number; city?: string; country?: string }
export type NewContact = { firstName?: string; lastName?: string; email?: string; jobTitle?: string; companyId?: string }
export type NewOpportunity = { name: string; amount?: number; stage?: string; companyId?: string; pointOfContactId?: string }

// ── Normalizers (pure) ──────────────────────────────────────────────────────
function normCompany(raw: unknown): Company | null {
  const r = asRecord(raw)
  if (!r.id) return null
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
  }
}

function normContact(raw: unknown): Contact | null {
  const r = asRecord(raw)
  if (!r.id) return null
  return {
    id: str(r.id),
    firstName: str(r.firstName),
    lastName: str(r.lastName),
    email: str(r.email),
    phone: str(r.phone),
    jobTitle: str(r.jobTitle),
    city: str(r.city),
    companyId: str(r.companyId),
  }
}

function normOpportunity(raw: unknown): Opportunity | null {
  const r = asRecord(raw)
  if (!r.id) return null
  return {
    id: str(r.id),
    name: str(r.name),
    amount: num(r.amount),
    currency: str(r.currency) || 'USD',
    stage: str(r.stage) || 'NEW',
    closeDate: num(r.closeDate),
    companyId: str(r.companyId),
    pointOfContactId: str(r.pointOfContactId),
  }
}

export function normalizeSummary(payload: unknown): Summary {
  const r = asRecord(payload)
  return { companies: num(r.companies), contacts: num(r.contacts), opportunities: num(r.opportunities) }
}

// ── Network methods (thin, forward-compatible) ──────────────────────────────
export const CrmApi = {
  summary: (): Promise<Summary> => restGet<unknown>(originV1Url(`${BASE}/summary`)).then(normalizeSummary),

  companies: (): Promise<Company[]> =>
    restGet<unknown>(originV1Url(`${BASE}/companies`)).then((p) =>
      arrayUnder(p).map(normCompany).filter((c): c is Company => c !== null),
    ),
  createCompany: (body: NewCompany): Promise<unknown> => restPost<unknown>(originV1Url(`${BASE}/companies`), body),
  removeCompany: (id: string): Promise<void> => restDelete(originV1Url(`${BASE}/companies/${enc(id)}`)),

  contacts: (companyId?: string): Promise<Contact[]> =>
    restGet<unknown>(originV1Url(`${BASE}/contacts${companyId ? `?companyId=${enc(companyId)}` : ''}`)).then((p) =>
      arrayUnder(p).map(normContact).filter((c): c is Contact => c !== null),
    ),
  createContact: (body: NewContact): Promise<unknown> => restPost<unknown>(originV1Url(`${BASE}/contacts`), body),
  removeContact: (id: string): Promise<void> => restDelete(originV1Url(`${BASE}/contacts/${enc(id)}`)),

  opportunities: (stage?: string): Promise<Opportunity[]> =>
    restGet<unknown>(originV1Url(`${BASE}/opportunities${stage ? `?stage=${enc(stage)}` : ''}`)).then((p) =>
      arrayUnder(p).map(normOpportunity).filter((o): o is Opportunity => o !== null),
    ),
  createOpportunity: (body: NewOpportunity): Promise<unknown> =>
    restPost<unknown>(originV1Url(`${BASE}/opportunities`), body),
  removeOpportunity: (id: string): Promise<void> => restDelete(originV1Url(`${BASE}/opportunities/${enc(id)}`)),
}
