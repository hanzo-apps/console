'use client'

/**
 * GPUs · Alerts — GPU alerts from the platform (`GET /paas/gpus/alerts`, shared via
 * `data.alerts`). High-temp / offline / driver-update / backup events when a provider
 * streams them; honest not-configured / empty otherwise — never fabricated alerts.
 */
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Bell, RefreshCw } from '@hanzogui/lucide-icons-2'

import type { GpuAlert } from '~/lib/api/compute'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { EmptyState } from '~/components/ui/EmptyState'
import { PlatformStateCard } from '../platform/state'
import type { ComputeData } from './state'
import { toneVar } from '~/components/ui/tone-var'

const SEV: Record<string, string> = { critical: toneVar('critical'), error: toneVar('critical'), warning: toneVar('warning'), warn: toneVar('warning'), info: toneVar('neutral') }
const sevColor = (s?: string) => SEV[(s ?? '').toLowerCase()] ?? toneVar('neutral')
const fmtTime = (s?: string) => {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

const columns: Column<GpuAlert>[] = [
  {
    key: 'severity',
    header: 'Severity',
    width: 120,
    render: (a) => (
      <XStack items="center" gap="$2">
        <YStack width={8} height={8} rounded="$10" bg={sevColor(a.severity) as never} />
        <Text fontSize="$3" color="$color11">{a.severity ?? '—'}</Text>
      </XStack>
    ),
  },
  { key: 'kind', header: 'Type', width: 130, render: (a) => <Text fontSize="$3" color="$color11">{a.kind ?? '—'}</Text> },
  { key: 'message', header: 'Alert', render: (a) => <Text fontSize="$3" color="$color12" numberOfLines={2}>{a.message || a.kind || 'Alert'}</Text> },
  { key: 'resource', header: 'Resource', width: 180, render: (a) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{[a.cluster, a.gpu].filter(Boolean).join(' · ') || '—'}</Text> },
  { key: 'at', header: 'Time', width: 180, render: (a) => <Text fontSize="$2" color="$color10">{fmtTime(a.at)}</Text> },
]

export function AlertsTab({ data }: { data: ComputeData }) {
  const { alerts } = data
  return (
    <>
      <XStack justify="flex-end">
        <Button size="$2" icon={<RefreshCw size={15} />} onPress={data.reload}>Refresh</Button>
      </XStack>

      {alerts.phase === 'loading' ? (
        <Text color="$color11" p="$3">Loading alerts…</Text>
      ) : alerts.phase === 'error' && alerts.error.kind !== 'error' ? (
        <PlatformStateCard error={alerts.error} onRetry={data.reload} />
      ) : alerts.phase === 'error' ? (
        <EmptyState icon={Bell} title="Alerts unavailable" description="GPU alerting connects with a GPU provider. Once telemetry streams, high-temperature, offline, driver-update, and backup events appear here." />
      ) : alerts.data.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No alerts"
          description="Everything looks healthy. High-temperature, offline, driver-update, and backup events will appear here when a GPU provider streams telemetry."
        />
      ) : (
        <DataTable columns={columns} rows={alerts.data} rowKey={(a) => a.id} empty="No alerts." />
      )}
    </>
  )
}
