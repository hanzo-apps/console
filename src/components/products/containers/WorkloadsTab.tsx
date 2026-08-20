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
import { useRouter } from '~/lib/router'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { ChevronRight } from '@hanzogui/lucide-icons-2'

import type { PlatformApp } from '~/lib/api'
import { driftLabel } from '~/lib/api/platform'
import { fmtAge } from './resource'
import { toneColor } from '~/components/ui/tone'
import { DataTable, StatusTag, type Column } from '@hanzo/ui/product'

/**
 * The drift cell states the REASON, not just the register. `driftLabel` names the
 * inventory's own flag kinds (`stale`, `un-rolled`, `floating-declared`, …) worst-first,
 * so a drifting row says what is wrong with it; the severity alone sent you to kubectl
 * to find out what the payload already knew.
 */
function DriftBadge({ app }: { app: PlatformApp }) {
  const label = driftLabel(app)
  if (!label) return <Text fontSize="$2" color="$color10">—</Text>
  const sev = (app.drift?.severity ?? '').toLowerCase()
  const hot = ['high', 'critical', 'error', 'red'].includes(sev)
  return (
    <Text
      fontSize="$1"
      px="$2"
      py="$1"
      rounded="$2"
      bg="$color4"
      color={hot ? toneColor('critical') : '$color12'}
      numberOfLines={2}
    >
      {label}
    </Text>
  )
}

/** The declared tag, plus the latest available one when the two have parted. */
function DeclaredCell({ app }: { app: PlatformApp }) {
  const declared = app.declaredTag ?? '—'
  const latest = app.latestTag
  const behind = !!latest && latest !== app.declaredTag
  return (
    <YStack minW={0}>
      <Text fontSize="$2" color="$color11" numberOfLines={1}>
        {declared}
      </Text>
      {behind ? (
        <Text fontSize="$1" color="$color10" numberOfLines={1}>
          latest {latest}
        </Text>
      ) : null}
    </YStack>
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
      { key: 'status', header: 'Health', width: 100, render: (a) => <StatusTag status={a.health} /> },
      // Declared AND latest share one cell. They are the two ends of the same gap — the
      // one `stale` names — so reading it should not mean reading across the row, and a
      // second fixed column would have pushed Drift off the board entirely on a 1280px
      // screen, hiding the verdict this column exists to explain. `latest` shows only
      // when it DIFFERS: when the two agree there is no gap, and printing the same string
      // twice is noise that trains the eye to skip the cell.
      { key: 'declared', header: 'Declared', width: 150, render: (a) => <DeclaredCell app={a} /> },
      // Drift sits FOURTH, next to the tags it is a verdict on. Nine columns do not fit
      // the width this board is given beside the cluster panel, so the order decides what
      // is read and what is scrolled to: health, versions and drift answer "should I look
      // at this one", and namespace/env/age/logs are what you want once the answer is yes.
      { key: 'drift', header: 'Drift', width: 130, render: (a) => <DriftBadge app={a} /> },
      { key: 'namespace', header: 'Namespace', width: 150, render: (a) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{a.namespace ?? '—'}</Text> },
      { key: 'env', header: 'Env', width: 70, render: (a) => <Text fontSize="$3" color="$color11">{a.env}</Text> },
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
