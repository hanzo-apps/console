/**
 * AI catalog — the ONE rich model + provider + plan client behind the Models,
 * Providers, and (later) hanzo.ai / @hanzo/dev / desktop surfaces. One spine,
 * three reads, all through the console's authenticated `/ai` proxy (so the user
 * bearer the gateway requires is attached server-side — never in the browser):
 *
 *   • `/v1/pricing/models` — the rich catalog (name, description, context,
 *     provider, specs, tier, per-Mtok pricing, features). 375+ real models.
 *   • `/v1/models`        — the live routing set; a catalog model is "Available"
 *     iff it is actually servable right now (cross-referenced by stable id).
 *   • `/v1/plans`         — the subscription tiers + entitlements (rpm/tpm/quota),
 *     honest-empty when gated (401/404) — pure enrichment, never page-breaking.
 *
 * Nothing is fabricated: an unreachable endpoint yields an honest empty/error
 * state at the page, never placeholder rows.
 *
 * REAL-DATA SHAPE NOTE (load-bearing): the catalog carries TWO record shapes —
 * the 36 first-party Zen models use `context` + `name`, while the 339 third-party
 * models use `contextWindow` + an `id` like `openai/gpt-5` (with a display `name`
 * like "OpenAI: GPT-5"). The normalizers below (`modelId`/`modelContext`/
 * `modelDisplayName`) join both shapes so every model renders its real context,
 * cross-references availability by the right key, and shows a clean row name.
 */
import { restGet, originV1Url } from './client'

/** A model as the rich pricing catalog publishes it. All fields optional-safe. */
export type RichModel = {
  name: string
  /** Third-party records carry a stable routing id, e.g. `openai/gpt-5`. */
  id?: string | null
  fullName?: string | null
  description?: string
  category?: string
  /** First-party (Zen) records carry `context`… */
  context?: number | null
  /** …third-party records carry `contextWindow` (same meaning). */
  contextWindow?: number | null
  provider?: string
  tier?: string | null
  specs?: { arch?: string; params?: string }
  features?: string[]
  pricing?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
  /** Third-party flag: the model is free to serve. */
  isFree?: boolean
  /** Editorially highlighted in the catalog. */
  featured?: boolean
}

type PricingCatalog = { models?: RichModel[]; total?: number; updated?: string }
/**
 * The live routing set (`/v1/models`) — each entry servable now. It is the
 * OpenAI list shape (a routing `id` + an `owned_by` provider), NOT the rich
 * pricing shape, so live-only entries are normalized to the catalog shape on
 * merge (name ← id, provider ← owned_by) — otherwise the picker row is blank.
 */
type LiveModel = RichModel & { owned_by?: string }
type LiveModels = { data?: LiveModel[] }

/** The live routing/availability key for a model: id (third-party) else name (Zen). */
const liveKey = (m: { id?: string | null; name?: string }): string =>
  (m.id ?? m.name ?? '').trim().toLowerCase()

/** A catalog model joined with its live-availability flag. */
export type CatalogEntry = RichModel & { available: boolean }

/** Providers grouped from the catalog — what the Providers "Explore" grid renders. */
export type ProviderGroup = {
  provider: string
  models: CatalogEntry[]
  count: number
  /** Cheapest input price across the group ($/Mtok), or null when none priced. */
  minInput: number | null
  /** Largest context across the group (tokens), or null. */
  maxContext: number | null
  /** A few model display names for the card chips. */
  sample: string[]
  /** True for our own first-party Zen/Hanzo group (the "Verified" badge). */
  verified: boolean
  /** How many of the group's models are servable right now. */
  available: number
}

// ── Normalizers (the two-shape join) ─────────────────────────────────────────

/** The stable routing/availability id: `id` (third-party) else `name` (Zen). */
export function modelId(m: RichModel): string {
  return (m.id ?? m.name ?? '').trim()
}

/** Context window in tokens across both record shapes (`context`|`contextWindow`). */
export function modelContext(m: RichModel): number | null {
  const c = m.context ?? m.contextWindow
  return typeof c === 'number' && c > 0 ? c : null
}

/**
 * The clean row name. Third-party records name themselves "OpenAI: GPT-5" (the
 * provider is already a separate column), so strip a leading "<provider><sep>"
 * prefix; first-party ids like "zen3-omni" are returned unchanged.
 */
export function modelDisplayName(m: RichModel): string {
  const name = (m.name ?? '').trim()
  const prov = (m.provider ?? '').trim()
  if (!name || !prov) return name
  const lower = name.toLowerCase()
  const p = prov.toLowerCase()
  for (const sep of [': ', ' — ', ' - ', ' / ', ':']) {
    if (lower.startsWith(p + sep)) return name.slice(prov.length + sep.length).trim() || name
  }
  return name
}

/**
 * Fetch the live model set and join the rich pricing overlay. The live routing
 * set (`/v1/models`) is the PRIMARY source — always routed, it returns the full
 * servable catalog (incl the current Zen family); its failure IS the backend
 * error. The rich pricing catalog (`/v1/pricing/models`) is a BEST-EFFORT overlay
 * (name/description/context/price): on some ingresses it is unrouted/502, so a
 * failure there degrades to the live set rather than blanking the whole catalog —
 * the SAME resilience `CloudModelApi.list` already uses. Throws only when the live
 * set itself is unreachable.
 */
export async function fetchCatalog(): Promise<CatalogEntry[]> {
  const [cat, live] = await Promise.all([
    restGet<PricingCatalog>(originV1Url('pricing/models')).catch(() => ({ models: [] }) as PricingCatalog),
    restGet<LiveModels>(originV1Url('models')),
  ])
  const liveArr = live.data ?? []
  const liveSet = new Set(liveArr.map(liveKey).filter(Boolean))
  const catModels = cat.models ?? []
  const catKeys = new Set(catModels.map((m) => modelId(m).toLowerCase()))
  const entries: CatalogEntry[] = catModels.map((m) => ({
    ...m,
    // Cross-reference by the stable id (third-party) AND the display name (Zen),
    // so both record shapes resolve their live-availability correctly.
    available: liveSet.has(modelId(m).toLowerCase()) || liveSet.has((m.name ?? '').toLowerCase()),
  }))
  // Merge live-only models the pricing overlay doesn't carry — the CURRENT Zen set
  // (zen5-flash/coder/nano-*) the older bundle omits, and EVERY model when pricing
  // is down. They are servable now, so they list Available under their family.
  // Normalize the OpenAI list shape to the catalog shape (name ← id, provider ←
  // owned_by) so the picker row never renders blank. Deduped by both id and name.
  for (const lm of liveArr) {
    const key = liveKey(lm)
    const nameKey = (lm.name ?? '').trim().toLowerCase()
    if (!key || catKeys.has(key) || (nameKey && catKeys.has(nameKey))) continue
    const id = modelId(lm)
    entries.push({ ...lm, name: (lm.name ?? '').trim() || id, provider: lm.provider ?? lm.owned_by, available: true })
  }
  return entries
}

/** Group a catalog into provider cards, sorted by model count (desc). */
export function groupByProvider(models: CatalogEntry[]): ProviderGroup[] {
  const by = new Map<string, CatalogEntry[]>()
  for (const m of models) {
    const p = (m.provider ?? 'Other').trim() || 'Other'
    const arr = by.get(p)
    if (arr) arr.push(m)
    else by.set(p, [m])
  }
  const groups: ProviderGroup[] = []
  for (const [provider, ms] of by) {
    const inputs = ms.map((m) => m.pricing?.input).filter((x): x is number => typeof x === 'number')
    const ctxs = ms.map((m) => modelContext(m)).filter((x): x is number => typeof x === 'number')
    groups.push({
      provider,
      models: ms,
      count: ms.length,
      minInput: inputs.length ? Math.min(...inputs) : null,
      maxContext: ctxs.length ? Math.max(...ctxs) : null,
      sample: ms.slice(0, 3).map((m) => modelDisplayName(m)),
      verified: ms.some(isZen),
      available: ms.filter((m) => m.available).length,
    })
  }
  return groups.sort((a, b) => b.count - a.count)
}

/** Coarse modality from id/name/category — for the TYPE badge (real, derived from id). */
export function modelType(m: RichModel): string {
  const n = `${m.name ?? ''} ${m.id ?? ''}`.toLowerCase()
  if (n.includes('tts') || n.includes('-asr') || n.includes('audio') || n.includes('whisper') || n.includes('speech'))
    return 'Audio'
  if (n.includes('embed')) return 'Embedding'
  if (n.includes('rerank')) return 'Rerank'
  if (n.includes('image') || n.includes('diffusion') || n.includes('flux') || n.includes('dall'))
    return 'Image'
  if (n.includes('agent')) return 'Agent'
  if (n.includes('vision') || n.includes('-vl') || n.includes('omni') || n.includes('-vision'))
    return 'Vision'
  return 'Text'
}

/** The distinct model types present in a set (for the Type filter). */
export function modelTypes(models: RichModel[]): string[] {
  const set = new Set(models.map(modelType))
  const order = ['Text', 'Vision', 'Image', 'Audio', 'Embedding', 'Rerank', 'Agent']
  return Array.from(set).sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
}

/** Display name for a provider — our own models are branded "Zen", never "Hanzo (Zen)". */
export function displayProvider(provider: string | null | undefined): string {
  const p = (provider ?? '').trim()
  if (!p) return 'Other'
  if (p.toLowerCase() === 'hanzo') return 'Zen'
  return p
}

/** True for our own first-party Zen models (category zen or provider Hanzo/Zen). */
export function isZen(m: RichModel): boolean {
  return (m.category ?? '').toLowerCase() === 'zen' || (m.provider ?? '').toLowerCase() === 'hanzo'
}

// ── Pricing buckets + search (client-side filters over the loaded catalog) ───

/** A coarse price band for the pricing filter. */
export type PriceBucket = 'free' | 'low' | 'mid' | 'high' | 'unknown'

/** The filterable price bands in display order, with human labels. */
export const PRICE_BUCKETS: { key: PriceBucket; label: string }[] = [
  { key: 'free', label: 'Free' },
  { key: 'low', label: '< $1 / Mtok' },
  { key: 'mid', label: '$1–5 / Mtok' },
  { key: 'high', label: '> $5 / Mtok' },
]

/** A coarse minimum-context band for the Providers context filter. */
export type ContextBucket = '32k' | '128k' | '1m'

/** The filterable context bands (minimum tokens), in ascending order. */
export const CONTEXT_BUCKETS: { key: ContextBucket; label: string; min: number }[] = [
  { key: '32k', label: '32K+', min: 32_000 },
  { key: '128k', label: '128K+', min: 128_000 },
  { key: '1m', label: '1M+', min: 1_000_000 },
]

/** Bucket a model by its input price ($/Mtok). `unknown` when unpriced. */
export function priceBucket(m: RichModel): PriceBucket {
  if (m.isFree === true) return 'free'
  const inp = m.pricing?.input
  if (typeof inp !== 'number') return 'unknown'
  if (inp <= 0) return 'free'
  if (inp < 1) return 'low'
  if (inp <= 5) return 'mid'
  return 'high'
}

/** Case-insensitive search over a model's user-visible fields. Empty query matches all. */
export function matchesQuery(m: RichModel, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const hay = [m.name, m.fullName, modelDisplayName(m), m.provider, displayProvider(m.provider), m.description, m.id, m.category]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .join(' ')
    .toLowerCase()
  return hay.includes(needle)
}

// ── Formatters ───────────────────────────────────────────────────────────────

/** "$X.XX" or "—" for a per-Mtok price. */
export function fmtPrice(n: number | null | undefined): string {
  return typeof n === 'number' ? `$${n.toFixed(2)}` : '—'
}

/** "128K" / "1M" compact context. */
export function fmtContext(n: number | null | undefined): string {
  if (typeof n !== 'number' || n <= 0) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`
  return `${Math.round(n / 1000)}K`
}

// ── Plans (subscription tiers + entitlements) ────────────────────────────────

/** Per-tier limits as the live `/v1/plans` surface publishes them (all optional-safe). */
export type PlanLimits = {
  requestsPerMinute?: number
  tokensPerMinute?: number
  freeCredit?: number
  includedCloudCredits?: number
  includedCloudCreditsPerUser?: number
  apiRateLimit?: number
  mcpRateLimit?: number
  maxAlerts?: number
  maxMembers?: number
}

/** One subscription plan as `/v1/plans` returns it (the rpm/tpm/quota rate card). */
export type Plan = {
  id: string
  name: string
  description?: string
  priceMonthly?: number
  priceAnnual?: number
  pricePerUser?: number
  category?: string
  popular?: boolean
  contactSales?: boolean
  features?: string[]
  limits?: PlanLimits
}

/**
 * The org's subscription plans (rpm/tpm/quota tiers) through the authenticated
 * `/ai` proxy. Honest-empty (`[]`) when the surface is gated/not-routed
 * (401/403/404) or otherwise unreachable — plans are enrichment, never primary
 * data, so a failed read degrades a tier badge rather than breaking the page.
 */
export async function fetchPlans(): Promise<Plan[]> {
  try {
    const r = await restGet<{ plans?: Plan[] } | Plan[]>(originV1Url('plans'))
    if (Array.isArray(r)) return r
    return Array.isArray(r?.plans) ? r.plans : []
  } catch {
    return []
  }
}

/**
 * Resolve a model's `tier` string (e.g. "pro max") to the matching subscription
 * plans, so the model detail can show which tiers include it (and their limits).
 * Returns [] when the model has no tier or no plans matched — honest, no guessing.
 */
export function plansForTier(tier: string | null | undefined, plans: Plan[]): Plan[] {
  const ids = (tier ?? '')
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  if (ids.length === 0 || plans.length === 0) return []
  return plans.filter((p) => ids.includes(p.id.toLowerCase()) || ids.includes(p.name.toLowerCase()))
}
