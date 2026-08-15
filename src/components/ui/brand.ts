/**
 * Brand resolution — the ONE pure place a provider/family/model string becomes a
 * canonical brand + its avatar treatment. No GUI, no JSX, no IO, so it is unit
 * tested directly and reused by every surface (ProviderLogo renders it).
 *
 * Honest by construction: brand-colored monograms are avatars, not a claim to be
 * an official trademark logo; a string that matches no brand returns null so the
 * view falls back to neutral initials rather than a guessed logo.
 */

/** Canonical brand keys the whole app resolves provider/family strings down to. */
export type BrandKey =
  | 'zen' | 'hanzo' | 'enso'
  | 'openai' | 'qwen' | 'deepseek' | 'meta' | 'mistral' | 'google'
  | 'anthropic' | 'zhipu' | 'moonshot' | 'minimax' | 'nvidia' | 'xai' | 'cohere' | 'microsoft'

/**
 * Normalize any provider name / family logo key / model id to a canonical brand.
 * Order matters: first-party (zen/hanzo) first, then substring matches. Returns
 * null when nothing matches (→ neutral initials fallback, kept honest).
 */
export function normalizeBrand(raw: string): BrandKey | null {
  const p = raw.trim().toLowerCase()
  if (!p) return null
  // First-party house brands. Enso is the current house model line (`enso`,
  // `enso-mini`, …); it renders the Hanzo mark like Zen but is its OWN family so it
  // surfaces first in the picker. A zen* model id or the zen/zenlm provider → Zen
  // (the legacy house brand, also the Hanzo mark). Bare "hanzo" (the company/gateway
  // provider) → the same block-H. None of these resolve to an upstream family.
  if (p === 'enso' || /^enso([\d.\-]|$)/.test(p)) return 'enso'
  if (p === 'zen' || p === 'zenlm' || /^zen[\d-]/.test(p)) return 'zen'
  if (p === 'hanzo') return 'hanzo'
  // Third-party families (match provider strings AND their model-name tells).
  // OpenAI: the `gpt*` line AND the reasoning `o`-series (`o1`, `o3`, `o3-mini`, `o4-mini`)
  // whose ids carry no "gpt"/"openai" tell — matched by the `o<digit>` prefix (not "omni").
  if (p.includes('openai') || p.includes('gpt') || /^o[1-9]([.\-]|$)/.test(p)) return 'openai'
  if (p.includes('qwen') || p.includes('tongyi') || p.includes('alibaba') || p.includes('qwq')) return 'qwen'
  if (p.includes('deepseek')) return 'deepseek'
  if (p.includes('meta') || p.includes('llama')) return 'meta'
  if (p.includes('mistral') || p.includes('mixtral') || p.includes('magistral') || p.includes('codestral')) return 'mistral'
  if (p.includes('google') || p.includes('gemma') || p.includes('gemini')) return 'google'
  if (p.includes('anthropic') || p.includes('claude')) return 'anthropic'
  if (p.includes('zhipu') || p.includes('glm')) return 'zhipu'
  if (p.includes('moonshot') || p.includes('kimi')) return 'moonshot'
  if (p.includes('minimax')) return 'minimax'
  if (p.includes('nvidia') || p.includes('nemotron')) return 'nvidia'
  if (p.includes('xai') || p.includes('grok')) return 'xai'
  if (p.includes('cohere') || p.includes('command')) return 'cohere'
  if (p.includes('microsoft') || p.includes('phi-') || p === 'phi') return 'microsoft'
  return null
}

/**
 * Resolve the brand for a specific catalog MODEL. The model IDENTITY (its stable id
 * or name — e.g. `anthropic/claude-opus-4.6`, `openai/gpt-5`, `google/gemini-2.5-pro`,
 * `qwen3.5-397b`, `glm-5.2`) is authoritative and tried FIRST, so a model served
 * through the Hanzo gateway — which tags it provider "hanzo" — is NOT shadowed into
 * the house brand: its real vendor still wins. Falls back to the provider string,
 * then null (→ neutral initials). Zen ids (`zen*`) and genuinely-Hanzo models with no
 * third-party tell keep resolving to the house brand exactly as before. This is why a
 * new gateway model resolves on its own — keyed by id/prefix, not a per-model map.
 */
export function brandForModel(idOrName: string, provider: string): BrandKey | null {
  return normalizeBrand(idOrName) ?? normalizeBrand(provider)
}

/** Brand-colored monogram tiles, one per family that has a maker of its own. Hanzo's
 *  own (hanzo/enso) render the block-H instead and take no hue. Zen's hue is Zoo's
 *  primary green (@zooai/logo `getColorSVG`), so the tile agrees with the mark. */
export const BRANDS: Record<Exclude<BrandKey, 'hanzo' | 'enso'>, { bg: string; label: string }> = {
  // Zen's ground is DARK because its mark carries its own colour (see
  // `COLOR_MARK` in ProviderLogo): the house block-H is a knockout on a light
  // tile, and Zen is the inverse — Zoo's colour mark on a dark one. A green
  // ground here was a hand-picked stand-in for a mark we already publish.
  zen:       { bg: '#0A0A0B', label: 'Z' },
  openai:    { bg: '#000000', label: 'AI' },
  qwen:      { bg: '#615CED', label: 'Q' },
  deepseek:  { bg: '#4D6BFE', label: 'DS' },
  meta:      { bg: '#0866FF', label: 'Me' },
  mistral:   { bg: '#FA520F', label: 'Mi' },
  google:    { bg: '#1A73E8', label: 'G' },
  anthropic: { bg: '#D97757', label: 'A' },
  zhipu:     { bg: '#3859FF', label: 'GLM' },
  moonshot:  { bg: '#16171B', label: 'K' },
  minimax:   { bg: '#E1483B', label: 'MM' },
  nvidia:    { bg: '#76B900', label: 'nV' },
  xai:       { bg: '#111111', label: 'x' },
  cohere:    { bg: '#39594D', label: 'co' },
  microsoft: { bg: '#0067B8', label: 'Ph' },
}

/**
 * Full vendor display name per brand — for a MODEL card's provider label, so a
 * gateway-served third-party model reads as its true vendor ("Qwen") rather than the
 * house label. These are FAMILY names — what the models are called — which is what a
 * picker groups by. Who BUILT the family is a different fact; see `BRAND_MAKER`.
 */
export const BRAND_LABEL: Record<BrandKey, string> = {
  zen: 'Zen',
  hanzo: 'Zen',
  enso: 'Enso',
  openai: 'OpenAI',
  qwen: 'Qwen',
  deepseek: 'DeepSeek',
  meta: 'Meta',
  mistral: 'Mistral',
  google: 'Google',
  anthropic: 'Anthropic',
  zhipu: 'Zhipu',
  moonshot: 'Moonshot',
  minimax: 'MiniMax',
  nvidia: 'NVIDIA',
  xai: 'xAI',
  cohere: 'Cohere',
  microsoft: 'Microsoft',
}

/** The full vendor display name for a resolved brand key. */
export function brandLabel(brand: BrandKey): string {
  return BRAND_LABEL[brand]
}

/**
 * Who BUILDS a family, when that is not what the family is called.
 *
 * Zen is Zoo Labs': Hanzo serves it through the gateway, Zoo builds it, and a label
 * that says "Zen" answers "which models" while a maker answers "whose". Enso is the
 * router Hanzo builds, and bare `hanzo` is the gateway itself — both are Hanzo's.
 * Anything absent here is a family whose name IS its maker's (DeepSeek, Mistral,
 * Anthropic …), so it falls through to `brandLabel` rather than being restated.
 */
export const BRAND_MAKER: Partial<Record<BrandKey, string>> = {
  zen: 'Zoo Labs',
  enso: 'Hanzo',
  hanzo: 'Hanzo',
}

/** The company behind a brand — its maker when that differs, else the family name. */
export function brandMaker(brand: BrandKey): string {
  return BRAND_MAKER[brand] ?? BRAND_LABEL[brand]
}

/**
 * Does this brand render Hanzo's block-H rather than a mark of its own?
 *
 * Only what Hanzo BUILDS does: the gateway brand and the Enso router. It lived as a
 * condition inside ProviderLogo's JSX, where the one rule that decides whose logo
 * appears on whose model could not be read or tested without a DOM. It is a fact
 * about brands, so it lives with the brands.
 *
 * A type PREDICATE, not a bool: narrowing it leaves `Exclude<BrandKey,'hanzo'|'enso'>`,
 * which is exactly `BRANDS`' key type — so the compiler, not a reviewer, is what stops
 * a hue tile being looked up for a brand that has none.
 */
export function usesHouseMark(brand: BrandKey): brand is 'hanzo' | 'enso' {
  return brand === 'hanzo' || brand === 'enso'
}

/** 1–2 uppercase initials from a provider name: words→first letters, else first 2 chars. */
export function providerInitials(provider: string): string {
  const name = provider.trim()
  if (!name) return '•'
  const words = name.split(/[\s/_-]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}
