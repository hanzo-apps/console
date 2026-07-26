'use client'

/**
 * "Connected to Hanzo Cloud" hero — the honest managed-state banner. It states the
 * real topology (workloads run on managed Hanzo Cloud; the raw fleet view is an admin
 * surface) and carries a tasteful monochrome graphic accent (pure SVG, no bespoke render).
 * White-labels by brand (`config.brandName`), so a Lux/Zoo console reads correctly.
 */
import { Card, Text, XStack, YStack } from '@hanzo/gui'

import { config } from '~/config'
import { ACCENT, HeroGraphic, StatusDot } from './parts'
import { toneVar } from '~/components/ui/tone'

export function HeroCard() {
  const brand = config.brandName || 'Hanzo Cloud'
  return (
    <Card
      borderWidth={1}
      borderColor="$borderColor"
      rounded="$6"
      p="$5"
      overflow="hidden"
      style={{ background: `linear-gradient(115deg, ${hex(ACCENT, 0.16)} 0%, ${hex(ACCENT, 0.04)} 48%, rgba(0,0,0,0) 78%)` }}
    >
      <XStack items="center" gap="$4" flexWrap="wrap">
        <YStack flex={1} minW={300} gap="$2.5">
          <XStack items="center" gap="$2">
            <StatusDot color={toneVar('positive')} />
            <Text fontSize="$1" color="$color11" fontWeight="700" style={{ letterSpacing: 0.4, textTransform: 'uppercase' }}>
              Managed · Connected
            </Text>
          </XStack>
          <Text fontSize="$8" fontWeight="900" color="$color12">
            Connected to {brand}
          </Text>
          <Text fontSize="$3" color="$color11" maxW={620}>
            Your workloads run on managed {brand} — no cluster to operate. The full control-plane fleet view
            (clusters, nodes, raw workloads) is an admin surface; deploy and scale through Functions, Agents,
            and the platform.
          </Text>
        </YStack>
        <YStack items="center" justify="center" minW={190}>
          <HeroGraphic size={190} />
        </YStack>
      </XStack>
    </Card>
  )
}

/** A hex color at an alpha, as an `rgba()` (the ACCENT is a 6-digit hex). */
function hex(h: string, a: number): string {
  const n = h.replace('#', '')
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
