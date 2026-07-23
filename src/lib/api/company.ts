/**
 * Company formation API — Hanzo Company, the per-org incorporation flow over the
 * REAL cloud `/v1/company` surface (cloud `clients/company`: an 8-stage formation
 * state machine on Base/SQLite — structure → founders → payment → documents →
 * esign → genesis → company, plus the already-incorporated import branch).
 *
 * Every call is same-origin, keyless and prefix-free (`cloudProxyV1Url('company…')`
 * → `<origin>/v1/company…`, the /v1-first form — NOTHING before `/v1/`). The
 * console's `app/v1` user-bearer BFF mints a short-lived IAM token from the session
 * and forwards it; the cloud backend resolves the org from the token's `owner`
 * claim, so the formation is org-scoped SERVER-SIDE and no credential reaches the
 * browser. A cookie-only call 403s ("X-Org-Id required"), so the bearer BFF is
 * mandatory. The `company` head is allow-listed in `proxy-allow.ts` CLOUD_HEADS.
 *
 * Transport is PLAIN REST (raw JSON, real HTTP status) — the company handler's
 * contract, NOT the casibase envelope: the view endpoints return `{ formation,
 * nextStages }`; kyc/esign carry the same `formation` plus their provider payload.
 * Normalizers are pure + defensive (snake_case tolerant, honest defaults, never
 * throw) so a partial/renamed payload degrades to a real value, never a crash.
 *
 * The state machine lives in the BACKEND (clients/company/machine.go) — this client
 * mirrors ONLY the wire shapes + the derived progress the wizard renders; it never
 * reimplements a guard. The KYC / e-sign / state-filing providers are honest stubs
 * today, so their steps report "pending — manual review", never a fabricated
 * "verified"/"filed" (see `isStubStep` + the honest status helpers). Behavior +
 * contract mirror clients/company; the design spec is HIP-0106-adjacent.
 */
import { restGet, restPost, restPut, cloudProxyV1Url, ApiError } from './client'

// ── Pure helpers (local; honest defaults, never throw) ───────────────────────
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s) => s.length > 0) : []

// ── Contract (mirrors clients/company/machine.go JSON tags) ──────────────────

/** A machine stage — the backend's `Stage` vocabulary. */
export type Stage =
  | 'structure'
  | 'founders'
  | 'payment'
  | 'documents'
  | 'esign'
  | 'genesis'
  | 'company'
  | 'import'

/** The legal entity a formation creates. */
export type Structure = 'c-corp' | 'llc' | 'dao-llc'
/** The state of incorporation the filing partner targets. */
export type Jurisdiction = 'DE' | 'WY'

/** KYC status for a founder (the idv seam reports it; today it is manual-pending). */
export const KYC_PENDING = 'pending'
export const KYC_VERIFIED = 'verified'
export const KYC_FAILED = 'failed'

export interface Founder {
  name: string
  email: string
  /** Ownership in basis points (1% == 100 bps); the founders' shares seed genesis. */
  equityBps: number
  kycStatus: string
  kycRef?: string
}

/** The cap-table equity genesis root committed on-chain (chain is source of truth).
 *  `status` is `pending` until the L1 anchor is wired — then `anchored`. */
export interface Genesis {
  root: string
  txHash?: string
  block?: number
  chainId?: number
  at: number
  status: string
  note?: string
}

/** The state-of-incorporation filing record (honest — no fabricated filing id). */
export interface Filing {
  provider: string
  ref?: string
  status: string // manual | submitted | filed | rejected
  note?: string
  at?: number
}

/** The one incorporation record per org — the value the machine transitions. */
export interface Formation {
  org: string
  structure: Structure | ''
  jurisdiction: Jurisdiction | ''
  name: string
  stage: Stage
  founders: Founder[]
  paid: boolean
  paymentRef?: string
  documentIds: string[]
  filing?: Filing
  signed: boolean
  esignRef?: string
  genesis?: Genesis
  alreadyIncorporated: boolean
  imported: boolean
  importedDocs: string[]
  capTableImported: boolean
  createdAt: number
  updatedAt: number
}

/** The view endpoints return the formation plus the machine's reachable out-edges. */
export interface FormationView {
  formation: Formation
  nextStages: Stage[]
}

/** One founder KYC verification session (returned by POST /company/kyc). */
export interface KycSession {
  email: string
  ref: string
  verifyUrl: string
  status: string
}

/** Fields the begin/structure form collects. */
export interface StructureInput {
  structure: Structure | ''
  jurisdiction: Jurisdiction | ''
  name: string
}

// ── Vocabularies (for the wizard forms) ──────────────────────────────────────

export const STRUCTURE_OPTIONS: { value: Structure; label: string }[] = [
  { value: 'c-corp', label: 'C-Corporation' },
  { value: 'llc', label: 'LLC' },
  { value: 'dao-llc', label: 'DAO LLC' },
]

export const JURISDICTION_OPTIONS: { value: Jurisdiction; label: string }[] = [
  { value: 'DE', label: 'Delaware' },
  { value: 'WY', label: 'Wyoming' },
]

export const structureLabel = (s: string): string =>
  STRUCTURE_OPTIONS.find((o) => o.value === s)?.label || (s ? s : '—')
export const jurisdictionLabel = (j: string): string =>
  JURISDICTION_OPTIONS.find((o) => o.value === j)?.label || (j ? j : '—')

// ── The wizard (8 conceptual steps over the machine's stages) ────────────────
//
// The machine has 7 happy-path stages (structure → founders → payment → documents
// → esign → genesis → company). The wizard surfaces KYC as its OWN step even though
// it is an ACTION within the `founders` stage (guardKYCVerified gates founders →
// payment), so the founder + investor sees the real 8-step path. `stage` maps each
// step onto the machine stage it is active at; `stub` marks a step whose provider is
// a stub today (KYC + e-sign), so the UI states it honestly.

export type StepKey =
  | 'structure'
  | 'founders'
  | 'kyc'
  | 'payment'
  | 'documents'
  | 'esign'
  | 'genesis'
  | 'company'

export interface WizardStep {
  key: StepKey
  /** The machine stage this step is active at. */
  stage: Stage
  label: string
  blurb: string
  /** Provider is a stub today → the UI must report an honest pending state. */
  stub?: boolean
}

export const WIZARD_STEPS: WizardStep[] = [
  { key: 'structure', stage: 'structure', label: 'Structure', blurb: 'Choose the entity, jurisdiction, and proposed name.' },
  { key: 'founders', stage: 'founders', label: 'Founders', blurb: 'Add the founding stakeholders and their equity split.' },
  { key: 'kyc', stage: 'founders', label: 'Identity (KYC)', blurb: 'Verify each founder’s identity.', stub: true },
  { key: 'payment', stage: 'payment', label: 'Payment', blurb: 'Pay the one-time $999 formation fee.' },
  { key: 'documents', stage: 'documents', label: 'Documents', blurb: 'Generate the formation documents into your data room.' },
  { key: 'esign', stage: 'esign', label: 'E-sign', blurb: 'Sign the formation documents.', stub: true },
  { key: 'genesis', stage: 'genesis', label: 'Equity genesis', blurb: 'Seed the cap table and anchor the equity genesis.' },
  { key: 'company', stage: 'company', label: 'Incorporated', blurb: 'Your company is live — manage its cap table and raise.' },
]

const STEP_ORDER: StepKey[] = WIZARD_STEPS.map((s) => s.key)
export const stepIndex = (key: StepKey): number => STEP_ORDER.indexOf(key)

/** Total founder equity in basis points (should sum to 10000 == 100%). */
export const foundersEquityBps = (founders: Founder[]): number =>
  founders.reduce((n, f) => n + (Number.isFinite(f.equityBps) ? f.equityBps : 0), 0)

/** Basis points → a percentage number (250 → 2.5). */
export const equityPct = (bps: number): number => Math.round((bps / 100) * 100) / 100

/** How many founders have cleared KYC. */
export const kycVerifiedCount = (f: Formation): number =>
  f.founders.filter((fo) => fo.kycStatus === KYC_VERIFIED).length

/** True iff there is ≥1 founder and every one is KYC-verified (the payment gate). */
export const allKycVerified = (f: Formation): boolean =>
  f.founders.length > 0 && f.founders.every((fo) => fo.kycStatus === KYC_VERIFIED)

/**
 * Is a wizard step COMPLETE for this formation? Derived purely from the formation's
 * data (the same facts the backend guards read), so the progress rail never lies.
 */
export function stepDone(key: StepKey, f: Formation): boolean {
  switch (key) {
    case 'structure':
      return !!f.structure && !!f.jurisdiction && f.name.trim() !== ''
    case 'founders':
      return f.founders.length > 0
    case 'kyc':
      return allKycVerified(f)
    case 'payment':
      return f.paid
    case 'documents':
      return f.documentIds.length > 0
    case 'esign':
      return f.signed
    case 'genesis':
      return !!f.genesis && f.genesis.root !== ''
    case 'company':
      return f.stage === 'company'
  }
}

/** The current step = the first not-done step in wizard order (or `company` once done). */
export function currentStep(f: Formation): StepKey {
  const first = STEP_ORDER.find((k) => !stepDone(k, f))
  return first ?? 'company'
}

/** Progress status for the rail: done · current · upcoming. */
export function stepStatus(key: StepKey, f: Formation): 'done' | 'current' | 'upcoming' {
  if (stepDone(key, f)) return 'done'
  return key === currentStep(f) ? 'current' : 'upcoming'
}

/** The next stage on the happy path, or null at the terminal stage. */
export function nextHappyStage(stage: Stage): Stage | null {
  const path: Stage[] = ['structure', 'founders', 'payment', 'documents', 'esign', 'genesis', 'company']
  const i = path.indexOf(stage)
  return i >= 0 && i < path.length - 1 ? path[i + 1] : null
}

/** True iff the step's provider is a stub today (KYC + e-sign) — state it honestly. */
export const isStubStep = (key: StepKey): boolean => WIZARD_STEPS.find((s) => s.key === key)?.stub === true

/**
 * Validate the founders before saving. Returns an error string, or null when valid.
 * Mirrors the backend write-boundary checks (name + email required, equityBps 0–10000).
 */
export function validateFounders(founders: Founder[]): string | null {
  if (founders.length === 0) return 'Add at least one founder.'
  for (const f of founders) {
    if (f.name.trim() === '' || f.email.trim() === '') return 'Each founder needs a name and an email.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return `“${f.email}” is not a valid email.`
    if (!Number.isInteger(f.equityBps) || f.equityBps < 0 || f.equityBps > 10000)
      return 'Equity must be a whole percentage between 0 and 100.'
  }
  return null
}

/** Validate the structure form. Returns an error string, or null when valid. */
export function validateStructure(input: StructureInput): string | null {
  if (!input.structure) return 'Choose an entity type.'
  if (!input.jurisdiction) return 'Choose a jurisdiction.'
  if (input.name.trim() === '') return 'Enter a proposed company name.'
  return null
}

// ── Honest status helpers (never claim a stub provider finished) ─────────────

export const kycStatusTone = (status: string): string =>
  status === KYC_VERIFIED ? 'active' : status === KYC_FAILED ? 'error' : 'pending'

/** A filing is honest: `manual`/`pending` until a real filing partner is wired. */
export const filingStatusLabel = (filing?: Filing): string => {
  if (!filing) return 'Not filed yet'
  switch (filing.status) {
    case 'filed':
      return 'Filed'
    case 'submitted':
      return 'Submitted'
    case 'rejected':
      return 'Rejected'
    default:
      return 'Pending — manual review'
  }
}

/** The genesis anchor is honest: `pending` until the L1 anchor is wired. */
export const genesisStatusLabel = (g?: Genesis): string => {
  if (!g || !g.root) return 'Not recorded yet'
  return g.status === 'anchored' ? 'Anchored on-chain' : 'Recorded — anchor pending'
}

// ── Normalizers (pure; snake_case tolerant, honest defaults) ─────────────────

export function normalizeFounder(raw: unknown): Founder {
  const r = asRecord(raw)
  return {
    name: str(r.name),
    email: str(r.email),
    equityBps: num(r.equityBps ?? r.equity_bps),
    kycStatus: str(r.kycStatus ?? r.kyc_status) || KYC_PENDING,
    kycRef: str(r.kycRef ?? r.kyc_ref) || undefined,
  }
}

function normalizeGenesis(raw: unknown): Genesis | undefined {
  if (!raw) return undefined
  const r = asRecord(raw)
  const root = str(r.root)
  if (!root) return undefined
  return {
    root,
    txHash: str(r.txHash ?? r.tx_hash) || undefined,
    block: num(r.block) || undefined,
    chainId: num(r.chainId ?? r.chain_id) || undefined,
    at: num(r.at),
    status: str(r.status) || 'pending',
    note: str(r.note) || undefined,
  }
}

function normalizeFiling(raw: unknown): Filing | undefined {
  if (!raw) return undefined
  const r = asRecord(raw)
  if (!r.status && !r.provider) return undefined
  return {
    provider: str(r.provider),
    ref: str(r.ref) || undefined,
    status: str(r.status) || 'manual',
    note: str(r.note) || undefined,
    at: num(r.at) || undefined,
  }
}

export function normalizeFormation(raw: unknown): Formation {
  const r = asRecord(raw)
  const founders = Array.isArray(r.founders) ? r.founders.map(normalizeFounder) : []
  return {
    org: str(r.org),
    structure: (str(r.structure) as Structure) || '',
    jurisdiction: (str(r.jurisdiction) as Jurisdiction) || '',
    name: str(r.name),
    stage: (str(r.stage) as Stage) || 'structure',
    founders,
    paid: bool(r.paid),
    paymentRef: str(r.paymentRef ?? r.payment_ref) || undefined,
    documentIds: strArray(r.documentIds ?? r.document_ids),
    filing: normalizeFiling(r.filing),
    signed: bool(r.signed),
    esignRef: str(r.esignRef ?? r.esign_ref) || undefined,
    genesis: normalizeGenesis(r.genesis),
    alreadyIncorporated: bool(r.alreadyIncorporated ?? r.already_incorporated),
    imported: bool(r.imported),
    importedDocs: strArray(r.importedDocs ?? r.imported_docs),
    capTableImported: bool(r.capTableImported ?? r.cap_table_imported),
    createdAt: num(r.createdAt ?? r.created_at),
    updatedAt: num(r.updatedAt ?? r.updated_at),
  }
}

/** Unwrap the `{ formation, nextStages }` view (from any endpoint that carries it). */
export function normalizeView(payload: unknown): FormationView {
  const p = asRecord(payload)
  const formationRaw = p.formation ?? payload
  const stages = strArray(p.nextStages ?? p.next_stages).filter((s): s is Stage =>
    ['structure', 'founders', 'payment', 'documents', 'esign', 'genesis', 'company', 'import'].includes(s),
  ) as Stage[]
  return { formation: normalizeFormation(formationRaw), nextStages: stages }
}

export function normalizeKycSessions(payload: unknown): KycSession[] {
  const rows = asRecord(payload).sessions
  return (Array.isArray(rows) ? rows : []).map((raw) => {
    const r = asRecord(raw)
    return {
      email: str(r.email),
      ref: str(r.ref),
      verifyUrl: str(r.verifyUrl ?? r.verify_url),
      status: str(r.status) || KYC_PENDING,
    }
  })
}

// ── Network methods (thin — one per company route) ───────────────────────────

const url = (seg = ''): string => cloudProxyV1Url(seg ? `company/${seg}` : 'company')

export const CompanyApi = {
  /** The current formation, or null when none exists yet (404 → begin). */
  get: async (): Promise<FormationView | null> => {
    try {
      return normalizeView(await restGet<unknown>(url()))
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },
  /** Begin a formation (idempotent — returns the existing one if present). */
  begin: (body: Partial<StructureInput> & { alreadyIncorporated?: boolean } = {}): Promise<FormationView> =>
    restPost<unknown>(url(), body).then(normalizeView),
  /** Set entity/jurisdiction/name (at the structure stage). */
  setStructure: (body: StructureInput): Promise<FormationView> =>
    restPut<unknown>(url('structure'), body).then(normalizeView),
  /** Replace the founders list. */
  setFounders: (founders: { name: string; email: string; equityBps: number }[]): Promise<FormationView> =>
    restPost<unknown>(url('founders'), { founders }).then(normalizeView),
  /** Start founder KYC (idv seam) → the verification sessions + the formation. */
  startKyc: (): Promise<{ view: FormationView; sessions: KycSession[] }> =>
    restPost<unknown>(url('kyc'), {}).then((p) => ({ view: normalizeView(p), sessions: normalizeKycSessions(p) })),
  /** Record a KYC result for one founder (the manual/webhook review hook). */
  kycCallback: (email: string, status: string): Promise<FormationView> =>
    restPost<unknown>(url('kyc/callback'), { email, status }).then(normalizeView),
  /** Charge the one-time $999 formation fee. */
  pay: (): Promise<FormationView> => restPost<unknown>(url('payment'), {}).then(normalizeView),
  /** Generate the formation documents into the data room + submit the state filing. */
  generateDocuments: (): Promise<FormationView> => restPost<unknown>(url('documents'), {}).then(normalizeView),
  /** Request signatures on the documents. */
  requestEsign: (): Promise<FormationView> => restPost<unknown>(url('esign'), {}).then(normalizeView),
  /** Record signing complete (the manual/webhook completion signal). */
  completeEsign: (signed = true): Promise<FormationView> =>
    restPost<unknown>(url('esign/complete'), { signed }).then(normalizeView),
  /** Seed the cap table with the founding allocation + anchor the equity genesis. */
  recordGenesis: (): Promise<FormationView> => restPost<unknown>(url('genesis'), {}).then(normalizeView),
  /** Run the next guarded transition. */
  advance: (to: Stage): Promise<FormationView> => restPost<unknown>(url('advance'), { to }).then(normalizeView),
  /** Mark the org already-incorporated (branches to the import path). */
  skip: (): Promise<FormationView> => restPost<unknown>(url('skip'), {}).then(normalizeView),
  /** Import existing corporate documents from a Google Drive folder. */
  importDocuments: (folderId: string): Promise<FormationView> =>
    restPost<unknown>(url('import/documents'), { folderId }).then(normalizeView),
  /** Import an existing cap table from a Google Sheet. */
  importCapTable: (spreadsheetId: string, range = ''): Promise<FormationView> =>
    restPost<unknown>(url('import/captable'), { spreadsheetId, range }).then(normalizeView),
}
