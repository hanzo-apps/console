'use client'

/**
 * Brand loader — the resolved brand's mark.
 *
 * console2 is brand-aware (`config.brand` ∈ hanzo | lux | zoo | pars, from the
 * hostname), so the mark follows the brand: each brand's OWN published,
 * self-contained animated SVG — the logo IS that brand's "AI" you can play with
 * (it animates in on load, flourishes on hover, squashes on press; pure CSS, no
 * JS). The brand's own STATIC mark renders during SSR / first paint (no hydration
 * mismatch), then upgrades to its interactive animated mark on mount.
 *
 * The static branch used to hardcode Hanzo's block-H labelled "Hanzo". Because
 * ANIMATED only covers hanzo/lux/zoo, a pars host never left that branch — it
 * showed the Hanzo mark permanently, not just on first paint. Both halves now
 * come from the `@hanzo/brand` registry, which carries a mark per brand.
 */
import { useEffect, useState } from 'react'

import { Text, YStack, useTheme } from '@hanzo/gui'
import { getAnimatedSVG as hanzoAnimated } from '@hanzo/logo'
import { getAnimatedSVG as luxAnimated } from '@luxfi/logo'
import { getAnimatedSVG as zooAnimated } from '@zooai/logo'

import { config } from '~/config'
import { getBrand } from '~/lib/branding/brands'

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
    // The brand's OWN static mark from the shared registry — not Hanzo's. This
    // branch renders on SSR / first paint for every brand, and PERMANENTLY for
    // any brand with no animated package: ANIMATED covers hanzo/lux/zoo, so a
    // pars host fell through to a hardcoded Hanzo H labelled "Hanzo" forever,
    // which is the white-label invariant broken outright. `@hanzo/brand` already
    // carries a mark per brand (PARS_MARK included) and BrandLogo's BrandMark
    // reads exactly these fields — this is the same one source, not a copy.
    const brand = getBrand()
    return (
      <svg
        width={size}
        height={size}
        viewBox={brand.logoViewBox}
        style={{ fill }}
        role="img"
        aria-label={brand.brandName}
        // logoContent is a build-time-trusted registry constant, never user input.
        dangerouslySetInnerHTML={{ __html: brand.logoContent }}
      />
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
