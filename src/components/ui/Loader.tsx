'use client'

/**
 * Brand loader — the monochrome Hanzo ▼/H mark, centered and correctly sized.
 *
 * One loader for every full-screen "still loading" state (the auth gate, the
 * OAuth callback). The mark renders at ~48px — a reasonably sized centered
 * loader, not a viewport-filling spinner — filled with the theme's high-contrast
 * `$color12` (white on dark, near-black on light).
 */
import { Text, YStack, useTheme } from '@hanzo/gui'

/** The five-path Hanzo mark — identical geometry to `app/icon.svg`. */
const MARK_PATHS = [
  'M22.21 67V44.6369H0V67H22.21Z',
  'M66.7038 22.3184H22.2534L0.0878906 44.6367H44.4634L66.7038 22.3184Z',
  'M22.21 0H0V22.3184H22.21V0Z',
  'M66.7198 0H44.5098V22.3184H66.7198V0Z',
  'M66.7198 67V44.6369H44.5098V67H66.7198Z',
]

/** The monochrome Hanzo mark as an inline SVG, sized in px. */
export function HanzoMark({ size = 48 }: { size?: number }) {
  const theme = useTheme()
  const fill = theme.color12?.get() ?? '#ffffff'
  return (
    <svg width={size} height={size} viewBox="0 0 67 67" style={{ fill }} role="img" aria-label="Hanzo">
      {MARK_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

/** Full-screen centered brand loader with an optional label. */
export function Loader({ label, size = 48 }: { label?: string; size?: number }) {
  return (
    <YStack flex={1} minH="100vh" items="center" justify="center" gap="$3">
      <style>
        {'@keyframes hz-pulse{0%,100%{opacity:.45}50%{opacity:1}}.hz-pulse{animation:hz-pulse 1.4s ease-in-out infinite;display:inline-flex}'}
      </style>
      <div className="hz-pulse">
        <HanzoMark size={size} />
      </div>
      {label ? (
        <Text fontSize="$3" color="$color11">
          {label}
        </Text>
      ) : null}
    </YStack>
  )
}
