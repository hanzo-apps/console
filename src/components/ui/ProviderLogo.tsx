'use client'

/**
 * ProviderLogo — a small provider/model brand avatar resolved from a provider or
 * family NAME alone (no external logo URLs, no network). Self-contained and
 * prop-driven so it lifts cleanly into `@hanzo/ui` for hanzo.ai / @hanzo/dev /
 * the desktop app.
 *
 * ONE brand registry, resolved in three steps:
 *   1. Normalize the incoming string (a provider like "hanzo"/"qwen", a family
 *      logo key like "OpenAI", or a raw model id like "zen3-vl") to a canonical
 *      brand key — so every surface (catalog, providers, picker, admin) renders
 *      the SAME mark for the SAME brand.
 *   2. First-party marks — **Zen** always renders the ensō (every zen* model, and
 *      the "hanzo"/"zen" providers the Zen records carry), **Hanzo** the block-H —
 *      knocked out of a filled tile so our own models read on-brand.
 *   3. Known third-party family → its brand-colored tile with a crisp monogram
 *      (scannable by colour); truly-unknown → a neutral initials chip.
 *
 * Honest by construction: brand-colored monograms are avatars, not a claim to be
 * an official trademark logo; unknown providers get clean neutral initials, never
 * a guessed brand. Colours are fixed brand hues (not theme tokens) so a brand is
 * the same everywhere; the neutral fallback uses @hanzo/gui theme tokens.
 */
import { Text, XStack, useTheme } from '@hanzo/gui'
import { Server } from '@hanzogui/lucide-icons-2'

/** Canonical brand keys the whole app resolves provider/family strings down to. */
type BrandKey =
  | 'zen' | 'hanzo'
  | 'openai' | 'qwen' | 'deepseek' | 'meta' | 'mistral' | 'google'
  | 'anthropic' | 'zhipu' | 'moonshot' | 'minimax' | 'nvidia' | 'xai' | 'cohere' | 'microsoft'

/**
 * Normalize any provider name / family logo key / model id to a canonical brand.
 * Order matters: first-party (zen/hanzo) first, then substring matches. Returns
 * null when nothing matches (→ neutral initials fallback, kept honest).
 */
function normalizeBrand(raw: string): BrandKey | null {
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
const BRANDS: Record<Exclude<BrandKey, 'zen' | 'hanzo'>, { bg: string; label: string }> = {
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

/** The Zen ensō mark — identical geometry to @zenlm/logo (svg/zen-enso.svg). */
function EnsoMark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d="M66.22 83.26 A37 37 0 1 1 85.57 60.20" fill="none" stroke={color} strokeWidth={11} strokeLinecap="round" />
    </svg>
  )
}

/** The Hanzo block-H mark — identical geometry to @hanzo/logo (app/icon.svg). */
const HANZO_PATHS = [
  'M22.21 67V44.6369H0V67H22.21Z',
  'M66.7038 22.3184H22.2534L0.0878906 44.6367H44.4634L66.7038 22.3184Z',
  'M22.21 0H0V22.3184H22.21V0Z',
  'M66.7198 0H44.5098V22.3184H66.7198V0Z',
  'M66.7198 67V44.6369H44.5098V67H66.7198Z',
]
function HanzoHMark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 67 67" aria-hidden="true">
      {HANZO_PATHS.map((d) => (
        <path key={d} d={d} fill={color} />
      ))}
    </svg>
  )
}

/** 1–2 uppercase initials from a provider name: words→first letters, else first 2 chars. */
export function providerInitials(provider: string): string {
  const name = provider.trim()
  if (!name) return '•'
  const words = name.split(/[\s/_-]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

/** A filled square tile — the shared frame for every mark (keeps sizing DRY). */
function Tile({ size, bg, border, children }: { size: number; bg: string; border?: boolean; children: React.ReactNode }) {
  return (
    <XStack
      width={size}
      height={size}
      items="center"
      justify="center"
      rounded={Math.round(size * 0.28)}
      bg={bg}
      {...(border ? { borderWidth: 1, borderColor: '$borderColor' } : {})}
      style={{ flexShrink: 0 }}
    >
      {children}
    </XStack>
  )
}

export function ProviderLogo({ provider, size = 24 }: { provider: string; size?: number }) {
  const theme = useTheme()
  const brand = normalizeBrand(provider)

  // First-party — the real brand mark knocked out of a filled tile.
  if (brand === 'zen' || brand === 'hanzo') {
    const fg = theme.color1?.get() ?? '#000000' // cut-out mark: the tile's contrast color
    return (
      <Tile size={size} bg="$color12">
        {brand === 'zen'
          ? <EnsoMark size={Math.round(size * 0.66)} color={fg} />
          : <HanzoHMark size={Math.round(size * 0.56)} color={fg} />}
      </Tile>
    )
  }

  // Known third-party family — brand-colored tile + crisp white monogram.
  if (brand) {
    const { bg, label } = BRANDS[brand]
    // Shrink the glyph a touch as the monogram gets longer so 2–3 chars still fit.
    const fontScale = label.length >= 3 ? 0.34 : label.length === 2 ? 0.4 : 0.46
    return (
      <Tile size={size} bg={bg}>
        <Text fontSize={Math.round(size * fontScale)} fontWeight="800" color="#ffffff" style={{ letterSpacing: -0.5 }}>
          {label}
        </Text>
      </Tile>
    )
  }

  // Unknown provider — a clean, stable neutral initials chip (no fabricated brand).
  return (
    <Tile size={size} bg="$color3" border>
      <Text fontSize={Math.round(size * 0.4)} fontWeight="800" color="$color11">
        {providerInitials(provider)}
      </Text>
    </Tile>
  )
}

/** A generic fallback mark for an unspecified provider (used sparingly). */
export function GenericLogo({ size = 24 }: { size?: number }) {
  return (
    <XStack width={size} height={size} items="center" justify="center" rounded={Math.round(size * 0.28)} bg="$color3" borderWidth={1} borderColor="$borderColor">
      <Server size={Math.round(size * 0.56)} color="$color11" />
    </XStack>
  )
}

// Boxes is re-exported as the conventional "custom model" mark for callers that
// render a non-provider tile next to ProviderLogo (keeps the icon source single).
export { Boxes as CustomModelMark } from '@hanzogui/lucide-icons-2'
