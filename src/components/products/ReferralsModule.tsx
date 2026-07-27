'use client'

/**
 * Referrals — the customer viral-loop screen over the REAL cloud `/v1/referrals`
 * surface (cloud `clients/referrals`). One clean screen: your referral link with a
 * Copy button, a reward explainer, three real stat tiles (invites / qualified /
 * credit earned), and your referrals list with live status. Every value is real or
 * an honest empty/`—`; states are loading / BackendStateCard / empty — never a
 * fabricated row. Org-scoped SERVER-SIDE (the `/v1` bearer proxy); no credential
 * in the browser.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Check, CircleCheck, Coins, Copy, Gift, RefreshCw, Users } from '@hanzogui/lucide-icons-2'

import { ReferralsApi, type ReferralOverview } from '~/lib/api/referrals'
import { PageHeader } from '@hanzo/ui/product'
import { MetricCard } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { progressCaption, shortDate, statusLabel, statusTone, usd } from './referrals/logic'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

export function ReferralsModule() {
  const [state, setState] = useState<Async<ReferralOverview>>({ phase: 'loading' })
  const [copied, setCopied] = useState(false)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    ReferralsApi.overview()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const copy = useCallback((link: string) => {
    try {
      void navigator.clipboard?.writeText(link)
    } catch {
      /* clipboard may be unavailable — the link is selectable in the field */
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [])

  return (
    <YStack gap="$3">
      <PageHeader
        title="Referrals"
        subtitle="Invite teams to Hanzo — earn cloud credit when they get started."
        actions={
          <Button size="$3" icon={<RefreshCw size={15} />} onPress={load} disabled={state.phase === 'loading'}>
            Refresh
          </Button>
        }
      />

      {state.phase === 'loading' && <Text color="$color10">Loading your referral program…</Text>}
      {state.phase === 'error' && (
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/referrals" />
      )}
      {state.phase === 'ready' && <ReferralsReady data={state.data} copied={copied} onCopy={copy} />}
    </YStack>
  )
}

function ReferralsReady({
  data,
  copied,
  onCopy,
}: {
  data: ReferralOverview
  copied: boolean
  onCopy: (link: string) => void
}) {
  return (
    <YStack gap="$3">
      {/* Link + reward explainer */}
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack items="center" gap="$2">
          <Gift size={18} color="#a371f7" />
          <Text fontSize="$5" fontWeight="700">
            Give {usd(data.refereeBonusCents)}, get {usd(data.referrerBonusCents)}
          </Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          Share your link. When a new team signs up and starts using Hanzo, they get {usd(data.refereeBonusCents)} in
          bonus credit and you earn {usd(data.referrerBonusCents)}.
        </Text>
        <XStack gap="$2" items="center" flexWrap="wrap">
          <Card
            flex={1}
            minW={220}
            px="$3"
            py="$2.5"
            bg="$color2"
            borderWidth={1}
            borderColor="$borderColor"
            rounded="$3"
          >
            <Text style={{ fontFamily: 'monospace' }} fontSize="$3" color="$color12">
              {data.link || '—'}
            </Text>
          </Card>
          <Button
            size="$3"
           
            icon={copied ? <Check size={15} /> : <Copy size={15} />}
            onPress={() => onCopy(data.link)}
            disabled={!data.link}
          >
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </XStack>
        {data.code ? (
          <Text fontSize="$2" color="$color10">
            Your code: <Text style={{ fontFamily: 'monospace' }}>{data.code}</Text>
          </Text>
        ) : null}
      </Card>

      {/* Real stat tiles */}
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Users size={16} color="#8b949e" />} label="Invites" value={String(data.counts.total)} caption="teams referred" />
        <MetricCard
          icon={<CircleCheck size={16} color="#3fb950" />}
          label="Credited"
          value={String(data.counts.credited)}
          caption={data.counts.qualified ? `${data.counts.qualified} qualifying` : 'rewarded referrals'}
        />
        <MetricCard
          icon={<Coins size={16} color="#d29922" />}
          label="Credit earned"
          value={usd(data.creditsEarnedCents)}
          caption="added to your balance"
        />
      </XStack>

      {/* Referrals list */}
      <Card p="$0" borderWidth={1} borderColor="$borderColor" overflow="hidden">
        <XStack px="$4" py="$3" borderBottomWidth={1} borderColor="$borderColor">
          <Text fontSize="$4" fontWeight="700">
            Your referrals
          </Text>
        </XStack>
        {data.referrals.length === 0 ? (
          <YStack p="$5" items="center" gap="$2">
            <Gift size={22} color="#6e7681" />
            <Text fontSize="$3" color="$color11">
              No referrals yet
            </Text>
            <Text fontSize="$2" color="$color10">
              Share your link above to start earning credit.
            </Text>
          </YStack>
        ) : (
          <YStack>
            {data.referrals.map((r) => (
              <XStack
                key={r.id}
                px="$4"
                py="$3"
                items="center"
                justify="space-between"
                gap="$3"
                borderBottomWidth={1}
                borderColor="$borderColor"
                flexWrap="wrap"
              >
                <YStack gap="$1" flex={1} minW={180}>
                  <Text fontSize="$3" fontWeight="600" color="$color12">
                    {r.referee || 'New team'}
                  </Text>
                  <Text fontSize="$2" color="$color10">
                    {progressCaption(r)} · {shortDate(r.createdAt)}
                  </Text>
                </YStack>
                <XStack items="center" gap="$3">
                  <Text fontSize="$2" fontWeight="700" color={statusTone(r.status)}>
                    {statusLabel(r.status)}
                  </Text>
                  <Text fontSize="$3" fontWeight="700" color="$color12" minW={64} text="right">
                    {r.creditsCents ? usd(r.creditsCents) : '—'}
                  </Text>
                </XStack>
              </XStack>
            ))}
          </YStack>
        )}
      </Card>
    </YStack>
  )
}
