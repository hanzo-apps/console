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
  | 'zen' | 'hanzo'
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
  // First-party. A zen* model id or the zen/zenlm provider → Zen (ensō). Bare
  // "hanzo" (the company/gateway provider, non-model surfaces) → the block-H.
  if (p === 'zen' || p === 'zenlm' || /^zen[\d-]/.test(p)) return 'zen'
  if (p === 'hanzo') return 'hanzo'
  // Third-party families (match provider strings AND their model-name tells).
  if (p.includes('openai') || p.includes('gpt')) return 'openai'
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

/** Brand-colored monogram tiles for third-party families. Fixed brand hues. */
export const BRANDS: Record<Exclude<BrandKey, 'zen' | 'hanzo'>, { bg: string; label: string }> = {
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

/** 1–2 uppercase initials from a provider name: words→first letters, else first 2 chars. */
export function providerInitials(provider: string): string {
  const name = provider.trim()
  if (!name) return '•'
  const words = name.split(/[\s/_-]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}
