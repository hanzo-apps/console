'use client'

/**
 * ProductLanding — the reusable polished landing/overview any product composes from a
 * small `ProductLandingConfig`: a clean hero, a live count-up metrics row, an
 * interactive code-sample block (curl/python/ts/js + copy + Run), and a resources rail
 * (docs/quickstart/examples/code/support). DRY — one landing system across products,
 * like the living-overview registry pattern.
 *
 * Layout: hero on top, then a two-column body (main content + resource rail) that wraps
 * to a single column on narrow viewports. `children` is the product's own REAL content
 * (e.g. embeddings' model-mix donut + index health), rendered below the code block so a
 * product keeps everything it already had — this is polish, not a rewrite.
 */
import { useRef, type ReactNode } from 'react'
import { XStack, YStack } from '@hanzo/gui'

import { LandingHero } from './LandingHero'
import { LandingMetrics } from './LandingMetrics'
import { CodeSamples } from './CodeSamples'
import { ResourceRail } from './ResourceRail'
import type { ProductLandingConfig } from './types'

export function ProductLanding({ config, children }: { config: ProductLandingConfig; children?: ReactNode }) {
  const codeRef = useRef<HTMLDivElement>(null)
  const hasCode = Boolean(config.samples && config.samples.length)
  const scrollToCode = () => codeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  return (
    <YStack gap="$4">
      <LandingHero config={config} />

      <XStack gap="$4" flexWrap="wrap" items="flex-start">
        <YStack flex={2} minW={360} gap="$4">
          <LandingMetrics config={config} />
          {hasCode ? (
            <div ref={codeRef} style={{ width: '100%' }}>
              <CodeSamples samples={config.samples as NonNullable<ProductLandingConfig['samples']>} run={config.run} />
            </div>
          ) : null}
          {children}
        </YStack>

        <ResourceRail config={config} onViewCode={hasCode ? scrollToCode : undefined} />
      </XStack>
    </YStack>
  )
}
