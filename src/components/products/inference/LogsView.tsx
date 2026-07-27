'use client'

/**
 * Inference · Logs — a rich inference activity stream in the dashboard's dark-card
 * language. It renders the REAL recorded inference requests for the org (the commerce
 * usage ledger is one row per billed inference call — timestamp, endpoint/model, status,
 * summary), filterable by endpoint and level. These are genuine recorded events, never
 * fabricated log lines. Honest states: when the ledger isn't routed on this deployment,
 * an honest "not connected" card (full request/response logs stream from observability
 * once connected); when it's reachable but empty, an honest "no activity yet".
 */
import { useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ChevronRight, FileText, RefreshCw } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { useDetailPane } from '~/components/DetailPane'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { useInferenceData } from './data'
import { SectionCard, Segmented, StatusDot, type Option } from './parts'
import { openLogDetail } from './panes'
import { distinctLevels, distinctModels, logsFromRecords, type LogLine } from './logic'

const LIMIT = 200

/** A recorded-status badge (dot + label), green success / red error / neutral other. */
function LevelTag({ level }: { level: string }) {
  const l = level.toLowerCase()
  const color = l === 'error' || l === 'failed' || l === 'fail' ? '#ff5d8f' : l === 'success' || l === 'ok' ? '#23c562' : '#64748b'
  return (
    <XStack items="center" gap="$1.5">
      <StatusDot color={color} size={8} />
      <Text fontSize="$2" color="$color11">
        {level || '—'}
      </Text>
    </XStack>
  )
}

export function LogsView() {
  const { records, hasLedger, loading, reload } = useInferenceData()
  const pane = useDetailPane()
  const [endpoint, setEndpoint] = useState('all')
  const [level, setLevel] = useState('all')

  const models = useMemo(() => distinctModels(records), [records])
  const levels = useMemo(() => distinctLevels(records), [records])
  const rows = useMemo(() => logsFromRecords(records, { endpoint, level }, LIMIT), [records, endpoint, level])

  const endpointOpts: Option<string>[] = [{ label: 'All endpoints', value: 'all' }, ...models.map((m) => ({ label: m, value: m }))]
  const levelOpts: Option<string>[] = [{ label: 'All levels', value: 'all' }, ...levels.map((l) => ({ label: l, value: l }))]

  const columns: Column<LogLine>[] = [
    {
      key: 'time',
      header: 'Time',
      width: 190,
      render: (l) => (
        <Text fontSize="$2" fontWeight="600" color="$color12" numberOfLines={1}>
          {l.at ? new Date(l.at).toLocaleString() : '—'}
        </Text>
      ),
    },
    {
      key: 'endpoint',
      header: 'Endpoint',
      width: 170,
      render: (l) => (
        <Text fontSize="$2" color="$color11" numberOfLines={1}>
          {l.endpoint}
        </Text>
      ),
    },
    { key: 'level', header: 'Level', width: 120, render: (l) => <LevelTag level={l.level} /> },
    {
      key: 'message',
      header: 'Message',
      render: (l) => (
        <Text fontSize="$2" color="$color11" numberOfLines={1}>
          {l.message}
        </Text>
      ),
    },
    { key: 'open', header: '', width: 28, render: () => <ChevronRight size={15} color="$color9" /> },
  ]

  return (
    <YStack gap="$4">
      <PageHeader
        title="Inference · Logs"
        subtitle="Recorded inference activity for your organization — one row per request."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={reload}>
            Refresh
          </Button>
        }
      />

      {!hasLedger && !loading ? (
        <Card borderWidth={1} borderColor="$borderColor" bg="$color2" rounded="$5" p="$4" gap="$2" maxW={680}>
          <XStack items="center" gap="$2">
            <FileText size={16} color="$color10" />
            <Text fontSize="$4" fontWeight="700" color="$color12">
              Inference logs not connected on this deployment
            </Text>
          </XStack>
          <Text fontSize="$3" color="$color11">
            Recorded inference requests appear here from your organization's usage ledger, and full request/response
            logs stream in once observability is connected. Nothing is fabricated until a real source is reachable.
          </Text>
        </Card>
      ) : (
        <SectionCard
          title="Inference activity"
          subtitle="Recorded requests from your organization's usage ledger — select a row to see the full call detail. Full request/response text streams from observability when connected."
          actions={
            <XStack gap="$3" items="center" flexWrap="wrap">
              {endpointOpts.length > 1 ? <Segmented options={endpointOpts} value={endpoint} onChange={setEndpoint} /> : null}
              {levelOpts.length > 1 ? <Segmented options={levelOpts} value={level} onChange={setLevel} /> : null}
            </XStack>
          }
        >
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(l) => l.id}
            onRowPress={(l) => openLogDetail(pane, { line: l })}
            empty="No inference activity in your organization yet."
          />
        </SectionCard>
      )}
    </YStack>
  )
}
