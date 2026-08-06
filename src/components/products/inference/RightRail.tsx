'use client'

/**
 * Right rail — Usage Overview + Quick Actions + Need help. The Usage Overview reads the
 * REAL commerce usage ledger (the SAME source AI-Metrics + the platform overview use):
 * Total Requests / Tokens / Spend for the window, each with a live sparkline and a
 * prior-period delta, honest "—" when there is no basis. Quick Actions + Need help are
 * REAL in-console routes and real links — no dead buttons. When the ledger isn't routed
 * the overview says so honestly instead of showing zeros as if they were real.
 */
import { useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, BookOpen, DollarSign, Hash, KeyRound, LifeBuoy, MessageSquare, Play, Rocket } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import type { RangeKey } from '~/lib/api/aimetrics'
import type { InferenceData } from './data'
import { fmtCount, fmtUsd, usageWindow } from './logic'
import { MetricStat, SectionCard, Segmented, type Option } from './parts'
import { openExternal } from './panes'

const RANGE_OPTS: Option<RangeKey>[] = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
]

export function RightRail({ data, onDeploy, nav }: { data: InferenceData; onDeploy: () => void; nav: (path: string) => void }) {
  return (
    <YStack gap="$4" flex={1} minW={280}>
      <UsageOverviewCard data={data} />
      <QuickActionsCard onDeploy={onDeploy} nav={nav} />
      <NeedHelpCard />
    </YStack>
  )
}

function UsageOverviewCard({ data }: { data: InferenceData }) {
  const { records, hasLedger } = data
  const [range, setRange] = useState<RangeKey>('7d')
  const now = Date.now()
  const w = useMemo(() => usageWindow(records, range, now), [records, range, now])

  return (
    <SectionCard
      title="Usage Overview"
      actions={<Segmented options={RANGE_OPTS} value={range} onChange={setRange} />}
    >
      {!hasLedger ? (
        <Text fontSize="$2" color="$color10">
          Usage metrics light up when the billing ledger is connected for your organization — nothing is fabricated here.
        </Text>
      ) : (
        <YStack gap="$3.5">
          <MetricStat label="Total Requests" value={fmtCount(w.requests)} delta={w.delta.requests} series={w.series.requests} icon={<Activity size={14} opacity={0.6} />} />
          <MetricStat label="Total Tokens" value={fmtCount(w.tokens)} delta={w.delta.tokens} series={w.series.tokens} icon={<Hash size={14} opacity={0.6} />} />
          <MetricStat label="Total Spend" value={fmtUsd(w.cents)} delta={w.delta.cents} series={w.series.cents} icon={<DollarSign size={14} opacity={0.6} />} />
        </YStack>
      )}
    </SectionCard>
  )
}

/** One tappable action row (icon + label + optional sub). */
function ActionRow({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <XStack
      items="center"
      gap="$3"
      py="$2"
      px="$2"
      rounded="$3"
      cursor="pointer"
      hoverStyle={{ bg: '$color3' }}
      onPress={onPress}
    >
      <YStack width={30} height={30} items="center" justify="center" rounded="$3" bg="$color3">
        {icon}
      </YStack>
      <Text fontSize="$3" color="$color12" flex={1}>
        {label}
      </Text>
      <Text fontSize="$4" color="$color9">
        ›
      </Text>
    </XStack>
  )
}

function QuickActionsCard({ onDeploy, nav }: { onDeploy: () => void; nav: (path: string) => void }) {
  return (
    <SectionCard title="Quick Actions" p="$3">
      <YStack gap="$0.5">
        <ActionRow icon={<Rocket size={15} />} label="Deploy a new endpoint" onPress={onDeploy} />
        <ActionRow icon={<Play size={15} />} label="View Playground" onPress={() => nav('/playground')} />
        <ActionRow icon={<KeyRound size={15} />} label="Manage API Keys" onPress={() => nav('/api-keys')} />
        <ActionRow icon={<BookOpen size={15} />} label="View Documentation" onPress={() => openExternal(`${config.docsUrl}/docs/gateway`)} />
      </YStack>
    </SectionCard>
  )
}

function NeedHelpCard() {
  // The support mailbox derives from the brand's docs host (docs.hanzo.ai → hanzo.ai),
  // so a Lux/Zoo/Pars console links to its OWN support address — always a real mailto.
  const apex = config.docsUrl.replace(/^https?:\/\//, '').replace(/^docs\./, '')
  return (
    <SectionCard title="Need help?" p="$3">
      <YStack gap="$0.5">
        <ActionRow icon={<MessageSquare size={15} />} label="Join Discord" onPress={() => openExternal('https://discord.gg/CJCyAsm9Vr')} />
        <ActionRow icon={<LifeBuoy size={15} />} label="Contact Support" onPress={() => openExternal(`mailto:support@${apex}`)} />
      </YStack>
    </SectionCard>
  )
}
