/**
 * AI catalog — the REAL rich model + provider data behind the Models and
 * Providers pages. One source: the cloud `/v1/pricing/models` catalog (served
 * through the `/ai` proxy so the user bearer is attached), which carries the full
 * metadata each page renders — name, fullName, description, category, context,
 * provider, specs (arch/params), tier, and per-Mtok pricing. Nothing is
 * fabricated: if the endpoint is unreachable the pages show an honest empty state.
 *
 * Availability is cross-referenced with the live `/v1/models` routing set: a
 * catalog model is "Available" iff it is actually servable right now.
 */
import { restGet, aiV1Url } from './client'

/** A model as the rich pricing catalog publishes it. All fields optional-safe. */
export type RichModel = {
  name: string
  fullName?: string | null
  description?: string
  category?: string
  context?: number | null
  provider?: string
  tier?: string | null
  specs?: { arch?: string; params?: string }
  features?: string[]
  pricing?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
}

type PricingCatalog = { models?: RichModel[]; total?: number; updated?: string }
type LiveModels = { data?: Array<{ id: string }> }

/** A catalog model joined with its live-availability flag. */
export type CatalogEntry = RichModel & { available: boolean }

/** Providers grouped from the catalog — what the Providers "Explore" grid renders. */
export type ProviderGroup = {
  provider: string
  models: RichModel[]
  count: number
  /** Cheapest input price across the group ($/Mtok), or null when none priced. */
  minInput: number | null
  /** Largest context across the group (tokens), or null. */
  maxContext: number | null
  /** A few model display names for the card chips. */
  sample: string[]
}

/** Fetch the rich catalog + the live set; join availability. Throws on catalog failure. */
export async function fetchCatalog(): Promise<CatalogEntry[]> {
  const [cat, live] = await Promise.all([
    restGet<PricingCatalog>(aiV1Url('pricing/models')),
    restGet<LiveModels>(aiV1Url('models')).catch(() => ({ data: [] }) as LiveModels),
  ])
  const liveSet = new Set((live.data ?? []).map((m) => m.id.toLowerCase()))
  return (cat.models ?? []).map((m) => ({
    ...m,
    available: liveSet.has(m.name.toLowerCase()),
  }))
}

/** Group a catalog into provider cards, sorted by model count (desc). */
export function groupByProvider(models: RichModel[]): ProviderGroup[] {
  const by = new Map<string, RichModel[]>()
  for (const m of models) {
    const p = (m.provider ?? 'Other').trim() || 'Other'
    const arr = by.get(p)
    if (arr) arr.push(m)
    else by.set(p, [m])
  }
  const groups: ProviderGroup[] = []
  for (const [provider, ms] of by) {
    const inputs = ms.map((m) => m.pricing?.input).filter((x): x is number => typeof x === 'number')
    const ctxs = ms.map((m) => m.context).filter((x): x is number => typeof x === 'number')
    groups.push({
      provider,
      models: ms,
      count: ms.length,
      minInput: inputs.length ? Math.min(...inputs) : null,
      maxContext: ctxs.length ? Math.max(...ctxs) : null,
      sample: ms.slice(0, 3).map((m) => m.name),
    })
  }
  return groups.sort((a, b) => b.count - a.count)
}

/** Coarse modality from name/category — for the TYPE badge (real, derived from id). */
export function modelType(m: RichModel): string {
  const n = m.name.toLowerCase()
  if (n.includes('tts') || n.includes('-asr') || n.includes('audio') || n.includes('whisper')) return 'Audio'
  if (n.includes('embed')) return 'Embedding'
  if (n.includes('rerank')) return 'Rerank'
  if (n.includes('agent')) return 'Agent'
  if (n.includes('image') || n.includes('vision') || n.includes('-vl') || n.includes('omni') || n.includes('diffusion'))
    return 'Vision'
  return 'Text'
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
