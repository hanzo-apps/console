/**
 * Model families — the ONE curated grouping the unified model browser renders,
 * identical to hanzo.chat's picker: the house-brand **Zen** first, then the
 * independent third-party families the same api.hanzo.ai gateway serves
 * (Qwen · Meta Llama · DeepSeek · Mistral · Google Gemma · OpenAI GPT-OSS).
 *
 * Data-driven, not hard-coded: membership comes from the LIVE catalog
 * (`fetchCatalog` → `/v1/pricing/models` joined with `/v1/models`), each model
 * assigned to the FIRST family whose matcher it satisfies. A family with zero
 * live models is dropped (honest — never an empty "Qwen" header), so the browser
 * shows exactly the families the gateway actually serves for the caller's org.
 *
 * Curation rule (matches chat exactly):
 *   - Provider-defined families (Qwen/Meta/DeepSeek/Mistral) match on the catalog
 *     `provider` string, so a Qwen-distilled DeepSeek stays in DeepSeek (its
 *     provider), and the HuggingFace-hub mirror (provider "HuggingFace") is left
 *     out of the curated set.
 *   - Subset families match a NAMED slice of a broader provider: "Google Gemma"
 *     is the `gemma-*` slice of Google (not Gemini); "OpenAI GPT-OSS" the
 *     `gpt-oss-*` slice of OpenAI (not GPT-4o/5). This is why provider-grouping
 *     alone can't reproduce chat's set — the taxonomy is curated here, once.
 *   - Zen matches by id/name (`zen*`) OR provider hanzo/zen — the catalog's own
 *     Zen records carry NO provider, so the name prefix is authoritative.
 *
 * Only CURRENT-GEN CHAT models list: non-chat modalities (embedding · rerank ·
 * tts · asr/audio · image · guard/moderation) and sunset generations
 * (zen4-*, qwen2-*) are filtered out, mirroring the task's rule.
 *
 * Pure + unit-tested — no IO, no host coupling. The view layer (ModelCatalogModule)
 * just renders `groupByFamily(catalog)`.
 */
import { modelId, modelType, type CatalogEntry } from './aicatalog'

/** The default model surfaced first in the house Zen family (chat's default). */
export const DEFAULT_MODEL = 'zen5-mini'

/** One curated family: a stable id, a display label, and a membership matcher. */
export type Family = {
  /** Stable family key (routing/testing). */
  id: string
  /** Display label — exactly as chat's picker groups them. */
  label: string
  /** Provider name `ProviderLogo` renders for the family header mark. */
  logo: string
  /**
   * True when a catalog model belongs to this family. `id` is the lowercased
   * stable id/name; `provider` is the lowercased provider string ('' when the
   * record carries none, as the Zen records do).
   */
  match: (id: string, provider: string) => boolean
}

const has = (s: string, ...subs: string[]): boolean => subs.some((x) => s.includes(x))

/**
 * The families in DISPLAY ORDER — Zen (house brand) first, then the third-party
 * families in chat's order. A model is assigned to the FIRST match, so order also
 * disambiguates overlaps.
 */
export const FAMILIES: Family[] = [
  {
    id: 'zen',
    label: 'Zen',
    logo: 'zen',
    // The catalog's Zen records carry no provider, so the id/name prefix is
    // authoritative; the live `/v1/models` set additionally tags them "hanzo".
    match: (id, p) => p === 'hanzo' || p === 'zen' || /^zen\d/.test(id),
  },
  { id: 'qwen', label: 'Qwen', logo: 'Qwen', match: (_id, p) => p === 'qwen' },
  { id: 'llama', label: 'Meta Llama', logo: 'Meta', match: (_id, p) => p === 'meta' || p === 'meta llama' },
  { id: 'deepseek', label: 'DeepSeek', logo: 'DeepSeek', match: (_id, p) => p === 'deepseek' },
  { id: 'mistral', label: 'Mistral', logo: 'Mistral', match: (_id, p) => p === 'mistral' || p === 'mistral ai' },
  // Named slices of a broader provider — the id carries the family, not the provider.
  { id: 'gemma', label: 'Google Gemma', logo: 'Google', match: (id, p) => p === 'google' && has(id, 'gemma') },
  { id: 'gptoss', label: 'OpenAI GPT-OSS', logo: 'OpenAI', match: (id, p) => p === 'openai' && has(id, 'gpt-oss') },
]

/** The family a model belongs to (first match in display order), or null. PURE. */
export function familyOf(m: CatalogEntry): Family | null {
  const id = modelId(m).toLowerCase()
  const provider = (m.provider ?? '').trim().toLowerCase()
  for (const f of FAMILIES) if (f.match(id, provider)) return f
  return null
}

/**
 * True for a chat-capable model — Text or Vision (VL/omni). Non-chat modalities
 * (embedding · rerank · audio/tts/asr · image) and guard/moderation models are
 * excluded, so the browser lists only models you can actually chat/agent with.
 * PURE.
 */
export function isChatModel(m: CatalogEntry): boolean {
  const kind = modelType(m) // Text | Vision | Image | Audio | Embedding | Rerank | Agent
  if (kind !== 'Text' && kind !== 'Vision') return false
  const id = `${modelId(m)} ${m.name ?? ''}`.toLowerCase()
  return !has(id, 'guard', 'moderation', 'safeguard')
}

/**
 * True for a CURRENT-GEN model — sunset generations are dropped: Zen 4 (garbage
 * output, superseded by zen5/zen3) and Qwen 2 (house rule: qwen3+ only). PURE.
 */
export function isCurrentGen(m: CatalogEntry): boolean {
  const id = modelId(m).toLowerCase()
  if (/(^|[\/-])zen4/.test(id)) return false
  if (/qwen-?2(\.|-|$)/.test(id)) return false
  return true
}

/** True for a duplicate free-tier alias (`…:free`) — collapsed to its priced twin. */
export function isFreeAlias(m: CatalogEntry): boolean {
  return modelId(m).toLowerCase().endsWith(':free')
}

/** A family with its resolved, sorted member models (for the browser sections). */
export type FamilyGroup = {
  id: string
  label: string
  logo: string
  models: CatalogEntry[]
  /** How many of the family's models are servable right now (live). */
  available: number
}

/** Available-first, then Zen `mini` default up top, then name asc. PURE. */
function sortMembers(models: CatalogEntry[]): CatalogEntry[] {
  return [...models].sort((a, b) => {
    const av = Number(b.available) - Number(a.available)
    if (av) return av
    const da = modelId(a).toLowerCase() === DEFAULT_MODEL ? -1 : 0
    const db = modelId(b).toLowerCase() === DEFAULT_MODEL ? -1 : 0
    if (da !== db) return da - db
    return (a.name ?? modelId(a)).localeCompare(b.name ?? modelId(b))
  })
}

/**
 * Group the catalog into the curated families, in display order (Zen first),
 * keeping only current-gen chat models and dropping empty families. PURE — the
 * ONE place the browser's grouping is decided.
 */
export function groupByFamily(catalog: CatalogEntry[]): FamilyGroup[] {
  const buckets = new Map<string, CatalogEntry[]>()
  for (const m of catalog) {
    if (!isChatModel(m) || !isCurrentGen(m) || isFreeAlias(m)) continue
    const fam = familyOf(m)
    if (!fam) continue
    const arr = buckets.get(fam.id)
    if (arr) arr.push(m)
    else buckets.set(fam.id, [m])
  }
  const out: FamilyGroup[] = []
  for (const f of FAMILIES) {
    const models = buckets.get(f.id)
    if (!models || models.length === 0) continue
    const sorted = sortMembers(models)
    out.push({ id: f.id, label: f.label, logo: f.logo, models: sorted, available: sorted.filter((m) => m.available).length })
  }
  return out
}

/** Filter grouped families by a query (name/id/provider), dropping empty families. PURE. */
export function filterFamilies(groups: FamilyGroup[], q: string): FamilyGroup[] {
  const t = q.trim().toLowerCase()
  if (!t) return groups
  const out: FamilyGroup[] = []
  for (const g of groups) {
    const models = g.models.filter((m) => {
      const hay = `${modelId(m)} ${m.name ?? ''} ${m.provider ?? ''} ${g.label}`.toLowerCase()
      return hay.includes(t)
    })
    if (models.length) out.push({ ...g, models, available: models.filter((m) => m.available).length })
  }
  return out
}

/** Total models across families (the browser's "N models" header). PURE. */
export function totalModels(groups: FamilyGroup[]): number {
  return groups.reduce((n, g) => n + g.models.length, 0)
}
