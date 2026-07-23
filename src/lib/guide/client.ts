/**
 * GuideBlueprintApi — the SuperAdmin client for the Zen-of-Hanzo Guide engine
 * (cloud `clients/guide`, live at `/v1/guide/*`). It is the operator half of the
 * growth-guide backend: read the whole authored blueprint, flip any item on/off,
 * edit an item in place, publish a versioned snapshot, browse the strategy corpus,
 * and read the org's own live growth profile + ranked next-best moves.
 *
 * Modeled on `lib/framework/client.ts`: `restGet/restPut/restPatch/restDelete` over
 * `cloudProxyV1Url('guide/...')` — the console's OWN same-origin `/v1` user-bearer BFF
 * (`<origin>/v1/guide/...`, the live-ingress-safe form for a bearer-scoped head; a bare
 * `/v1/guide` reaches the gateway with no minted principal and 403s). The BFF mints a
 * short-lived user token from the session and forwards it; the guide engine resolves the
 * org from the token owner claim and the SuperAdmin routes additionally require the
 * reserved-`admin` identity, so no credential reaches the browser. `guide` is
 * allow-listed in `proxy-allow.ts` CLOUD_HEADS (the single head admits every sub-path).
 *
 * PATCH: the core client already exposes `restPatch` (the plain-REST partial-edit seam,
 * the twin of `restPut`/`restDelete`), so the blueprint's `{ "enabled": false }` lever
 * rides the existing verb — no new seam to add.
 *
 * Bare JSON (real HTTP status). Payloads are normalized DEFENSIVELY, so a field rename
 * upstream degrades a cell rather than throwing; the pure normalizers + `strategyQuery`
 * shaping are unit-tested (client.test.ts).
 */
import { restGet, restPut, restPatch, cloudProxyV1Url } from '~/lib/api/client'

const BASE = 'guide'
const enc = encodeURIComponent
const url = (path: string): string => cloudProxyV1Url(`${BASE}/${path}`)

// ── Coercion helpers (defensive; framework/crm/referrals style) ─────────────
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return 0
}
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1
/** An authored blueprint item is ON unless explicitly disabled — the PATCH `{enabled:false}`
 *  lever is the only "off". A missing flag reads as enabled (the authored default), never a
 *  false "disabled" that would misreport the live guide. */
const enabledOf = (v: unknown): boolean => !(v === false || v === 'false' || v === 0 || v === '0' || v === 'off')
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s) => s.length > 0) : []
/** First array under a common envelope key (`data`/named), else a bare array; never throws. */
const arrayUnder = (payload: unknown, keys: string[]): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  const o = asRecord(payload)
  for (const k of keys) {
    if (Array.isArray(o[k])) return (o[k] as unknown[]).filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  }
  return []
}

// ── Domain types (mirror cloud clients/guide blueprint JSON) ────────────────

/** The five editable blueprint collections the PATCH lever addresses. */
export type BlueprintCollection = 'principles' | 'sections' | 'steps' | 'strategies' | 'templates'
export const BLUEPRINT_COLLECTIONS: BlueprintCollection[] = ['principles', 'sections', 'steps', 'strategies', 'templates']

/** One of the 64 Zen-of-Hanzo archetypes — an I Ching hexagram fused with a Sun Tzu concept. */
export type Principle = {
  n: number
  hexagram: string
  slug: string
  name: string
  principle: string
  change: string
  sunTzu: string
  domain: string
  enabled: boolean
}

/** A journey section (a phase of the launch curriculum) that groups steps. */
export type Section = {
  id: string
  title: string
  detail: string
  order: number
  enabled: boolean
}

/** One journey step: what to do, the tool that automates it, and its dependencies. */
export type Step = {
  id: string
  section: string
  title: string
  detail: string
  tool: string
  deps: string[]
  enabled: boolean
}

/** The blog stub attached to a strategy — the why/how/case-study narrative. */
export type StrategyBlog = { why: string; how: string; caseStudy: string }

/** One tactic in the corpus (the ~888 modern + 114 heritage strategic genome). */
export type Strategy = {
  id: string
  principle: string
  category: string
  workload: string
  action: string
  tags: string[]
  source: string
  era: string
  blog: StrategyBlog
  enabled: boolean
}

/** A reusable authored template (email/page/campaign scaffold). */
export type Template = {
  id: string
  title: string
  category: string
  body: string
  enabled: boolean
}

/** The full authored blueprint (SuperAdmin GET /v1/guide/blueprint). */
export type Blueprint = {
  version: string
  brand: string
  title: string
  enabled: boolean
  principles: Principle[]
  sections: Section[]
  steps: Step[]
  strategies: Strategy[]
  templates: Template[]
}

/** The normalized blueprint plus the RAW payload — kept verbatim so "Publish version"
 *  round-trips the exact authored object (a re-serialized normalized shape could drop a
 *  field the engine persists). */
export type BlueprintResult = { blueprint: Blueprint; raw: Record<string, unknown> }

/** One entry in the blueprint version history (GET /v1/guide/blueprint/versions). */
export type BlueprintVersion = {
  version: string
  brand: string
  title: string
  savedAt: number
  note: string
}

/** The org's top-of-funnel counts (a decreasing funnel — the sparkline series). */
export type GrowthFunnel = { pageviews: number; visitors: number; signups: number; orders: number; revenue: number }

/** The four canonical growth stages, in order. */
export const GROWTH_STAGES = ['formed', 'launched', 'activated', 'scaling'] as const
export type GrowthStage = (typeof GROWTH_STAGES)[number] | (string & {})

/** The org's live growth read (GET /v1/guide/profile) — the dogfood lens. */
export type GrowthProfile = {
  stage: GrowthStage
  signals: Record<string, boolean>
  keyMetrics: {
    funnel: GrowthFunnel
    revenueCents: number
    records: number
    launchProgress: number
  }
}

/** One ranked next-best move (GET /v1/guide/suggest suggestions). */
export type GrowthSuggestion = {
  stepId: string
  title: string
  why: string
  rationale: string
  automatable: boolean
  unlocks: number
}

/** The ranked next-best moves + funnel-derived recommendations. */
export type GrowthSuggest = {
  next: string
  suggestions: GrowthSuggestion[]
  recommendations: string[]
}

/** Corpus filter (all optional; empty = unfiltered). */
export type StrategyFilter = { category?: string; stage?: string; workload?: string }

// ── Normalizers ─────────────────────────────────────────────────────────────

function normalizePrinciple(raw: unknown): Principle {
  const r = asRecord(raw)
  return {
    n: num(r.n),
    hexagram: str(r.hexagram),
    slug: str(r.slug),
    name: str(r.name),
    principle: str(r.principle),
    change: str(r.change),
    sunTzu: str(r.sunTzu ?? r.sun_tzu),
    domain: str(r.domain),
    enabled: enabledOf(r.enabled),
  }
}

function normalizeSection(raw: unknown): Section {
  const r = asRecord(raw)
  return {
    id: str(r.id),
    title: str(r.title),
    detail: str(r.detail ?? r.description),
    order: num(r.order),
    enabled: enabledOf(r.enabled),
  }
}

function normalizeStep(raw: unknown): Step {
  const r = asRecord(raw)
  return {
    id: str(r.id),
    section: str(r.section),
    title: str(r.title),
    detail: str(r.detail ?? r.description),
    tool: str(r.tool),
    deps: strArray(r.deps ?? r.dependencies),
    enabled: enabledOf(r.enabled),
  }
}

function normalizeBlog(raw: unknown): StrategyBlog {
  // The stub is an object {why,how,caseStudy}; a bare string degrades into the case-study slot.
  if (typeof raw === 'string') return { why: '', how: '', caseStudy: raw }
  const r = asRecord(raw)
  return { why: str(r.why), how: str(r.how), caseStudy: str(r.caseStudy ?? r.case_study) }
}

function normalizeStrategy(raw: unknown): Strategy {
  const r = asRecord(raw)
  return {
    id: str(r.id),
    principle: str(r.principle),
    category: str(r.category),
    workload: str(r.workload),
    action: str(r.action),
    tags: strArray(r.tags),
    source: str(r.source),
    era: str(r.era),
    blog: normalizeBlog(r.blog),
    enabled: enabledOf(r.enabled),
  }
}

function normalizeTemplate(raw: unknown): Template {
  const r = asRecord(raw)
  return {
    id: str(r.id),
    title: str(r.title ?? r.name),
    category: str(r.category),
    body: str(r.body ?? r.content),
    enabled: enabledOf(r.enabled),
  }
}

export function normalizeBlueprint(raw: unknown): Blueprint {
  const r = asRecord(raw)
  return {
    version: str(r.version),
    brand: str(r.brand),
    title: str(r.title),
    enabled: enabledOf(r.enabled),
    principles: arrayUnder(r.principles, ['principles', 'data']).map(normalizePrinciple),
    sections: arrayUnder(r.sections, ['sections', 'data']).map(normalizeSection),
    steps: arrayUnder(r.steps, ['steps', 'data']).map(normalizeStep),
    strategies: arrayUnder(r.strategies, ['strategies', 'data']).map(normalizeStrategy),
    templates: arrayUnder(r.templates, ['templates', 'data']).map(normalizeTemplate),
  }
}

function normalizeVersion(raw: unknown): BlueprintVersion {
  const r = asRecord(raw)
  return {
    version: str(r.version),
    brand: str(r.brand),
    title: str(r.title),
    savedAt: num(r.savedAt ?? r.saved_at ?? r.createdAt ?? r.created_at),
    note: str(r.note ?? r.message),
  }
}

function normalizeFunnel(raw: unknown): GrowthFunnel {
  const r = asRecord(raw)
  return {
    pageviews: num(r.pageviews),
    visitors: num(r.visitors),
    signups: num(r.signups),
    orders: num(r.orders),
    revenue: num(r.revenue),
  }
}

export function normalizeProfile(raw: unknown): GrowthProfile {
  const r = asRecord(raw)
  const km = asRecord(r.keyMetrics ?? r.key_metrics)
  const signalsRaw = asRecord(r.signals)
  const signals: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(signalsRaw)) signals[k] = bool(v)
  return {
    stage: str(r.stage) || 'formed',
    signals,
    keyMetrics: {
      funnel: normalizeFunnel(km.funnel),
      revenueCents: num(km.revenueCents ?? km.revenue_cents),
      records: num(km.records),
      launchProgress: num(km.launchProgress ?? km.launch_progress),
    },
  }
}

function normalizeSuggestion(raw: unknown): GrowthSuggestion {
  const r = asRecord(raw)
  return {
    stepId: str(r.stepId ?? r.step_id),
    title: str(r.title),
    why: str(r.why),
    rationale: str(r.rationale),
    automatable: bool(r.automatable),
    unlocks: num(r.unlocks),
  }
}

export function normalizeSuggest(raw: unknown): GrowthSuggest {
  const r = asRecord(raw)
  return {
    next: str(r.next),
    suggestions: arrayUnder(r.suggestions, ['suggestions', 'data']).map(normalizeSuggestion),
    recommendations: strArray(r.recommendations),
  }
}

/** Build the `/v1/guide/strategies` querystring from a typed filter. Exported for testing;
 *  empty/absent facets are omitted so the wire contract stays `?category=&stage=&workload=`. */
export function strategyQuery(f?: StrategyFilter): string {
  if (!f) return ''
  const p = new URLSearchParams()
  if (f.category) p.set('category', f.category)
  if (f.stage) p.set('stage', f.stage)
  if (f.workload) p.set('workload', f.workload)
  const s = p.toString()
  return s ? `?${s}` : ''
}

// ── Client ──────────────────────────────────────────────────────────────────

export const GuideBlueprintApi = {
  /** The full authored blueprint (SuperAdmin). Returns the normalized shape + the raw
   *  payload (for verbatim "Publish version" round-trips). */
  blueprint: async (): Promise<BlueprintResult> => {
    const raw = await restGet<unknown>(url('blueprint'))
    return { blueprint: normalizeBlueprint(raw), raw: asRecord(raw) }
  },

  /** Edit ONE item — the live enable/disable lever (`{enabled:false}`) or an inline field edit. */
  patchItem: (collection: BlueprintCollection, id: string, patch: Record<string, unknown>): Promise<void> =>
    restPatch(url(`blueprint/${enc(collection)}/${enc(id)}`), patch).then(() => undefined),

  /** Replace the whole blueprint (versioned) — "Publish version" snapshots the raw payload. */
  publish: (blueprint: Record<string, unknown>): Promise<void> =>
    restPut(url('blueprint'), blueprint).then(() => undefined),

  /** The blueprint version history (newest first, best-effort). */
  versions: async (): Promise<BlueprintVersion[]> =>
    arrayUnder(await restGet<unknown>(url('blueprint/versions')), ['versions', 'data']).map(normalizeVersion),

  /** The corpus, server-filtered + enabled-only. */
  strategies: async (f?: StrategyFilter): Promise<Strategy[]> =>
    arrayUnder(await restGet<unknown>(url(`strategies${strategyQuery(f)}`)), ['strategies', 'data']).map(normalizeStrategy),

  /** The org's live growth profile (the dogfood lens). */
  profile: async (): Promise<GrowthProfile> => normalizeProfile(await restGet<unknown>(url('profile'))),

  /** The ranked next-best moves + recommendations. */
  suggest: async (): Promise<GrowthSuggest> => normalizeSuggest(await restGet<unknown>(url('suggest'))),
}

export type GuideBlueprintClient = typeof GuideBlueprintApi
