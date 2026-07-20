'use client'

/**
 * The Hanzo "H" mark — the canonical 7-path shaded H from @hanzo/logo
 * (`MARK_PATHS`, the ONE home of the geometry: five body blocks that inherit
 * `currentColor` + two shade slivers). Rendered inline so it adapts to the
 * dark/light theme with no per-theme asset. ONE source for the mark across the
 * chrome (sidebar + header). The paths are a build-time-trusted package
 * constant — never user input.
 */
import { MARK_PATHS, MARK_VIEWBOX } from '@hanzo/logo/logos'

export function HanzoMark({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEWBOX}
      role="img"
      aria-label="Hanzo"
      fill={color}
      style={{ display: 'block', flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: MARK_PATHS }}
    />
  )
}
