'use client'

/**
 * GPUs · Overview — the at-a-glance board. Every metric/panel is a REAL backend
 * value or an honest empty/not-configured/error state:
 *  - Total/Online/Util/Mem/distribution: from the GPU inventory (`/paas/gpus`), or
 *    real GPU COUNTS derived from the org's GPU clusters when inventory is absent.
 *  - GPU hours: no source yet → honest `—`.
 *  - Est. cost (card): the cloud usage ledger (`/v1/get-cloud-usages`) → `—` (never
 *    relabels total account spend as GPU cost). Cost trend: same ledger, with the real
 *    commerce usage total (`/billing/usage`) as a clearly-labelled fallback.
 *  - Utilization-over-time: no telemetry stream yet → honest panel (NEVER fake lines).
 *  - Top clusters / Alerts: real cluster + alert data, honest-empty otherwise.
 */
import { useMemo, useState } from 'react'
import { Spinner, Text, XStack, YStack } from '@hanzo/gui'
import {
  Activity,
  Bell,
  Clock,
  Cpu,
  CreditCard,
  Gauge,
  HardDrive,
  KeyRound,
  Plus,
  Tag,
} from '@hanzogui/lucide-icons-2'

import {
  gpuClustersOf,
  summarize,
  fmtInt,
  fmtPct,
  usd,
  type Gpu,
} from '~/lib/api/compute'
import { BackendStateCard } from '@hanzo/ui/product'
import { PlatformStateCard } from '../platform/state'
import { GpuInventory } from './GpuInventory'
import {
  Donut,
  HintButton,
  LegendDot,
  MetricCard,
  MiniBars,
  Panel,
  SERIES,
  colorForIndex,
} from './charts'
import type { ComputeData } from './state'

const RANGES = ['1H', '6H', '24H', '7D', '30D'] as const
const SEV: Record<string, string> = { critical: '#e5534b', error: '#e5534b', warning: '#f0a868', warn: '#f0a868' }
const sevColor = (s?: string) => SEV[(s ?? '').toLowerCase()] ?? SERIES[0]

const fmtTime = (s?: string) => {
  if (!s) return ''
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

export function OverviewTab({
  data,
  onNav,
}: {
  data: ComputeData
  onNav: (tab: string) => void
}) {
  const { gpus, clusters, alerts, ledger, accountUsage } = data
  const [range, setRange] = useState<(typeof RANGES)[number]>('24H')

  const gpuRows: Gpu[] = gpus.phase === 'ready' ? gpus.data : []
  const gpuClusters = useMemo(
    () => (clusters.phase === 'ready' ? gpuClustersOf(clusters.data) : []),
    [clusters],
  )
  const summary = useMemo(
    () => summarize(gpus.phase === 'ready', gpuRows, gpuClusters),
    [gpus.phase, gpuRows, gpuClusters],
  )

  // The metric card reads the cloud usage ledger and degrades to `—` (never relabels
  // total account spend as GPU cost). The trend panel below keeps the real commerce
  // usage total as a CLEARLY-LABELLED fallback.
  const ledgerReady = ledger.phase === 'ready'
  const costCents = ledgerReady ? ledger.data.totalCents : null
  const costCaption = ledgerReady ? 'cloud usage ledger · 7d' : 'no ledger data yet'
  const costSpark = ledgerReady && ledger.data.daily.length >= 2 ? ledger.data.daily.map((d) => d.cents) : undefined

  const sourceCaption =
    summary.source === 'clusters'
      ? `across ${gpuClusters.length} GPU cluster${gpuClusters.length === 1 ? '' : 's'}`
      : summary.source === 'inventory'
        ? `${summary.byModel.length} model${summary.byModel.length === 1 ? '' : 's'}`
        : 'connect a provider'

  return (
    <YStack gap="$4">
      {/* Quick actions */}
      <XStack gap="$2" flexWrap="wrap">
        <HintButton icon={<Plus size={15} />} theme="light" onPress={() => onNav('clusters')}>
          Create cluster
        </HintButton>
        <HintButton icon={<Tag size={15} />} onPress={() => onNav('pricing')}>
          View pricing
        </HintButton>
        <HintButton icon={<KeyRound size={15} />} onPress={() => onNav('/secrets')}>
          Connect a provider
        </HintButton>
      </XStack>

      {/* 6 metric cards */}
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Cpu size={15} />} label="Total GPUs" value={summary.total == null ? '—' : fmtInt(summary.total)} caption={sourceCaption} />
        <MetricCard icon={<Activity size={15} />} label="Online" value={summary.online == null ? '—' : fmtInt(summary.online)} caption={summary.online == null ? 'live status when connected' : 'reporting online'} />
        <MetricCard icon={<Gauge size={15} />} label="Utilization avg" value={fmtPct(summary.utilAvg)} caption={summary.utilAvg == null ? 'no telemetry yet' : 'live average'} />
        <MetricCard icon={<HardDrive size={15} />} label="Memory util" value={fmtPct(summary.memUtilAvg)} caption={summary.memUtilAvg == null ? 'no telemetry yet' : 'live average'} />
        <MetricCard icon={<Clock size={15} />} label="GPU hours · 7D" value="—" caption="metered when a provider connects" />
        <MetricCard icon={<CreditCard size={15} />} label="Est. cost · 7D" value={usd(costCents)} caption={costCaption} spark={costSpark} sparkColor={SERIES[2]} />
      </XStack>

      {/* Utilization over time + distribution */}
      <XStack gap="$3" flexWrap="wrap">
        <Panel
          title="Utilization over time"
          minW={360}
          right={
            <XStack gap="$1">
              {RANGES.map((r) => (
                <Text
                  key={r}
                  fontSize="$1"
                  px="$2"
                  py="$1"
                  rounded="$2"
                  bg={r === range ? '$color5' : 'transparent'}
                  color={r === range ? '$color12' : '$color10'}
                  cursor="pointer"
                  onPress={() => setRange(r)}
                >
                  {r}
                </Text>
              ))}
            </XStack>
          }
        >
          <YStack height={140} items="center" justify="center" gap="$2" borderWidth={1} borderColor="$borderColor" borderStyle="dashed" rounded="$3">
            <Activity size={20} />
            <Text fontSize="$2" color="$color11" text="center" maxW={360}>
              Utilization history ({range}) appears here once a GPU provider streams telemetry.
              {summary.utilAvg != null ? ` Current average: ${fmtPct(summary.utilAvg)}.` : ''}
            </Text>
          </YStack>
        </Panel>

        <Panel title="GPU distribution by model" minW={260}>
          {summary.byModel.length ? (
            <XStack gap="$4" items="center" flexWrap="wrap">
              <Donut slices={summary.byModel.map((m, i) => ({ label: m.model, value: m.count, color: colorForIndex(i) }))} />
              <YStack gap="$2" flex={1} minW={140}>
                {summary.byModel.map((m, i) => (
                  <LegendDot key={m.model} color={colorForIndex(i)} label={m.model} value={fmtInt(m.count)} />
                ))}
              </YStack>
            </XStack>
          ) : (
            <YStack height={140} items="center" justify="center">
              <Text fontSize="$2" color="$color10">
                No GPUs to chart yet.
              </Text>
            </YStack>
          )}
        </Panel>
      </XStack>

      {/* Top clusters + Alerts */}
      <XStack gap="$3" flexWrap="wrap">
        <Panel title="Top clusters" minW={320} right={<Text fontSize="$2" color="$color10" cursor="pointer" onPress={() => onNav('clusters')}>View all</Text>}>
          {clusters.phase === 'loading' ? (
            <XStack p="$3" gap="$2" items="center"><Spinner /><Text color="$color11">Loading clusters…</Text></XStack>
          ) : clusters.phase === 'error' ? (
            <PlatformStateCard error={clusters.error} onRetry={data.reload} />
          ) : gpuClusters.length === 0 ? (
            <Text fontSize="$2" color="$color10">No GPU clusters yet. Create one in Clusters, or keep running on shared Hanzo Cloud.</Text>
          ) : (
            <YStack gap="$2">
              {gpuClusters.slice(0, 6).map((gc) => (
                <XStack key={gc.cluster.id || gc.cluster.name} items="center" justify="space-between" gap="$2" py="$1">
                  <YStack flex={1} minW={120}>
                    <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{gc.cluster.name}</Text>
                    <Text fontSize="$1" color="$color10">{gc.gpuCount} × {gc.model}{gc.cluster.region ? ` · ${gc.cluster.region}` : ''}</Text>
                  </YStack>
                  <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">{gc.cluster.phase || gc.cluster.status}</Text>
                </XStack>
              ))}
            </YStack>
          )}
        </Panel>

        <Panel title="Alerts" minW={300} right={<Text fontSize="$2" color="$color10" cursor="pointer" onPress={() => onNav('alerts')}>View all</Text>}>
          {alerts.phase === 'loading' ? (
            <XStack p="$3" gap="$2" items="center"><Spinner /><Text color="$color11">Loading…</Text></XStack>
          ) : alerts.phase === 'error' ? (
            alerts.error.kind === 'error' ? (
              <Text fontSize="$2" color="$color10">Alerts unavailable right now.</Text>
            ) : (
              <Text fontSize="$2" color="$color10">Alerting connects with a GPU provider — no alerts to show.</Text>
            )
          ) : alerts.data.length === 0 ? (
            <XStack items="center" gap="$2"><Bell size={15} /><Text fontSize="$2" color="$color10">No alerts. Everything looks healthy.</Text></XStack>
          ) : (
            <YStack gap="$2">
              {alerts.data.slice(0, 6).map((a) => (
                <XStack key={a.id} items="flex-start" gap="$2" py="$1">
                  <YStack pt="$1"><YStack width={8} height={8} rounded="$10" bg={sevColor(a.severity) as never} /></YStack>
                  <YStack flex={1}>
                    <Text fontSize="$2" color="$color12" numberOfLines={2}>{a.message || a.kind || 'Alert'}</Text>
                    <Text fontSize="$1" color="$color10" numberOfLines={1}>{[a.cluster, a.gpu, fmtTime(a.at)].filter(Boolean).join(' · ')}</Text>
                  </YStack>
                </XStack>
              ))}
            </YStack>
          )}
        </Panel>
      </XStack>

      {/* GPU table */}
      <YStack gap="$2">
        <Text fontSize="$5" fontWeight="800" color="$color12">GPUs</Text>
        <GpuInventory gpus={gpus} gpuClusters={gpuClusters} summary={summary} reload={data.reload} onNav={onNav} pageSize={8} />
      </YStack>

      {/* Cost trend */}
      <Panel title="Cost trend · 7D" minW={320} right={<Text fontSize="$2" color="$color10" cursor="pointer" onPress={() => onNav('pricing')}>Pricing</Text>}>
        {ledger.phase === 'loading' ? (
          <XStack p="$3" gap="$2" items="center"><Spinner /><Text color="$color11">Loading usage…</Text></XStack>
        ) : ledger.phase === 'ready' && ledger.data.daily.length ? (
          <YStack gap="$2">
            <Text fontSize="$7" fontWeight="900" color="$color12">{usd(ledger.data.totalCents)}</Text>
            <MiniBars bars={ledger.data.daily.map((d) => ({ label: d.day, value: d.cents }))} color={SERIES[2]} />
            {ledger.data.byModel.slice(0, 3).map((l, i) => (
              <LegendDot key={l.label} color={colorForIndex(i)} label={l.label} value={usd(l.cents)} />
            ))}
          </YStack>
        ) : ledger.phase === 'ready' ? (
          <Text fontSize="$2" color="$color10">No metered usage in the last 7 days.</Text>
        ) : accountUsage.phase === 'ready' ? (
          <YStack gap="$1">
            <Text fontSize="$7" fontWeight="900" color="$color12">{usd(accountUsage.data.totalCents)}</Text>
            <Text fontSize="$2" color="$color10">Metered account usage this period. Per-day GPU cost trend appears when the usage-ledger reader ships.</Text>
          </YStack>
        ) : ledger.phase === 'error' ? (
          <BackendStateCard state={ledger.error} onRetry={data.reload} hint="endpoint · GET /v1/get-cloud-usages" />
        ) : null}
      </Panel>
    </YStack>
  )
}
