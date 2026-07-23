'use client'

import { XStack, Text } from '@hanzo/gui'
import { GitFork, ArrowUpRight } from '@hanzogui/lucide-icons-2'
import { matchRoute } from '~/lib/products/match'
import { findEntry } from '~/lib/products/registry'

/**
 * Universal per-product OSS upstream credit.
 *
 * Rendered ONCE at the bottom of the product content column (Dashboard), so
 * EVERY product module — native overview, resource card, or bespoke admin surface —
 * surfaces the open-source project it is forked from, from the ONE source of truth
 * (the catalog `upstream` field on the matched entry). Renders nothing for original
 * Hanzo products or non-product routes. This is the single, DRY attribution surface;
 * honest OSS citizenship + license compliance, distinct from the Zen model brand policy.
 */
export function ProductUpstreamNote({ pathname }: { pathname: string }) {
  const segs = pathname.split('/').filter(Boolean)
  const matched = matchRoute(segs)
  // matchRoute resolves the canonical module id (incl. aliases); the full catalog
  // entry carries the `upstream` metadata (the slim ProductModule does not).
  const up = matched ? findEntry(matched.module.id)?.upstream : undefined
  if (!up) return null
  return (
    <XStack
      testID="product-upstream"
      mt="$4"
      pt="$3"
      borderTopWidth={1}
      borderColor="$borderColor"
      items="center"
      gap="$2"
      flexWrap="wrap"
      cursor="pointer"
      hoverStyle={{ opacity: 0.85 }}
      onPress={() => {
        if (typeof window !== 'undefined') window.open(up.url, '_blank', 'noopener')
      }}
    >
      <GitFork size={13} opacity={0.6} />
      <Text fontSize="$2" color="$color10">
        {`Built on open source — forked from ${up.name} (${up.license}).`}
      </Text>
      <ArrowUpRight size={12} opacity={0.5} />
    </XStack>
  )
}

