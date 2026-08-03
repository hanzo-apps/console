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
import type { BlendModel } from '~/lib/models/blend'
import { brandForModel, brandLabel } from '~/components/ui/brand'
import catalogFixture from './catalog.data.json'

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
  /**
   * Premium model — requires a PAID (prepaid) balance. The gateway 402s a
   * premium model for a trial-only ($5 welcome) balance, so the playground default
   * must avoid these (see default-model.ts). Absent ⇒ non-premium (servable on trial).
   */
  premium?: boolean
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

/**
 * The GUARANTEED catalog base — a checked-in fixture synced from hanzoai/enso-bench
 * `priors/openrouter_models.json` (see `scripts/sync-models.mjs`), imported at BUILD
 * TIME. It makes the catalog browsable (capabilities + context + price)
 * even when the live gateway is unreachable; the live overlay below always wins where
 * it exists. Every field is copied from the prior — nothing here is fabricated.
 */
const FIXTURE_MODELS: RichModel[] = ((catalogFixture as { models?: RichModel[] }).models ?? [])

/** The live routing/availability key for a model: id (third-party) else name (Zen). */
const liveKey = (m: { id?: string | null; name?: string }): string =>
  (m.id ?? m.name ?? '').trim().toLowerCase()

/**
 * Merge two catalog sources by stable id, PRIMARY winning field-by-field: a model in
 * both keeps `primary`'s fields and inherits only the keys `primary` lacks from
 * `secondary`; a model only in `secondary` is appended. So live pricing always
 * overrides the fixture's, and the fixture only fills what the live catalog omits.
 */
function mergeById(primary: RichModel[], secondary: RichModel[]): RichModel[] {
  const byId = new Map<string, RichModel>()
  for (const m of secondary) byId.set(modelId(m).toLowerCase(), { ...m })
  for (const m of primary) {
    const key = modelId(m).toLowerCase()
    const prev = byId.get(key)
    byId.set(key, prev ? { ...prev, ...m } : { ...m })
  }
  return [...byId.values()]
}

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
 * Assemble the catalog: the guaranteed fixture base, the rich pricing overlay, and the
 * live routing set, in that order of increasing authority. The fixture
 * (`catalog.data.json`) makes the catalog ALWAYS browsable — a full gateway outage
 * degrades to it (every model honestly "Catalog", none "Live") rather than an error
 * card. The rich pricing catalog (`/v1/pricing/models`) overlays fresh name/context/
 * price where present (its fields win over the fixture's); on ingresses where it is
 * unrouted/502 the fixture carries the catalog. The live routing set (`/v1/models`)
 * marks each servable model Available and contributes the current Zen family the older
 * bundles omit; when it too is unreachable, nothing is Live but the catalog still
 * renders. Never throws — the fixture guarantees a non-empty result.
 */
export async function fetchCatalog(): Promise<CatalogEntry[]> {
  const [cat, live] = await Promise.all([
    restGet<PricingCatalog>(originV1Url('pricing/models')).catch(() => ({ models: [] }) as PricingCatalog),
    restGet<LiveModels>(originV1Url('models')).catch(() => ({ data: [] }) as LiveModels),
  ])
  const liveArr = live.data ?? []
  const liveSet = new Set(liveArr.map(liveKey).filter(Boolean))
  // The fixture is the base; live pricing wins where it overlaps, and fills the rest.
  const catModels = mergeById(cat.models ?? [], FIXTURE_MODELS)
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
  // Embedding/retrieval — `embed*`, plus the well-known open embedding families the DO
  // gateway serves under bare model ids (BGE · GTE · E5 · MPNet · MiniLM · multi-qa).
  if (n.includes('embed') || /(^|[\s/-])(bge|gte|e5|mpnet|minilm|mini-lm)([\s/-]|$)/.test(n) || n.includes('multi-qa'))
    return 'Embedding'
  if (n.includes('rerank')) return 'Rerank'
  // Video generation (`t2v`/`i2v`/wan/sora/veo) — before Image so a text-to-video model
  // isn't mistaken for a chat "Text" model and leaked into the chat browser.
  if (n.includes('video') || n.includes('t2v') || n.includes('i2v') || n.includes('wan2') || n.includes('sora') || n.includes('veo'))
    return 'Video'
  if (n.includes('image') || n.includes('diffusion') || n.includes('flux') || n.includes('dall'))
    return 'Image'
  if (n.includes('agent')) return 'Agent'
  if (n.includes('vision') || n.includes('-vl') || n.includes('omni') || n.includes('-vision'))
    return 'Vision'
  return 'Text'
}

/**
 * Does the model accept IMAGE INPUT? Read from the catalog's own `features` list
 * first (the authoritative field when the upstream publishes it), falling back to the
 * id/name modality derived by `modelType`.
 *
 * Note this is INPUT capability: an image-GENERATION model ("Image") is not a
 * vision-capable chat model and is deliberately excluded.
 */
export function supportsVision(m: RichModel): boolean {
  const feats = (m.features ?? []).map((f) => f.toLowerCase())
  if (feats.some((f) => f.includes('vision') || f.includes('image') || f.includes('multimodal')))
    return true
  return modelType(m) === 'Vision'
}

/**
 * Project a catalog row onto the model shape the blend reasons about (id + vendor +
 * the two prices). One projection, so the blend builder and the router agree on which
 * price a tier band is computed from — the LIVE catalog price, never a stale table.
 *
 * The vendor is resolved IDENTITY-FIRST via `brandForModel` — the same resolver the
 * avatar uses — so a gateway-served model (tagged provider "hanzo") reads as its TRUE
 * vendor. Resolving from the provider string alone would label a Zhipu or Moonshot
 * model "Zen" beside its own Zhipu/Moonshot logo, the exact mismatch `brandLabel`
 * exists to prevent. Falls back to the provider when the id carries no vendor tell.
 */
export function toBlendModel(m: CatalogEntry): BlendModel {
  const id = modelId(m)
  const brand = brandForModel(id, m.provider ?? '')
  return {
    id,
    name: modelDisplayName(m),
    vendor: brand ? brandLabel(brand) : displayProvider(m.provider),
    priceIn: typeof m.pricing?.input === 'number' ? m.pricing.input : null,
    priceOut: typeof m.pricing?.output === 'number' ? m.pricing.output : null,
  }
}

/** The distinct model types present in a set (for the Type filter). */
export function modelTypes(models: RichModel[]): string[] {
  const set = new Set(models.map(modelType))
  const order = ['Text', 'Vision', 'Image', 'Video', 'Audio', 'Embedding', 'Rerank', 'Agent']
  return Array.from(set).sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
}

/** Display name for a provider — our own models are branded "Zen", never "Hanzo (Zen)";
 *  the raw DigitalOcean gateway tag reads as "DigitalOcean AI" (the vendor of the
 *  proxied third-party models is resolved per-model by the brand resolver, not here). */
export function displayProvider(provider: string | null | undefined): string {
  const p = (provider ?? '').trim()
  if (!p) return 'Other'
  const lower = p.toLowerCase()
  if (lower === 'hanzo') return 'Zen'
  if (lower === 'do-ai') return 'DigitalOcean AI'
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
  /** Limited-time promo: percent off the list price through promoUntil (RFC3339). */
  promoPercent?: number
  promoUntil?: string
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
