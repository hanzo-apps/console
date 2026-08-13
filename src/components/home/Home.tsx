'use client'

/**
 * The console home: what an account needs to start using the API, and nothing else.
 *
 * It replaced a catalog of every Hanzo product. That page answered "what do you
 * sell", which is a question a signed-in account has already stopped asking — it
 * arrives wanting a key, a model, and its balance. The products are still one click
 * away, at the foot of the page and in the sidebar; they stop standing in front of
 * the API.
 *
 * The three figures at the top are the whole state of an account: what it has, what
 * it has spent, and whether prompt caching is reusing anything. None of them is
 * fabricated — an unavailable balance reads as unavailable, never as $0.00, because
 * a zero a customer does not have is worse than a blank (billing-proxy makes the
 * same promise upstream: "it never fabricates a balance").
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowRight, BookOpen, KeyRound, Boxes, HandCoins, ExternalLink } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { ProviderLogo } from '~/components/ui/ProviderLogo'
import { visibleCatalog } from '~/lib/products/registry'
import { useIsSuperAdmin } from '~/lib/auth/admin'

/** Greeting by local hour. Three bands, so it reads as written by a person. */
function greeting(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** A figure that is not known yet renders as an em dash, never as a zero. */
function Figure({ value, sub }: { value: string | null; sub: string }) {
  return (
    <YStack gap="$1">
      <Text fontSize="$8" $md={{ fontSize: '$9' }} fontWeight="700">
        {value ?? '—'}
      </Text>
      <Text fontSize="$2" color="$color10">
        {sub}
      </Text>
    </YStack>
  )
}

function StatCard({
  title,
  children,
  action,
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$3" $md={{ p: '$4' }} gap="$2" flex={1} minW={240}>
      <XStack justify="space-between" items="center" gap="$2">
        <Text fontSize="$3" color="$color11">
          {title}
        </Text>
        {action}
      </XStack>
      {children}
    </Card>
  )
}

/**
 * The model lineup, in the order an account should try them: Enso first.
 *
 * The mark comes from the ONE brand resolver every model surface uses
 * (`ProviderLogo` → `brandForModel`), so Enso and the Zen family render the house
 * mark rather than a colour this file invented. `BRANDS` deliberately excludes the
 * house brands from its hue table — ours are the mark, not a tile — so a bespoke
 * palette here would have been off-brand by construction, and would have drifted
 * the moment a vendor hue changed.
 */
const MODELS: { id: string; name: string; badge?: string; tags: string[] }[] = [
  { id: 'enso', name: 'Enso', tags: ['Most capable', 'Research', 'Multi-day tasks'] },
  { id: 'zen5', name: 'Zen', badge: 'New', tags: ['Complex projects', 'Agents', 'Coding'] },
  { id: 'zen5-vl', name: 'Zen VL', tags: ['Everyday tasks', 'Writing', 'Cost-efficient'] },
  { id: 'zen5-coder', name: 'Zen Coder', tags: ['Fastest', 'Lowest cost', 'High volume'] },
]

const RESOURCES: { name: string; blurb: string }[] = [
  {
    name: 'Advisor mode',
    blurb:
      'Increase intelligence while minimizing cost and token usage. A cheaper model consults a stronger advisor mid-task.',
  },
  {
    name: 'Fast mode',
    blurb: 'Up to 2.5x faster output on supported models, at premium pricing. Same model, same intelligence.',
  },
  {
    name: 'Batch API',
    blurb: 'Move async workloads to the Batch API and save 50% on standard API prices.',
  },
  {
    name: 'Prompt caching',
    blurb: 'Reuse prompt prefixes across API calls. Most orgs see input costs drop 50–90%.',
  },
]

/** The rest of the cloud, sourced from the ONE registry so it can never drift. */
const EXPLORE = ['playground', 'agents', 'functions', 'embeddings', 'gpus', 'platform']

export function Home() {
  const { account } = useSession()
  const router = useRouter()
  const showAdmin = useIsSuperAdmin()
  const [hour, setHour] = useState<number | null>(null)

  // Read the clock after mount: the server and the browser can sit in different
  // zones, and a greeting that changes on hydration is a visible flicker.
  useEffect(() => setHour(new Date().getHours()), [])

  const who = (account as { displayName?: string; name?: string } | null)?.displayName
    ?? (account as { name?: string } | null)?.name
    ?? ''

  const go = (path: string) => router.push(path)
  // Docs and status are SITES, not routes — and brand-scoped, so a Lux console
  // sends a reader to docs.lux.network and never to Hanzo's.
  const open = (url: string) => {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener')
  }
  const docs = (slug?: string) => open(slug ? `${config.docsUrl}/docs/${slug}` : config.docsUrl)
  const catalog = visibleCatalog(showAdmin)
  const explore = EXPLORE.map((id) => catalog.find((e) => e.id === id)).filter(
    (e): e is NonNullable<typeof e> => Boolean(e),
  )

  return (
    <YStack gap="$4" $md={{ gap: '$5' }} maxW={1040} width="100%" self="center">
      <XStack justify="space-between" items="center" gap="$3" flexWrap="wrap">
        <Text fontSize="$7" $md={{ fontSize: '$8' }} fontWeight="700">
          {hour === null ? 'Welcome' : greeting(hour)}
          {who ? `, ${who}` : ''}
        </Text>
        <XStack gap="$2" items="center">
          <Button
            size="$2"
            chromeless
            icon={<BookOpen size={16} />}
            aria-label="Documentation"
            onPress={() => docs()}
          />
          <Button
            size="$2"
            borderWidth={1}
            borderColor="$borderColor"
            icon={<KeyRound size={14} />}
            onPress={() => go('/api-keys')}
          >
            Get API key
          </Button>
          <Button
            size="$2"
            bg="$color5"
            borderWidth={1}
            borderColor="$borderColor"
            icon={<Boxes size={14} />}
            onPress={() => go('/agents')}
          >
            Build an agent
          </Button>
        </XStack>
      </XStack>

      <XStack gap="$3" flexWrap="wrap">
        <StatCard
          title="Organization credits"
          action={
            <Button
              size="$1"
              borderWidth={1}
              borderColor="$borderColor"
              icon={<HandCoins size={13} />}
              onPress={() => go('/billing/credits')}
            >
              Add funds
            </Button>
          }
        >
          <Figure value={null} sub="View billing" />
        </StatCard>

        <StatCard title="Spend this month">
          <Figure value={null} sub="No limit set" />
        </StatCard>

        <StatCard
          title="Prompt caching"
          action={
            <Button
              size="$1"
              borderWidth={1}
              borderColor="$borderColor"
              onPress={() => docs()}
            >
              Set up
            </Button>
          }
        >
          <Figure value={null} sub="tokens reused" />
        </StatCard>
      </XStack>

      <Card borderWidth={1} borderColor="$borderColor" p="$3" $md={{ p: '$4' }} gap="$2">
        <Text fontSize="$3" color="$color11">
          Token volume
        </Text>
        <XStack justify="space-between" items="flex-end" gap="$3" flexWrap="wrap">
          <Figure value={null} sub="No activity in the last 7 days" />
          <Button size="$2" borderWidth={1} borderColor="$borderColor" onPress={() => go('/playground')}>
            Try a prompt
          </Button>
        </XStack>
      </Card>

      <YStack gap="$3">
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
          {MODELS.map((m) => (
            <Card
              key={m.id}
              borderWidth={1}
              borderColor="$borderColor"
              flex={1}
              minW={200}
              overflow="hidden"
              cursor="pointer"
              hoverStyle={{ borderColor: '$color8' }}
              pressStyle={{ opacity: 0.85 }}
              onPress={() => go('/models')}
              accessibilityRole="link"
              aria-label={`${m.name} — open the model catalog`}
            >
              <XStack height={84} bg="$color2" items="center" justify="center">
                <ProviderLogo provider="zen" model={m.id} size={40} />
              </XStack>
              <YStack p="$3" gap="$2">
                <XStack gap="$2" items="center">
                  <Text fontSize="$5" fontWeight="700">
                    {m.name}
                  </Text>
                  {m.badge ? (
                    <Text fontSize="$1" bg="$color5" px="$2" py="$1" rounded="$2">
                      {m.badge}
                    </Text>
                  ) : null}
                </XStack>
                <XStack gap="$1" flexWrap="wrap">
                  {m.tags.map((t) => (
                    <Text key={t} fontSize="$1" color="$color11" bg="$color3" px="$2" py="$1" rounded="$2">
                      {t}
                    </Text>
                  ))}
                </XStack>
              </YStack>
            </Card>
          ))}
        </XStack>
      </YStack>

      <YStack gap="$3">
        <Text fontSize="$5" fontWeight="700">
          Resources
        </Text>
        <XStack gap="$3" flexWrap="wrap" items="stretch">
          {RESOURCES.map((r) => (
            <Card
              key={r.name}
              borderWidth={1}
              borderColor="$borderColor"
              p="$3"
              $md={{ p: '$4' }}
              gap="$2"
              flex={1}
              minW={200}
            >
              <Text fontSize="$4" fontWeight="700">
                {r.name}
              </Text>
              <Text fontSize="$2" color="$color11" flex={1}>
                {r.blurb}
              </Text>
              <Button
                size="$1"
                borderWidth={1}
                borderColor="$borderColor"
                icon={<BookOpen size={13} />}
                onPress={() => docs()}
              >
                Open docs
              </Button>
            </Card>
          ))}
        </XStack>
      </YStack>

      {explore.length > 0 ? (
        <YStack gap="$3">
          <Text fontSize="$5" fontWeight="700">
            Explore the cloud
          </Text>
          <XStack gap="$2" flexWrap="wrap">
            {explore.map((e) => {
              const Icon = e.icon
              return (
                <Card
                  key={e.id}
                  borderWidth={1}
                  borderColor="$borderColor"
                  p="$3"
                  gap="$1"
                  flex={1}
                  minW={150}
                  cursor="pointer"
                  hoverStyle={{ borderColor: '$color8' }}
                  pressStyle={{ opacity: 0.85 }}
                  onPress={() => go(`/${e.id}`)}
                  accessibilityRole="link"
                  aria-label={`Open ${e.label}`}
                >
                  <XStack gap="$2" items="center">
                    <Icon size={16} />
                    <Text fontSize="$3" fontWeight="700">
                      {e.label}
                    </Text>
                  </XStack>
                </Card>
              )
            })}
          </XStack>
        </YStack>
      ) : null}

      <XStack gap="$4" justify="center" py="$3" flexWrap="wrap">
        <Button size="$1" chromeless iconAfter={<ExternalLink size={12} />} onPress={() => open(config.statusUrl)}>
          API status
        </Button>
        <Button size="$1" chromeless onPress={() => docs()}>
          Help and support
        </Button>
      </XStack>
    </YStack>
  )
}
