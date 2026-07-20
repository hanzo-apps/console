'use client'

/**
 * The lazily-loaded `@hanzo/canvas` board — ONE dynamic import shared by the CD
 * fleet map and the per-app resource-tree topology (the drawer's Resources tab).
 * `@xyflow/react` touches browser globals at import, so it is loaded client-side
 * with SSR disabled (never evaluated during prerender). Reuses the console's
 * `Loader` for the honest loading frame.
 */
import dynamic from 'next/dynamic'
import { Card } from '@hanzo/gui'

import { Loader } from '~/components/ui/Loader'

export const LazyProjectCanvas = dynamic(() => import('@hanzo/canvas').then((m) => m.ProjectCanvas), {
  ssr: false,
  loading: () => <Loader label="Loading canvas…" />,
})

/** A bordered, definite-height viewport so the canvas can size itself. Mobile-safe
 *  (width 100%, its own scroll bounds) — the page body never scrolls horizontally. */
export function CanvasFrame({ height, children }: { height?: number | string; children: React.ReactNode }) {
  return (
    <Card
      borderWidth={1}
      borderColor="$borderColor"
      rounded="$4"
      overflow="hidden"
      p={0}
      bg="$color1"
      style={{ width: '100%', height: height ?? 'min(74vh, 820px)', minHeight: 320 }}
    >
      {children}
    </Card>
  )
}
