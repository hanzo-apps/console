'use client'

/**
 * Logs — structured application and platform log lines.
 *
 * HONEST STATE (verified against the live cluster): there is NO log-aggregation
 * backend deployed on this cluster — no Loki, no VictoriaLogs, no queryable log API.
 * The old source (`/paas/logs` → `platform.hanzo.ai/v1/logs`) does not exist (it
 * 401s), so this surface could never show a real log line. Rather than a misleading
 * "connected" empty grid or a broken error, this states the truth: structured log
 * search needs a log store (VictoriaLogs) that isn't deployed yet, and points at
 * the observability surfaces that DO have live data today (Status and Metrics, both
 * backed by VictoriaMetrics). It fabricates nothing.
 *
 * When a log store is deployed, this module wires to it (a `/telemetry`-style
 * read proxy → VictoriaLogs `/select/logsql/query`) and renders real lines — the
 * one place that changes is the data source, not this honest contract.
 */
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, BarChart3, ScrollText } from '@hanzogui/lucide-icons-2'

import { PageHeader } from '~/components/ui/PageHeader'

export function LogsModule(_props: { params: Record<string, string> }) {
  const go = (path: string) => {
    if (typeof window !== 'undefined') window.location.assign(path)
  }
  return (
    <>
      <PageHeader title="Logs" subtitle="Structured application and platform logs." />

      <Card borderWidth={1} borderColor="$borderColor" p="$5" gap="$3" maxWidth={680}>
        <XStack gap="$2" items="center">
          <ScrollText size={18} />
          <Text fontSize="$5" fontWeight="800">
            Log search is not connected yet
          </Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          Structured log search needs a log-aggregation store, and none is deployed on this cluster yet
          (VictoriaLogs / Loki). Until one is, this page shows no lines rather than a fabricated or empty grid —
          nothing here is placeholder data.
        </Text>
        <Text fontSize="$3" color="$color11">
          Live platform observability IS available today from VictoriaMetrics:
        </Text>
        <XStack gap="$2" flexWrap="wrap">
          <Button size="$3" theme="light" icon={<Activity size={15} />} onPress={() => go('/status')}>
            View Status
          </Button>
          <Button size="$3" icon={<BarChart3 size={15} />} onPress={() => go('/metrics')}>
            View Metrics
          </Button>
        </XStack>
        <YStack pt="$2" borderTopWidth={1} borderColor="$borderColor" gap="$1">
          <Text fontSize="$1" color="$color10">
            To light up real logs: deploy VictoriaLogs and wire a read-only `/telemetry`-style proxy to its
            `/select/logsql/query` API. This page then renders live lines with no other change.
          </Text>
        </YStack>
      </Card>
    </>
  )
}
