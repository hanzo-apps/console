'use client'

/**
 * AI Accounts — unified usage Overview. Provider cards (one per linked account,
 * plus the org's own Hanzo lane) over the merged `/v1/ai-accounts/usage` feed:
 * external providers via the headless usage engine, Hanzo via the real commerce
 * ledger. Empty of external links → a prominent "Connect your AI accounts" CTA to
 * the Accounts tab. Every number is real or an honest "—"; nothing is fabricated.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Boxes, RefreshCw, ArrowRight, Gauge, ExternalLink } from '@hanzogui/lucide-icons-2'

import { AiAccountsApi, type AccountsUsage, type ProviderUsage } from '~/lib/api/ai-accounts'
import { aiProvider } from '~/lib/products/ai-accounts'
import type { CloudUsageOverview } from '~/lib/api/usage'
import { PageHeader } from '~/components/ui/PageHeader'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { EmptyState } from '~/components/ui/EmptyState'
import { UtilBar } from '~/components/ui/Metric'
import { Loader } from '~/components/ui/Loader'
import { providerColor } from '~/lib/products/ai-accounts'

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`
const pctText = (n?: number): string => (typeof n === 'number' ? `${Math.round(n)}%` : '—')
const compact = (n: number): string => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)

const labelFor = (id: string): string => aiProvider(id)?.label ?? id
const colorFor = (id: string): string => (aiProvider(id) ? providerColor(id) : 'var(--color8)')

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

/** A thin labeled meter (percent used). */
function Lane({ title, used, color }: { title: string; used?: number; color: string }) {
  if (typeof used !== 'number') return null
  return (
    <YStack gap="$1">
      <XStack justify="space-between">
        <Text fontSize="$2" color="$color11">
          {title}
        </Text>
        <Text fontSize="$2" color="$color12" className="hz-mono">
          {pctText(used)}
        </Text>
      </XStack>
      <UtilBar value={used} width={220} color={color} />
    </YStack>
  )
}

/** One linked-provider card from a usage-engine snapshot. */
function ProviderCard({ pu }: { pu: ProviderUsage }) {
  const color = colorFor(pu.id)
  const s = pu.usage
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" flex={1} minW={260}>
      <XStack items="center" gap="$2" justify="space-between">
        <XStack items="center" gap="$2">
          <YStack width={10} height={10} rounded={99} style={{ backgroundColor: color }} />
          <Text fontSize="$5" fontWeight="700">
            {labelFor(pu.id)}
          </Text>
        </XStack>
        {s?.identity?.plan ? (
          <Text fontSize="$1" color="$color10">
            {s.identity.plan}
          </Text>
        ) : null}
      </XStack>

      {!pu.ok || !s ? (
        <Text fontSize="$2" color="$color10">
          {pu.error || 'No usage available yet.'}
        </Text>
      ) : (
        <>
          <Lane title="Session" used={s.primary?.usedPercent} color={color} />
          <Lane title="Weekly" used={s.secondary?.usedPercent} color={color} />
          <XStack gap="$4" flexWrap="wrap">
            {s.providerCost ? (
              <Fact
                label="Spend"
                value={`${s.providerCost.used.toFixed(2)}${
                  typeof s.providerCost.limit === 'number' ? ` / ${s.providerCost.limit.toFixed(2)}` : ''
                } ${s.providerCost.currencyCode}`}
              />
            ) : null}
            {s.totals?.tokens ? <Fact label="Tokens" value={compact(s.totals.tokens)} /> : null}
            {s.totals?.requests ? <Fact label="Requests" value={compact(s.totals.requests)} /> : null}
          </XStack>
        </>
      )}
    </Card>
  )
}

/** The org's own Hanzo lane, from the real commerce ledger overview. */
function HanzoCard({ o }: { o: CloudUsageOverview }) {
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" flex={1} minW={260}>
      <XStack items="center" gap="$2" justify="space-between">
        <XStack items="center" gap="$2">
          <Gauge size={16} />
          <Text fontSize="$5" fontWeight="700">
            Hanzo
          </Text>
        </XStack>
        <Text fontSize="$1" color="$color10">
          this org · last 30d
        </Text>
      </XStack>
      <XStack gap="$4" flexWrap="wrap">
        <Fact label="Spend" value={usd(o.totals.spendCents)} />
        <Fact label="Tokens" value={compact(o.totals.tokens)} />
        <Fact label="Requests" value={compact(o.totals.requests)} />
        <Fact label="Models" value={String(o.totals.models)} />
      </XStack>
    </Card>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <YStack gap="$1">
      <Text fontSize="$1" color="$color10">
        {label}
      </Text>
      <Text fontSize="$5" fontWeight="600" color="$color12" className="hz-mono">
        {value}
      </Text>
    </YStack>
  )
}

/** The onboarding CTA shown when no external accounts are linked yet. */
function ConnectBanner({ onConnect }: { onConnect: () => void }) {
  return (
    <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" bg="$color2">
      <XStack items="center" gap="$2">
        <ExternalLink size={16} />
        <Text fontSize="$5" fontWeight="700">
          Connect your AI accounts
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11" maxW={640}>
        Link OpenAI, Anthropic, and more to see unified usage across desktop, mobile, web, and the CLI in one place.
        Optionally route usage through Hanzo for org sharing and analytics — a 1% fee applies to routed usage.
      </Text>
      <XStack>
        <Button size="$3" theme="light" iconAfter={<ArrowRight size={15} />} onPress={onConnect}>
          Connect accounts
        </Button>
      </XStack>
    </Card>
  )
}

export function AIAccountsOverview(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const [state, setState] = useState<Async<AccountsUsage>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    AiAccountsApi.usage()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const goAccounts = () => router.push('/ai-accounts/accounts')

  return (
    <>
      <PageHeader
        title="AI Accounts"
        subtitle="Unified usage across every AI account you connect, plus your Hanzo Cloud lane."
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
            <Button size="$2" theme="light" icon={<Boxes size={15} />} onPress={goAccounts}>
              Accounts
            </Button>
          </XStack>
        }
      />

      {state.phase === 'loading' ? (
        <Loader label="Loading usage…" />
      ) : state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} />
      ) : state.data.providers.length === 0 && !state.data.hanzo ? (
        <EmptyState
          icon={Boxes}
          title="Connect your AI accounts"
          description="Link your AI provider accounts to see unified usage across desktop, mobile, web, and the CLI — optionally routed through Hanzo for org sharing and analytics (1% fee on routed usage)."
          bullets={[
            'OpenAI / Codex, Anthropic / Claude, and more',
            'One dashboard for rate limits, spend, and tokens',
            'Your Hanzo Cloud usage is always included',
          ]}
          primary={{ label: 'Connect accounts', onPress: goAccounts, icon: <ArrowRight size={15} /> }}
        />
      ) : (
        <YStack gap="$4">
          {state.data.providers.length === 0 ? <ConnectBanner onConnect={goAccounts} /> : null}
          <XStack gap="$4" flexWrap="wrap">
            {state.data.hanzo ? <HanzoCard o={state.data.hanzo} /> : null}
            {state.data.providers.map((pu) => (
              <ProviderCard key={pu.id} pu={pu} />
            ))}
          </XStack>
        </YStack>
      )}
    </>
  )
}
