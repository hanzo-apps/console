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
 * The figures at the top are the state of an account: what it has, what it has
 * spent, and what it has been running. They are READ, from the two sources the
 * neighbouring screens already read — the shared live balance (`useCloudBalance`,
 * the sidebar wallet's own value) and the one usage roll-up (`GET /v1/usage/summary`,
 * what /usage renders). Nothing here is fabricated and nothing here is a second
 * opinion: month-to-date has three readers already, and this is not a fourth.
 *
 * Every dash on this screen means UNKNOWN and says why underneath (`figures.ts`).
 * A balance the account really has spent to nothing prints $0.00 — a zero a customer
 * does not have is worse than a blank, and a blank a customer cannot explain is
 * worse still.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { BookOpen, KeyRound, Boxes, HandCoins, ExternalLink } from '@hanzogui/lucide-icons-2'
import { classifyBackend, type BackendState } from '@hanzo/ui/product'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { Models } from '~/components/home/Models'
import { credit, month, volume, RANGE, type Reading } from '~/components/home/figures'
import { tileView, TILE_LOAD_TIMEOUT_MS } from '~/components/products/billing/logic'
import { UsageSummaryApi, type UsageSummary } from '~/lib/api/usage-summary'
import { useCloudBalance, spendableCents } from '~/lib/billing/live-balance'
import { useTimedOut } from '~/lib/use-timed-out'
import { visibleCatalog } from '~/lib/products/registry'
import { useViewer } from '~/lib/products/viewer'
import { greet } from '~/components/home/greeting'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }


/** A figure that is not known renders as an em dash, and `sub` says why. */
function Figure({ value, sub }: Reading) {
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


const RESOURCES: { name: string; blurb: string }[] = [
  {
    name: 'Advisor mode',
    blurb:
      'A cheaper model runs the task and consults a stronger one mid-task. You get the stronger model where it matters without sending every token through it.',
  },
  {
    name: 'Fast mode',
    blurb: 'Faster output on supported models, at a higher price per token. Same model, same intelligence.',
  },
  {
    name: 'Batch API',
    blurb: 'Send work that can wait to the Batch API. It runs when there is room and costs less per token.',
  },
  {
    name: 'Prompt caching',
    blurb: 'Reuse a prompt prefix across calls instead of paying to send it again every time.',
  },
]

/** The rest of the cloud, sourced from the ONE registry so it can never drift. */
const EXPLORE = ['playground', 'agents', 'functions', 'embeddings', 'gpus', 'platform']

export function Home() {
  const { account } = useSession()
  const router = useRouter()
  const viewer = useViewer()
  const [today, setToday] = useState<Date | null>(null)

  // Read the date after mount: the server and the browser can sit in different
  // zones, and a greeting that changes on hydration is a visible flicker.
  useEffect(() => setToday(new Date()), [])

  // The balance: the ONE shared live value, so this tile and the sidebar wallet a
  // few hundred pixels away read the same cents and cannot contradict each other.
  const { phase: balPhase, balance, error: balError } = useCloudBalance()

  // The roll-up: ONE call feeds both the month-to-date tile and the token volume
  // card, which is why they can never tell two stories about the same window.
  const [summary, setSummary] = useState<Async<UsageSummary>>({ phase: 'loading' })
  const loadSummary = useCallback(() => {
    setSummary({ phase: 'loading' })
    UsageSummaryApi.summary(RANGE)
      .then((data) => setSummary({ phase: 'ready', data }))
      .catch((e) => setSummary({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  // Loading has a ceiling: a request left hanging by a backend blip degrades to the
  // honest dash at the bound instead of spinning under the figure forever.
  const balTimedOut = useTimedOut(balPhase === 'loading' || balPhase === 'idle', TILE_LOAD_TIMEOUT_MS)
  const sumTimedOut = useTimedOut(summary.phase === 'loading', TILE_LOAD_TIMEOUT_MS)
  const sumView = tileView(summary.phase, sumTimedOut)
  const rollup = summary.phase === 'ready' ? summary.data : null
  const rollupError = summary.phase === 'error' ? summary.error : undefined

  const credits = credit(balPhase, spendableCents(balance), balError, balTimedOut)
  const spend = month(sumView, rollup, rollupError)
  const tokens = volume(sumView, rollup, rollupError)

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
  const catalog = visibleCatalog(viewer)
  const explore = EXPLORE.map((id) => catalog.find((e) => e.id === id)).filter(
    (e): e is NonNullable<typeof e> => Boolean(e),
  )

  return (
    <YStack gap="$4" $md={{ gap: '$5' }} maxW={1040} width="100%" self="center">
      <XStack justify="space-between" items="center" gap="$3" flexWrap="wrap">
        <Text fontSize="$7" $md={{ fontSize: '$8' }} fontWeight="700">
          {today === null ? 'Welcome' : greet(today, who)}
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
              Add credits
            </Button>
          }
        >
          <Figure {...credits} />
        </StatCard>

        <StatCard title="Spend this month">
          <Figure {...spend} />
        </StatCard>

        {/* Reuse is not metered anywhere yet — the roll-up carries prompt and
            completion tokens, and neither is a cache read. So this stays a dash and
            says it is unmeasured, rather than borrowing a number that means
            something else. It becomes a figure when the warehouse reports one. */}
        <StatCard
          title="Prompt caching"
          action={
            <Button
              size="$1"
              borderWidth={1}
              borderColor="$borderColor"
              onPress={() => docs()}
            >
              Open docs
            </Button>
          }
        >
          <Figure value={null} sub="Reuse is not measured yet" />
        </StatCard>
      </XStack>

      <Card borderWidth={1} borderColor="$borderColor" p="$3" $md={{ p: '$4' }} gap="$2">
        <Text fontSize="$3" color="$color11">
          Token volume
        </Text>
        <XStack justify="space-between" items="flex-end" gap="$3" flexWrap="wrap">
          <Figure {...tokens} />
          <Button size="$2" borderWidth={1} borderColor="$borderColor" onPress={() => go('/playground')}>
            Try a prompt
          </Button>
        </XStack>
      </Card>

      <Models />

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
