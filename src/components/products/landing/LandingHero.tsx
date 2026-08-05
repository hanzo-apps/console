'use client'

/**
 * LandingHero — the clean product hero (kicker + title + one-line what-it-is + primary
 * CTA), in the inference `HeroCard` idiom: monochrome, with a neutral wash accent (the
 * design chart ramp lead) + the shared pure-SVG `HeroGraphic`. White-labels by brand.
 */
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'

import { config } from '~/config'
import { RAMP } from '~/lib/theme/ramp'
import { AccentButton, HeroGraphic } from '../inference/parts'
import { openExternal } from './parts'
import type { LandingAction, ProductLandingConfig } from './types'
import { asColor } from '@hanzo/ui/product'

const ACCENT = RAMP[0]

/** A hex color at an alpha, as an `rgba()`. */
function hex(h: string, a: number): string {
  const n = h.replace('#', '')
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

const act = (a: LandingAction) => (a.href ? openExternal(a.href) : a.onPress?.())

export function LandingHero({ config: c }: { config: ProductLandingConfig }) {
  const Icon = c.icon
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
        <YStack flex={1} minW={280} gap="$2.5">
          <XStack items="center" gap="$2">
            {Icon ? <Icon size={16} color={asColor(ACCENT)} /> : null}
            <Text fontSize="$1" color="$color11" fontWeight="700">
              {config.brandName || 'Hanzo Cloud'}
            </Text>
          </XStack>
          <Text fontSize="$8" fontWeight="900" color="$color12">
            {c.title}
          </Text>
          <Text fontSize="$3" color="$color11" maxW={620}>
            {c.tagline}
          </Text>
          {c.primary || c.secondary ? (
            <XStack gap="$2" pt="$2" flexWrap="wrap" items="center">
              {c.primary ? (
                <AccentButton icon={c.primary.icon} onPress={() => act(c.primary as LandingAction)}>
                  {c.primary.label}
                </AccentButton>
              ) : null}
              {c.secondary ? (
                <Button icon={c.secondary.icon} onPress={() => act(c.secondary as LandingAction)}>
                  {c.secondary.label}
                </Button>
              ) : null}
            </XStack>
          ) : null}
        </YStack>
        <YStack items="center" justify="center" minW={170}>
          <HeroGraphic size={170} />
        </YStack>
      </XStack>
    </Card>
  )
}
