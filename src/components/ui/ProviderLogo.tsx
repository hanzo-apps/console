'use client'

/**
 * ProviderLogo — a small provider/model brand avatar resolved from a provider or
 * family NAME alone (no external logo URLs, no network). Self-contained and
 * prop-driven so it lifts cleanly into `@hanzo/ui` for hanzo.ai / @hanzo/dev /
 * the desktop app.
 *
 * The pure brand resolution lives in ./brand (unit tested). This is the render
 * layer, three steps:
 *   1. Normalize the string → a canonical brand key (`normalizeBrand`).
 *   2. First-party — **Zen** (the house brand) and **Hanzo** both render the Hanzo
 *      block-H, knocked out of a filled tile so our own models read on-brand. Per
 *      the repo brand policy Zen NEVER carries an upstream family glyph.
 *   3. Known third-party family → its brand-colored tile with its OWN distinct,
 *      recognizable mark (`BRAND_MARK`), or a crisp monogram when no mark is curated
 *      (still scannable by colour); truly-unknown → a neutral initials chip.
 */
import { Text, XStack, useTheme } from '@hanzo/gui'

import { normalizeBrand, brandForModel, BRANDS, providerInitials } from './brand'
import { BRAND_MARK, type BrandMark } from './brand-marks'
import { tileRadius } from './color'

export { providerInitials } from './brand'

/**
 * A curated per-family mark — the inner SVG is a build-time-trusted constant
 * (`brand-marks.ts`), never user input, so inlining it is safe (same pattern as
 * `BrandLogo`). `currentColor` in the body → the caller controls the fill.
 */
function BrandGlyph({ mark, size, color }: { mark: BrandMark; size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={mark.viewBox}
      aria-hidden="true"
      style={{ color, display: 'block' }}
      dangerouslySetInnerHTML={{ __html: mark.body }}
    />
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

/**
 * The Slack multicolor octothorpe — our own inline draw of the canonical 4-color
 * mark (no external asset, no trademark file). Four brand hues, two lobes each.
 * Used by the org Integrations provider cards.
 */
function SlackMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 122.8 122.8" aria-hidden="true">
      <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zM32.3 77.6c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#E01E5A" />
      <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zM45.2 32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36C5F0" />
      <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zM90.5 45.2c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2EB67D" />
      <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zM77.6 90.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ECB22E" />
    </svg>
  )
}

/** The GitHub octocat — our own inline draw (single path, tinted `color`). */
function GitHubMark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 98 96" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill={color}
        d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
      />
    </svg>
  )
}

/**
 * A filled square tile — the shared frame for every mark (keeps sizing DRY).
 * `bg`/`borderColor` are RAW css colours (theme tokens are resolved to values by
 * the caller via `useTheme`), applied through `style` so a brand hex and a themed
 * colour take the exact same, type-clean path.
 */
function Tile({ size, bg, borderColor, children }: { size: number; bg: string; borderColor?: string; children: React.ReactNode }) {
  return (
    // `data-monogram` marks this as a GRAPHIC, not app text: the initials inside
    // scale with the tile (a fixed 11px monogram in a 40px circle reads broken),
    // so the design gate exempts it from the type scale. One marker, one meaning.
    <XStack
      data-monogram
      width={size}
      height={size}
      items="center"
      justify="center"
      rounded={tileRadius(size)}
      style={{ flexShrink: 0, backgroundColor: bg, ...(borderColor ? { borderWidth: 1, borderColor } : {}) }}
    >
      {children}
    </XStack>
  )
}

export function ProviderLogo({
  provider,
  model,
  size = 24,
  mono = false,
}: {
  /** The provider/family/vendor NAME (a group-level tell, e.g. "OpenAI", "Anthropic"). */
  provider: string
  /**
   * Optional MODEL id/name (e.g. `anthropic/claude-opus-4.6`, `qwen3.5-397b`). When
   * given, the model identity resolves the brand FIRST — so a model served through the
   * Hanzo gateway (tagged provider "hanzo") shows its TRUE vendor, not the house mark.
   */
  model?: string
  size?: number
  /**
   * Monochrome — render every family mark on a neutral tile in the theme foreground
   * colour instead of the brand hue. The unified model selector (hanzo.chat-style,
   * one calm mark per family) uses this so the list reads as ONE system, not a
   * confetti of vendor hues. The mark GEOMETRY is unchanged, only the colour.
   */
  mono?: boolean
}) {
  const theme = useTheme()
  const brand = model && model.trim() ? brandForModel(model, provider) : normalizeBrand(provider)

  // Monochrome tile treatment (shared by every family branch below when `mono`).
  const monoTileBg = theme.color3?.get() ?? '#e5e5e5'
  const monoFg = theme.color12?.get() ?? '#111111'

  // Integration provider glyphs — our own inline SVG marks (no external asset). Slack
  // reads on a white tile (with a subtle border so it doesn't float on dark), GitHub
  // as a white octocat on the near-black GitHub tile.
  const key = provider.trim().toLowerCase()
  if (key === 'slack') {
    const border = theme.borderColor?.get() ?? 'rgba(0,0,0,0.1)'
    return (
      <Tile size={size} bg="#ffffff" borderColor={border}>
        <SlackMark size={Math.round(size * 0.62)} />
      </Tile>
    )
  }
  if (key === 'github' || key === 'gh') {
    return (
      <Tile size={size} bg="#181717">
        <GitHubMark size={Math.round(size * 0.62)} color="#ffffff" />
      </Tile>
    )
  }

  // First-party house — Zen, Hanzo, and Enso all render the block-H mark, knocked out
  // of a filled tile so our own models read on-brand. They NEVER show an upstream
  // family glyph (brand policy) — the house IS the Hanzo mark.
  if (brand === 'zen' || brand === 'hanzo' || brand === 'enso') {
    const tileBg = mono ? monoTileBg : theme.color12?.get() ?? '#111111'
    const fg = mono ? monoFg : theme.color1?.get() ?? '#ffffff' // cut-out mark: the tile's contrast color
    return (
      <Tile size={size} bg={tileBg}>
        <HanzoHMark size={Math.round(size * 0.56)} color={fg} />
      </Tile>
    )
  }

  // Known third-party family — brand-colored tile with its OWN distinct mark (a
  // recognizable monochrome glyph), or a crisp white monogram when no mark is curated.
  // In `mono`, the SAME mark renders in the theme foreground on a neutral tile.
  if (brand) {
    const { bg, label } = BRANDS[brand]
    const mark = BRAND_MARK[brand]
    const tileBg = mono ? monoTileBg : bg
    const fg = mono ? monoFg : '#ffffff'
    if (mark) {
      return (
        <Tile size={size} bg={tileBg}>
          <BrandGlyph mark={mark} size={Math.round(size * 0.66)} color={fg} />
        </Tile>
      )
    }
    // Shrink the glyph a touch as the monogram gets longer so 2–3 chars still fit.
    const fontScale = label.length >= 3 ? 0.34 : label.length === 2 ? 0.4 : 0.46
    // `fg` is a runtime string (brand white or the mono theme fg), so it rides `style`
    // — the strict Tamagui `color` prop only takes a token/literal (like the neutral chip).
    return (
      <Tile size={size} bg={tileBg}>
        <Text fontSize={Math.round(size * fontScale)} fontWeight="800" style={{ letterSpacing: -0.5, color: fg }}>
          {label}
        </Text>
      </Tile>
    )
  }

  // Unknown provider — a clean, stable neutral initials chip (no fabricated brand).
  const neutralBg = theme.color3?.get() ?? '#e5e5e5'
  const neutralBorder = theme.borderColor?.get() ?? 'rgba(0,0,0,0.1)'
  const neutralFg = theme.color11?.get() ?? '#555555'
  return (
    <Tile size={size} bg={neutralBg} borderColor={neutralBorder}>
      <Text fontSize={Math.round(size * 0.4)} fontWeight="800" style={{ color: neutralFg }}>
        {providerInitials(provider)}
      </Text>
    </Tile>
  )
}

// Boxes is re-exported as the conventional "custom model" mark for callers that
// render a non-provider tile next to ProviderLogo (keeps the icon source single).
