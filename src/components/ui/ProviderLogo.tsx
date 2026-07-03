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
 *   2. First-party — **Zen** always renders the ensō (every zen* model, and the
 *      "hanzo"/"zen" providers the Zen records carry), **Hanzo** the block-H —
 *      knocked out of a filled tile so our own models read on-brand.
 *   3. Known third-party family → its brand-colored tile with a crisp monogram
 *      (scannable by colour); truly-unknown → a neutral initials chip.
 */
import { Text, XStack, useTheme } from '@hanzo/gui'
import { Server } from '@hanzogui/lucide-icons-2'

import { normalizeBrand, BRANDS, providerInitials } from './brand'

export { providerInitials } from './brand'

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

/**
 * A filled square tile — the shared frame for every mark (keeps sizing DRY).
 * `bg`/`borderColor` are RAW css colours (theme tokens are resolved to values by
 * the caller via `useTheme`), applied through `style` so a brand hex and a themed
 * colour take the exact same, type-clean path.
 */
function Tile({ size, bg, borderColor, children }: { size: number; bg: string; borderColor?: string; children: React.ReactNode }) {
  return (
    <XStack
      width={size}
      height={size}
      items="center"
      justify="center"
      rounded={Math.round(size * 0.28)}
      style={{ flexShrink: 0, backgroundColor: bg, ...(borderColor ? { borderWidth: 1, borderColor } : {}) }}
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
    const tileBg = theme.color12?.get() ?? '#111111'
    const fg = theme.color1?.get() ?? '#ffffff' // cut-out mark: the tile's contrast color
    return (
      <Tile size={size} bg={tileBg}>
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
