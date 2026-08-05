'use client'

/**
 * Workloads — the operator-managed services running on a cluster, from the REAL
 * apps inventory (`GET /v1/apps`, the canonical "what is running" board: a
 * workload IS a Service CR + its Deployment). Rows carry the declared/running
 * tag, drift, and health the control plane reports — never fabricated pods or
 * fake CPU bars. Pod-level ready/restarts/CPU/memory are POD-level facts, so they
 * live on the Pods tab; this workload-level board shows what the inventory exposes.
 */
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { ChevronRight } from '@hanzogui/lucide-icons-2'

import type { PlatformApp } from '~/lib/api'
import { fmtAge } from './resource'
import { toneColor } from '~/components/ui/tone'
import { DataTable, StatusTag, type Column } from '@hanzo/ui/product'

function DriftBadge({ app }: { app: PlatformApp }) {
  const sev = app.drift?.severity
  if (!sev || sev.toLowerCase() === 'none') return <Text fontSize="$2" color="$color10">—</Text>
  const hot = ['high', 'critical', 'error'].includes(sev.toLowerCase())
  return (
    <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color4" color={hot ? toneColor('critical') : '$color12'}>
      {sev}
    </Text>
  )
}

export function WorkloadsTab({ apps }: { apps: PlatformApp[] }) {
  const router = useRouter()

  const columns: Column<PlatformApp>[] = useMemo(
    () => [
      {
        key: 'app',
        header: 'Workload',
        render: (a) => (
          <YStack>
            <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{a.app}</Text>
            <Text fontSize="$1" color="$color10" numberOfLines={1}>{a.runningTag ? `running ${a.runningTag}` : 'no running tag'}</Text>
          </YStack>
        ),
      },
      { key: 'namespace', header: 'Namespace', width: 150, render: (a) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{a.namespace ?? '—'}</Text> },
      { key: 'env', header: 'Env', width: 70, render: (a) => <Text fontSize="$3" color="$color11">{a.env}</Text> },
      { key: 'status', header: 'Health', width: 100, render: (a) => <StatusTag status={a.health} /> },
      { key: 'declared', header: 'Declared', width: 130, render: (a) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{a.declaredTag ?? '—'}</Text> },
      { key: 'drift', header: 'Drift', width: 90, render: (a) => <DriftBadge app={a} /> },
      { key: 'age', header: 'Age', width: 70, render: (a) => <Text fontSize="$3" color="$color11">{fmtAge(a.lastObserved ?? a.updatedAt)}</Text> },
      {
        key: 'actions',
        header: '',
        width: 100,
        render: (a) => (
          <XStack justify="flex-end" flex={1}>
            <Button size="$2" iconAfter={<ChevronRight size={14} />} onPress={() => router.push(`/logs?app=${encodeURIComponent(a.app)}`)}>
              Logs
            </Button>
          </XStack>
        ),
      },
    ],
    [router],
  )

  return (
    <YStack gap="$2">
      <DataTable
        columns={columns}
        rows={apps}
        rowKey={(a) => a.id}
        empty="No workloads observed on this cluster yet."
      />
      <Text fontSize="$1" color="$color10">
        Pod-level ready / restarts / CPU / memory are per-pod facts — see the Pods tab.
      </Text>
    </YStack>
  )
}
