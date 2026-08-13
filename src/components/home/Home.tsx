'use client'

/**
 * The console home: what an account needs to start using the API, and nothing else.
 *
 * It replaced a catalog of every Hanzo product. That page answered "what do you
 * sell", which is a question a signed-in account has already stopped asking — it
 * arrives wanting a key, a model, and its balance. The products still exist and
 * are still reachable; they are opt-in rather than the first thing in the way.
 *
 * The three figures at the top are the whole state of an account: what it has,
 * what it has spent, and whether prompt caching is reusing anything. None of them
 * is fabricated — an unavailable balance reads as unavailable, never as $0.00,
 * because a zero a customer does not have is worse than a blank (billing-proxy
 * makes the same promise upstream: "it never fabricates a balance").
 */
import { useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowRight, BookOpen, KeyRound, Boxes, HandCoins, ExternalLink } from '@hanzogui/lucide-icons-2'

import { useSession } from '~/lib/auth/session'

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
      <Text fontSize="$9" fontWeight="700">
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
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" flex={1} minW={260}>
      <XStack justify="space-between" items="center">
        <Text fontSize="$3" color="$color11">
          {title}
        </Text>
        {action}
      </XStack>
      {children}
    </Card>
  )
}

/** The model lineup, in the order an account should try them: Enso first. */
const MODELS: { name: string; badge?: string; tags: string[]; tone: '$blue7' | '$orange7' | '$color4' | '$green7' }[] = [
  { name: 'Enso', tags: ['Most capable', 'Research', 'Multi-day tasks'], tone: '$blue7' },
  { name: 'Zen', badge: 'New', tags: ['Complex projects', 'Agents', 'Coding'], tone: '$orange7' },
  { name: 'Zen VL', tags: ['Everyday tasks', 'Writing', 'Cost-efficient'], tone: '$color4' },
  { name: 'Zen Coder', tags: ['Fastest', 'Lowest cost', 'High volume'], tone: '$green7' },
]

const RESOURCES: { name: string; blurb: string; href: string }[] = [
  {
    name: 'Advisor mode',
    blurb:
      'Increase intelligence while minimizing cost and token usage. A cheaper model consults a stronger advisor mid-task.',
    href: 'https://docs.hanzo.ai/advisor',
  },
  {
    name: 'Fast mode',
    blurb: 'Up to 2.5x faster output on supported models, at premium pricing. Same model, same intelligence.',
    href: 'https://docs.hanzo.ai/fast-mode',
  },
  {
    name: 'Batch API',
    blurb: 'Move async workloads to the Batch API and save 50% on standard API prices.',
    href: 'https://docs.hanzo.ai/batch',
  },
  {
    name: 'Prompt caching',
    blurb: 'Reuse prompt prefixes across API calls. Most orgs see input costs drop 50–90%.',
    href: 'https://docs.hanzo.ai/prompt-caching',
  },
]

export function Home() {
  const { account } = useSession()
  const [hour, setHour] = useState<number | null>(null)

  // Read the clock after mount: the server and the browser can sit in different
  // zones, and a greeting that changes on hydration is a visible flicker.
  useEffect(() => setHour(new Date().getHours()), [])

  const who = (account as { displayName?: string; name?: string } | null)?.displayName
    ?? (account as { name?: string } | null)?.name
    ?? ''

  return (
    <YStack gap="$5" p="$4" maxW={1040} width="100%" self="center">
      <XStack justify="space-between" items="center" gap="$3" flexWrap="wrap">
        <Text fontSize="$8" fontWeight="700">
          {hour === null ? 'Welcome' : greeting(hour)}
          {who ? `, ${who}` : ''}
        </Text>
        <XStack gap="$2" items="center">
          <Button size="$2" chromeless icon={<BookOpen size={16} />} aria-label="Documentation" />
          <Button size="$2" borderWidth={1} borderColor="$borderColor" icon={<KeyRound size={14} />}>
            Get API key
          </Button>
          <Button size="$2" bg="$color5" borderWidth={1} borderColor="$borderColor" icon={<Boxes size={14} />}>
            Build an agent
          </Button>
        </XStack>
      </XStack>

      <XStack gap="$3" flexWrap="wrap">
        <StatCard
          title="Organization credits"
          action={
            <Button size="$1" borderWidth={1} borderColor="$borderColor" icon={<HandCoins size={13} />}>
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
            <Button size="$1" borderWidth={1} borderColor="$borderColor">
              Set up
            </Button>
          }
        >
          <Figure value={null} sub="tokens reused" />
        </StatCard>
      </XStack>

      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3">
        <Text fontSize="$3" color="$color11">
          Token volume
        </Text>
        <XStack justify="space-between" items="flex-end">
          <Figure value={null} sub="No activity in the last 7 days" />
          <Button size="$2" borderWidth={1} borderColor="$borderColor">
            Try a prompt
          </Button>
        </XStack>
      </Card>

      <YStack gap="$3">
        <XStack justify="space-between" items="center">
          <Text fontSize="$5" fontWeight="700">
            Models
          </Text>
          <Button size="$2" chromeless iconAfter={<ArrowRight size={14} />}>
            Compare models
          </Button>
        </XStack>
        <XStack gap="$3" flexWrap="wrap">
          {MODELS.map((m) => (
            <Card key={m.name} borderWidth={1} borderColor="$borderColor" width={228} overflow="hidden">
              <YStack height={96} bg={m.tone} />
              <YStack p="$3" gap="$2">
                <XStack gap="$2" items="center">
                  <Text fontSize="$5" fontWeight="700">
                    {m.name}
                  </Text>
                  {m.badge ? (
                    <Text fontSize="$1" bg="$blue7" px="$2" py="$1" rounded="$2">
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
            <Card key={r.name} borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" width={228}>
              <Text fontSize="$4" fontWeight="700">
                {r.name}
              </Text>
              <Text fontSize="$2" color="$color11" flex={1}>
                {r.blurb}
              </Text>
              <Button size="$1" borderWidth={1} borderColor="$borderColor" icon={<BookOpen size={13} />}>
                Open docs
              </Button>
            </Card>
          ))}
        </XStack>
      </YStack>

      <XStack gap="$4" justify="center" py="$4">
        <Button size="$1" chromeless iconAfter={<ExternalLink size={12} />}>
          API status
        </Button>
        <Button size="$1" chromeless>
          Help and support
        </Button>
        <Button size="$1" chromeless>
          Feedback
        </Button>
      </XStack>
    </YStack>
  )
}
