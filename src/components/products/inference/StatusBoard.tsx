'use client'

/**
 * Inference · Status — a rich per-endpoint health board in the same dark-card /
 * monochrome language as the main dashboard. An overall "Connected to <brand>" summary (real
 * ready/provisioning/failed tally from the live endpoint status) sits above a per-
 * endpoint health table: status dot + availability badge + a 7-day activity sparkline
 * (REAL ledger requests). Uptime + P95 render an honest "—" (no per-endpoint source
 * yet). Honest empty when there are no endpoints; the shared backend-state card on a
 * hard failure — never a fabricated green or a made-up uptime.
 */
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, ShieldCheck, Zap } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { EmptyState } from '~/components/ui/EmptyState'
import { BackendStateCard } from '~/components/ui/BackendState'
import { StatusTag } from '~/components/ui/StatusTag'
import { useInferenceData } from './data'
import { CellStat, MiniSparkline, SectionCard, StatusDot } from './parts'
import { PHASE_DOT, endpointDailyRequests, statusSummary, type Endpoint } from './logic'

type Row = { e: Endpoint; spark: number[] }

export function StatusBoard() {
  const { endpoints, records, loading, error, reload } = useInferenceData()
  const now = Date.now()
  const summary = statusSummary(endpoints)
  const brand = config.brandName || 'Hanzo Cloud'

  const rows: Row[] = endpoints.map((e) => ({ e, spark: endpointDailyRequests(records, e.name, '7d', now) }))

  const columns: Column<Row>[] = [
    {
      key: 'endpoint',
      header: 'Endpoint',
      render: ({ e }) => (
        <XStack items="center" gap="$2.5">
          <StatusDot color={PHASE_DOT[e.phase]} />
          <YStack flex={1} gap="$0.5">
            <Text fontSize="$3" fontWeight="700" color="$color12" numberOfLines={1}>
              {e.name}
            </Text>
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              {[e.kind === 'deployed' ? 'Deployed' : 'Managed', e.type].join(' · ')}
            </Text>
          </YStack>
        </XStack>
      ),
    },
    { key: 'availability', header: 'Availability', width: 130, render: ({ e }) => <StatusTag status={e.phaseLabel} /> },
    { key: 'uptime', header: 'Uptime (7d)', width: 104, render: () => <CellStat value="—" /> },
    { key: 'p95', header: 'P95 Latency', width: 108, render: () => <CellStat value="—" /> },
    { key: 'activity', header: 'Activity (7d)', width: 128, render: ({ spark }) => <MiniSparkline series={spark} /> },
  ]

  return (
    <YStack gap="$4">
      <PageHeader
        title="Inference · Status"
        subtitle="Live health of your model-serving endpoints on managed Hanzo Cloud."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={reload}>
            Refresh
          </Button>
        }
      />

      {error ? (
        <BackendStateCard state={error} onRetry={reload} hint="source · GET /v1/models · GET /v1/ml/models" />
      ) : !loading && endpoints.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="No endpoints to report on yet"
          description="Deploy a model-serving endpoint and its live health, availability, and activity appear here — nothing is fabricated."
          primary={{ label: 'Documentation', href: `${config.docsUrl}/docs/gateway` }}
        />
      ) : (
        <>
          <SummaryCard brand={brand} summary={summary} loading={loading} />
          <SectionCard title="Endpoint health">
            <DataTable columns={columns} rows={rows} loading={loading} rowKey={(r) => r.e.id} empty="No endpoints reporting yet." />
          </SectionCard>
        </>
      )}
    </YStack>
  )
}

/** The overall "Connected to <brand>" health summary — real counts, honest tone. */
function SummaryCard({ brand, summary, loading }: { brand: string; summary: ReturnType<typeof statusSummary>; loading: boolean }) {
  const tone = summary.failed > 0 ? '#f0a868' : '#23c562'
  const stat = (label: string, value: number) => (
    <YStack gap="$0.5" minW={92}>
      <Text fontSize="$1" color="$color10">
        {label}
      </Text>
      <Text fontSize="$6" fontWeight="800" color="$color12">
        {loading ? '—' : value.toLocaleString()}
      </Text>
    </YStack>
  )
  return (
    <Card borderWidth={1} borderColor="$borderColor" bg="$color2" rounded="$5" p="$4" gap="$3.5">
      <XStack items="center" gap="$2.5">
        <YStack width={32} height={32} items="center" justify="center" rounded="$4" style={{ backgroundColor: 'rgba(35,197,98,0.14)' }}>
          <ShieldCheck size={18} color={tone} />
        </YStack>
        <YStack gap="$0.5" flex={1}>
          <Text fontSize="$5" fontWeight="800" color="$color12">
            Connected to {brand}
          </Text>
          <Text fontSize="$2" color="$color10">
            {loading ? 'Probing your endpoints…' : `${summary.total} endpoint${summary.total === 1 ? '' : 's'} · managed control plane`}
          </Text>
        </YStack>
      </XStack>
      <XStack gap="$4" flexWrap="wrap">
        {stat('Endpoints', summary.total)}
        {stat('Ready', summary.ready)}
        {stat('Provisioning', summary.provisioning)}
        {stat('Failed', summary.failed)}
      </XStack>
    </Card>
  )
}
