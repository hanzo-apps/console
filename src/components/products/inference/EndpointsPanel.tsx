'use client'

/**
 * Endpoints panel — the left column of the Inference dashboard. Renders the org's REAL
 * model-serving endpoints (managed catalog + deployed InferenceServices) with a search /
 * status / type / sort toolbar, a list⇄grid toggle, and pagination. Per-endpoint
 * Requests (24h) + the trend sparkline are REAL ledger metrics matched by model id;
 * P95 latency + uptime render an honest "—" (no per-endpoint source yet). Honest states
 * throughout: loading, a backend-state card on a hard failure, and a rich "no endpoints
 * yet" first-run surface — never the mockup's placeholder rows.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { LayoutGrid, List as ListIcon, MoreVertical, Zap } from '@hanzogui/lucide-icons-2'

import { useDetailPane } from '~/components/DetailPane'
import { DataTable, type Column } from '@hanzo/ui/product'
import { EmptyState } from '@hanzo/ui/product'
import { BackendStateCard } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import type { InferenceData } from './data'
import {
  PHASE_DOT,
  distinctTypes,
  endpointDailyRequests,
  filterEndpoints,
  fmtCount,
  paginate,
  perModelMap,
  requestsByModel,
  sortEndpoints,
  type Endpoint,
  type EndpointSort,
} from './logic'
import { CellStat, MiniSparkline, SearchInput, Segmented, StatusDot, type Option } from './parts'
import { openDeployPane, openEndpointDetail } from './panes'

const PAGE = 8

type RowVM = { e: Endpoint; req24h: number | null; spark: number[] }

const STATUS_OPTS: Option<string>[] = [
  { label: 'All Status', value: 'all' },
  { label: 'Available', value: 'available' },
  { label: 'Ready', value: 'ready' },
  { label: 'Provisioning', value: 'provisioning' },
  { label: 'Failed', value: 'failed' },
]
const SORT_OPTS: Option<EndpointSort>[] = [
  { label: 'Recently Updated', value: 'recent' },
  { label: 'Name', value: 'name' },
  { label: 'Requests', value: 'requests' },
]

export function EndpointsPanel({ data }: { data: InferenceData }) {
  const { endpoints, records, hasLedger, loading, error, reload } = data
  const router = useRouter()
  const pane = useDetailPane()
  const nav = (path: string) => {
    pane.close()
    router.push(path)
  }

  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')
  const [sort, setSort] = useState<EndpointSort>('recent')
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [page, setPage] = useState(1)

  // Reset to the first page whenever the filter/sort narrows the set.
  useEffect(() => setPage(1), [q, status, type, sort])

  const now = Date.now()
  const reqMap = useMemo(() => requestsByModel(records, '24h', now), [records, now])
  const per24 = useMemo(() => perModelMap(records, '24h', now), [records, now])

  const typeOpts: Option<string>[] = useMemo(
    () => [{ label: 'All Types', value: 'all' }, ...distinctTypes(endpoints).map((t) => ({ label: t, value: t }))],
    [endpoints],
  )

  const filtered = useMemo(() => filterEndpoints(endpoints, { q, type, phase: status }), [endpoints, q, type, status])
  const sorted = useMemo(() => sortEndpoints(filtered, sort, reqMap), [filtered, sort, reqMap])
  const pageInfo = paginate(sorted, page, PAGE)

  const rows: RowVM[] = pageInfo.slice.map((e) => ({
    e,
    req24h: hasLedger ? (per24.get(e.name)?.requests ?? 0) : null,
    spark: endpointDailyRequests(records, e.name, '7d', now),
  }))

  const openRow = (e: Endpoint) => openEndpointDetail(pane, { endpoint: e, records, hasLedger, nav })

  const toolbar = (
    <YStack gap="$3">
      <XStack gap="$2" items="center" flexWrap="wrap">
        <SearchInput value={q} onChange={setQ} placeholder="Search endpoints…" />
        <XStack
          borderWidth={1}
          borderColor="$borderColor"
          rounded="$4"
          overflow="hidden"
        >
          <Button size="$2" chromeless={view !== 'list'} bg={view === 'list' ? '$color5' : 'transparent'} rounded="$0" icon={<ListIcon size={15} />} onPress={() => setView('list')} />
          <Button size="$2" chromeless={view !== 'grid'} bg={view === 'grid' ? '$color5' : 'transparent'} rounded="$0" icon={<LayoutGrid size={15} />} onPress={() => setView('grid')} />
        </XStack>
      </XStack>
      <XStack gap="$3" items="center" flexWrap="wrap" justify="space-between">
        <XStack gap="$3" items="center" flexWrap="wrap">
          <Segmented options={STATUS_OPTS} value={status} onChange={setStatus} />
          {typeOpts.length > 1 ? <Segmented options={typeOpts} value={type} onChange={setType} /> : null}
        </XStack>
        <Segmented options={SORT_OPTS} value={sort} onChange={setSort} />
      </XStack>
    </YStack>
  )

  const columns: Column<RowVM>[] = [
    {
      key: 'endpoint',
      header: 'Endpoint',
      render: ({ e }) => (
        <XStack items="center" gap="$2.5">
          <StatusDot color={PHASE_DOT[e.phase]} />
          <YStack flex={1} gap="$0.5">
            <XStack items="center" gap="$2" flexWrap="wrap">
              <Text fontSize="$3" fontWeight="700" color="$color12" numberOfLines={1}>
                {e.name}
              </Text>
              <StatusTag status={e.phaseLabel} />
              {e.kind === 'deployed' ? (
                <Text fontSize="$1" px="$1.5" py="$0.5" rounded="$2" bg="$color4" color="$color11" fontWeight="700">
                  Custom
                </Text>
              ) : null}
            </XStack>
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              {[e.provider, e.type].filter(Boolean).join(' · ')}
            </Text>
          </YStack>
        </XStack>
      ),
    },
    { key: 'requests', header: 'Requests (24h)', width: 116, render: ({ req24h }) => <CellStat value={fmtCount(req24h)} /> },
    { key: 'trend', header: 'Trend (7d)', width: 120, render: ({ spark }) => <MiniSparkline series={spark} /> },
    { key: 'p95', header: 'P95 Latency', width: 104, render: () => <CellStat value="—" /> },
    { key: 'uptime', header: 'Uptime (7d)', width: 96, render: () => <CellStat value="—" /> },
    { key: 'menu', header: '', width: 40, render: () => <MoreVertical size={16} color="$color10" /> },
  ]

  return (
    <Card borderWidth={1} borderColor="$borderColor" bg="$color2" rounded="$5" p="$4" gap="$4">
      <XStack justify="space-between" items="center" gap="$3" flexWrap="wrap">
        <Text fontSize="$5" fontWeight="800" color="$color12">
          Endpoints
        </Text>
        {!loading && !error && endpoints.length > 0 ? (
          <Text fontSize="$2" color="$color10">
            {endpoints.length} total
          </Text>
        ) : null}
      </XStack>

      {error ? (
        <BackendStateCard state={error} onRetry={reload} hint="source · GET /v1/models · GET /v1/ml/models" />
      ) : !loading && endpoints.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="No endpoints yet"
          description="Deploy your first model-serving endpoint on managed Hanzo Cloud — no cluster to operate. Serve a model as a scalable, autoscaling API, or deploy through Functions and Agents."
          bullets={[
            'Serve a checkpoint (gs://, s3://, or hf://) as a KServe endpoint',
            'Or call any managed model — no deploy needed',
            'Live status, request volume, and trends appear here',
          ]}
          primary={{ label: 'Deploy your first endpoint', onPress: () => openDeployPane(pane, { onDeployed: reload, nav }) }}
          secondary={{ label: 'Browse models', onPress: () => router.push('/models') }}
        />
      ) : (
        <>
          {toolbar}
          {view === 'list' ? (
            <DataTable columns={columns} rows={rows} loading={loading} rowKey={(r) => r.e.id} onRowPress={(r) => openRow(r.e)} empty="No endpoints match your filters." />
          ) : (
            <GridView rows={rows} loading={loading} onOpen={(e) => openRow(e)} />
          )}
          {!loading && pageInfo.total > 0 ? (
            <XStack justify="space-between" items="center" gap="$3" flexWrap="wrap">
              <Text fontSize="$2" color="$color10">
                Showing {pageInfo.from}–{pageInfo.to} of {pageInfo.total}
              </Text>
              <XStack gap="$2" items="center">
                <Button size="$2" disabled={pageInfo.page <= 1} onPress={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Text fontSize="$2" color="$color11">
                  {pageInfo.page} / {pageInfo.pages}
                </Text>
                <Button size="$2" disabled={pageInfo.page >= pageInfo.pages} onPress={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </XStack>
            </XStack>
          ) : null}
        </>
      )}
    </Card>
  )
}

/** The grid (card) view — the same real rows as the list, as pressable cards. */
function GridView({ rows, loading, onOpen }: { rows: RowVM[]; loading: boolean; onOpen: (e: Endpoint) => void }) {
  if (loading) return null
  if (rows.length === 0) {
    return (
      <YStack p="$6" items="center" borderWidth={1} borderColor="$borderColor" rounded="$4">
        <Text color="$color11">No endpoints match your filters.</Text>
      </YStack>
    )
  }
  return (
    <XStack gap="$3" flexWrap="wrap">
      {rows.map(({ e, req24h, spark }) => (
        <Card
          key={e.id}
          flex={1}
          minW={240}
          borderWidth={1}
          borderColor="$borderColor"
          bg="$color1"
          rounded="$4"
          p="$3.5"
          gap="$3"
          hoverStyle={{ borderColor: '$color7' }}
          cursor="pointer"
          onPress={() => onOpen(e)}
        >
          <XStack items="center" gap="$2.5">
            <StatusDot color={PHASE_DOT[e.phase]} />
            <YStack flex={1} gap="$0.5">
              <Text fontSize="$3" fontWeight="700" color="$color12" numberOfLines={1}>
                {e.name}
              </Text>
              <Text fontSize="$1" color="$color10" numberOfLines={1}>
                {[e.provider, e.type].filter(Boolean).join(' · ')}
              </Text>
            </YStack>
            <StatusTag status={e.phaseLabel} />
          </XStack>
          <XStack items="flex-end" justify="space-between" gap="$2">
            <YStack gap="$0.5">
              <Text fontSize="$1" color="$color10">Requests (24h)</Text>
              <Text fontSize="$5" fontWeight="800" color="$color12">{fmtCount(req24h)}</Text>
            </YStack>
            <MiniSparkline series={spark} />
          </XStack>
        </Card>
      ))}
    </XStack>
  )
}
