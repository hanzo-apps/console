'use client'

/**
 * The models widget: two houses and a door.
 *
 * Enso and Zen are what we sell, so each gets its own card. Every other family is
 * reached through one card rather than listed, because a home page that names
 * twelve vendors is a catalog, and the catalog is already one click away. The
 * third card is wider for the same reason it is last: it is a door, not a peer.
 *
 * Its diagonal is a clip-path rather than a rotated box, so the edge stays a
 * straight line at every width. A rotated band changes apparent angle as the card
 * reflows, which is the thing that has to be re-checked at every breakpoint.
 *
 * Marks come from the ONE brand resolver every model surface uses (`ProviderLogo`
 * → `brandForModel`), so Enso and the Zen family render the house mark rather than
 * a colour this file invented. `BRANDS` deliberately excludes the house brands from
 * its hue table — ours are the mark, not a tile — so a bespoke palette here would
 * be off-brand by construction and would drift the moment a vendor hue changed.
 */
import { useEffect, useState } from 'react'

import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowRight } from '@hanzogui/lucide-icons-2'

import { ProviderLogo } from '~/components/ui/ProviderLogo'
import { fetchCatalog } from '~/lib/api/aicatalog'

/**
 * The card's headline is a COUNT, and the count is measured.
 *
 * It read "Every other family", which says the shape of the thing and not the
 * size of it — and the size is the argument. What it must never be is a number
 * somebody typed: this estate has a build gate for exactly that (hanzo.ai's
 * `audit-model-counts.mjs` went red on a hand-typed "400+"), because a figure in
 * copy drifts from the catalog the first week and nothing notices.
 *
 * So it counts what the catalog actually serves and floors to a hundred — the
 * same derivation hanzo.ai's `AI_MODELS_PHRASE` uses, so the two surfaces cannot
 * quote different numbers. Floor, never round: "400+" over 432 is true, and
 * rounding 432 up to "500+" is not. It says 500+ on its own the day the catalog
 * crosses 500.
 *
 * Until the count lands — and if it never does — the card keeps its old
 * headline. A door that cannot say how many is still a door; a door showing
 * "0+ AI models" is a broken one.
 */
const FALLBACK_TITLE = 'Every other family'

function phrase(n: number): string {
  return `${Math.floor(n / 100) * 100}+ AI models`
}

/** The families behind the third card, ordered by how often they are asked for. */
const FAMILIES = ['anthropic', 'openai', 'google', 'qwen', 'deepseek', 'meta', 'mistral', 'moonshot']

type House = { id: string; name: string; blurb: string; badge?: string; tags: string[] }

const HOUSES: House[] = [
  {
    id: 'enso',
    name: 'Enso',
    blurb: 'Routes each turn to the model that can answer it, at the price it should cost.',
    tags: ['Most capable', 'Multi-day tasks'],
  },
  {
    id: 'zen5',
    name: 'Zen',
    badge: 'New',
    blurb: 'Our own family — coding, agents, vision, and a coder tuned for volume.',
    tags: ['Agents', 'Coding', 'Vision'],
  },
]

function HouseCard({ house, onOpen }: { house: House; onOpen: () => void }) {
  return (
    <Card
      borderWidth={1}
      borderColor="$borderColor"
      flex={1}
      minW={200}
      overflow="hidden"
      cursor="pointer"
      hoverStyle={{ borderColor: '$color8' }}
      pressStyle={{ opacity: 0.85 }}
      onPress={onOpen}
      accessibilityRole="link"
      aria-label={`${house.name} — open the model catalog`}
    >
      <XStack height={84} bg="$color2" items="center" justify="center">
        <ProviderLogo provider="zen" model={house.id} size={40} />
      </XStack>
      {/* No `flex` on this stack or the blurb. Under React Native Web a flexed child
          contributes nothing to its parent's intrinsic height, so the card measured
          as if the text were not there and `overflow: hidden` clipped it
          mid-sentence — silently, and identically at every width. */}
      <YStack p="$3" gap="$2">
        <XStack gap="$2" items="center">
          <Text fontSize="$5" fontWeight="700">
            {house.name}
          </Text>
          {house.badge ? (
            <Text fontSize="$1" bg="$color5" px="$2" py="$1" rounded="$2">
              {house.badge}
            </Text>
          ) : null}
        </XStack>
        <Text fontSize="$2" color="$color11">
          {house.blurb}
        </Text>
        <XStack gap="$1" flexWrap="wrap">
          {house.tags.map((t) => (
            <Text key={t} fontSize="$1" color="$color11" bg="$color3" px="$2" py="$1" rounded="$2">
              {t}
            </Text>
          ))}
        </XStack>
      </YStack>
    </Card>
  )
}

function EveryOtherFamily({ onOpen }: { onOpen: () => void }) {
  // Counted, not typed. `fetchCatalog` is the same read the /models page makes,
  // so the number on the home card is the number that page will show. A failed
  // read keeps the old headline rather than rendering a zero — see FALLBACK_TITLE.
  const [title, setTitle] = useState(FALLBACK_TITLE)
  useEffect(() => {
    let live = true
    fetchCatalog()
      .then((rows) => {
        if (live && rows.length > 0) setTitle(phrase(rows.length))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  return (
    <Card
      borderWidth={1}
      borderColor="$borderColor"
      flex={2}
      minW={280}
      overflow="hidden"
      position="relative"
      cursor="pointer"
      hoverStyle={{ borderColor: '$color8' }}
      pressStyle={{ opacity: 0.85 }}
      onPress={onOpen}
      accessibilityRole="link"
      aria-label="Explore every model family"
    >
      {/* Eight marks, in a settled 4x2 grid.
          They used to free-wrap inside the clipped panel, so the row broke
          wherever the diagonal happened to cut it — a ragged 4+4 that re-ragged
          at every width, with the last mark drifting under the first. A grid
          places them, so the block reads as a set of PEERS (which is what the
          card is saying: every other family, equally) and it holds its shape at
          every breakpoint. The clip still draws the diagonal edge; it no longer
          decides the layout.
          `justify-items: center` keeps each mark centred in its cell, so marks
          of different aspect (a square H, a wide wordmark) still line up. */}
      <YStack
        position="absolute"
        t={0}
        r={0}
        b={0}
        width="58%"
        bg="$color2"
        items="center"
        justify="center"
        p="$3"
        style={{ clipPath: 'polygon(22% 0, 100% 0, 100% 100%, 0 100%)' }}
        pointerEvents="none"
      >
        <YStack
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 14,
            justifyItems: 'center',
            alignItems: 'center',
          }}
        >
          {FAMILIES.map((f) => (
            <ProviderLogo key={f} provider={f} size={26} />
          ))}
        </YStack>
      </YStack>

      <YStack p="$3" $md={{ p: '$4' }} gap="$2" maxW="50%" justify="center">
        <Text fontSize="$5" fontWeight="700">
          {title}
        </Text>
        <Text fontSize="$2" color="$color11">
          Claude, GPT, Gemini, Qwen, DeepSeek, Llama and more — one key, one bill, one API.
        </Text>
        <XStack>
          <Button size="$2" chromeless px={0} iconAfter={<ArrowRight size={14} />} onPress={onOpen}>
            Explore all models
          </Button>
        </XStack>
      </YStack>
    </Card>
  )
}

export function Models() {
  const router = useRouter()
  const go = (p: string) => router.push(p)

  return (
    <YStack gap="$3" data-testid="models-section">
      <XStack justify="space-between" items="center" gap="$2">
        <Text fontSize="$5" fontWeight="700">
          Models
        </Text>
        <XStack gap="$1" items="center">
          <Button size="$2" chromeless onPress={() => go('/models')}>
            All models
          </Button>
          <Button
            size="$2"
            chromeless
            iconAfter={<ArrowRight size={14} />}
            onPress={() => go('/models/leaderboard')}
          >
            Compare
          </Button>
        </XStack>
      </XStack>

      <XStack gap="$3" flexWrap="wrap" items="stretch">
        {HOUSES.map((h) => (
          <HouseCard key={h.id} house={h} onOpen={() => go('/models')} />
        ))}
        <EveryOtherFamily onOpen={() => go('/models')} />
      </XStack>
    </YStack>
  )
}
