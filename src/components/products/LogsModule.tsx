'use client'

/**
 * Logs — structured application and platform log lines.
 *
 * HONEST STATE (verified against the o11y runtime, v1.3.12): the Hanzo o11y log
 * store (SigNoz, ClickHouse-backed) IS deployed and mounted at `/v1/o11y/*`, but it
 * exposes NO clean logs-list read route the console can render. Its `GET
 * /v1/o11y/v1/logs` is a hardcoded stub that always returns `{"results":[]}`
 * (deprecated), and the only real log read is a composite `POST
 * /v1/o11y/v4/query_range` builder query — a rich query-UI primitive, not a simple
 * "recent lines" list. Wiring this page to the stub would show a permanently-empty
 * "connected" grid (fabrication), and hard-coding a blind query_range payload isn't
 * the one right way. So this states the truth and points at the observability
 * surfaces that DO have live data today (Status and Metrics, both backed by
 * VictoriaMetrics). It fabricates nothing.
 *
 * NEEDS BACKEND: a real logs-list read route — either implement o11y's
 * `GET /api/v1/logs` (currently a stub) to return recent lines, or add a
 * `/telemetry`-style read proxy that fronts o11y's log query. This page then wires
 * to that ONE route and renders live lines with no other change.
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
          The Hanzo o11y log store is deployed, but it exposes no clean logs-list route yet: its
          `/v1/o11y/v1/logs` endpoint is a stub that returns nothing, and real reads need a composite
          query-builder request. Until a simple logs-list route is wired, this page shows no lines rather than a
          fabricated or empty grid — nothing here is placeholder data.
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
            To light up real logs: implement o11y's `GET /api/v1/logs` (currently a stub) to return recent lines,
            or add a read-only `/telemetry`-style proxy that fronts o11y's log query. This page then wires to that
            one route with no other change.
          </Text>
        </YStack>
      </Card>
    </>
  )
}
