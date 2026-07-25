'use client'

/**
 * Brand loader — the resolved brand's mark.
 *
 * console2 is brand-aware (`config.brand` ∈ hanzo | lux | zoo | pars, from the
 * hostname), so the mark follows the brand: each brand's OWN published,
 * self-contained animated SVG — the logo IS that brand's "AI" you can play with
 * (it animates in on load, flourishes on hover, squashes on press; pure CSS, no
 * JS). A static block-H renders during SSR / first paint (no hydration mismatch),
 * then upgrades to the brand's interactive animated mark on mount.
 */
import { useEffect, useState } from 'react'

import { Text, YStack, useTheme } from '@hanzo/gui'
import { getAnimatedSVG as hanzoAnimated } from '@hanzo/logo'
import { getAnimatedSVG as luxAnimated } from '@luxfi/logo'
import { getAnimatedSVG as zooAnimated } from '@zooai/logo'

import { config } from '~/config'

/** The five-path Hanzo mark — identical geometry to `app/icon.svg` (SSR fallback). */
const MARK_PATHS = [
  'M22.21 67V44.6369H0V67H22.21Z',
  'M66.7038 22.3184H22.2534L0.0878906 44.6367H44.4634L66.7038 22.3184Z',
  'M22.21 0H0V22.3184H22.21V0Z',
  'M66.7198 0H44.5098V22.3184H66.7198V0Z',
  'M66.7198 67V44.6369H44.5098V67H66.7198Z',
]

/** Brand → its published animated mark (load → hover → press, pure CSS, no JS). */
const ANIMATED: Partial<Record<string, () => string>> = {
  hanzo: hanzoAnimated,
  lux: luxAnimated,
  zoo: zooAnimated,
}

/**
 * The resolved brand's mark, sized in px. Renders the static block-H on the
 * server / first paint; upgrades to the brand's interactive animated SVG on mount.
 */
export function BrandMark({ size = 48 }: { size?: number }) {
  const theme = useTheme()
  const fill = theme.color12?.get() ?? 'var(--color12)'
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const animate = mounted ? ANIMATED[config.brand] : undefined
  if (!animate) {
    return (
      <svg width={size} height={size} viewBox="0 0 67 67" style={{ fill }} role="img" aria-label="Hanzo">
        {MARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    )
  }
  // Size the self-contained animated SVG to the box (it has a viewBox, no w/h).
  const svg = animate().replace('<svg ', '<svg width="100%" height="100%" ')
  return (
    <div
      style={{ width: size, height: size, display: 'inline-flex', cursor: 'pointer' }}
      role="img"
      aria-label={config.brandName}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/** Back-compat alias — the mark is now brand-aware + animated. */
export const HanzoMark = BrandMark

/** Full-screen centered brand loader with an optional label. */
export function Loader({ label, size = 48 }: { label?: string; size?: number }) {
  return (
    <YStack flex={1} minH="100vh" items="center" justify="center" gap="$3">
      <style>
        {'@keyframes hz-pulse{0%,100%{opacity:.5}50%{opacity:1}}.hz-pulse{animation:hz-pulse 1.5s ease-in-out infinite;display:inline-flex}'}
      </style>
      <div className="hz-pulse">
        <BrandMark size={size} />
      </div>
      {label ? (
        <Text fontSize="$3" color="$color11">
          {label}
        </Text>
      ) : null}
    </YStack>
  )
}
