'use client'

/**
 * Forward-compatible shells for console features that already exist in the old
 * console but are landing on the unified `/v1` backend incrementally.
 *
 * Each surface below points at a real or planned backend endpoint and renders
 * real rows when the endpoint exists. A 404/405/503 becomes the shared honest
 * state card; no demo rows are generated. This lets console2 carry the old
 * console's information architecture now, while the backend routes can light up
 * independently.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Text, XStack } from '@hanzo/gui'
import { ExternalLink, RefreshCw } from '@hanzogui/lucide-icons-2'

import { restGet, v1Url } from '~/lib/api/client'
import { BackendStateCard, DataTable, PageHeader, classifyBackend, type BackendState, type Column } from '@hanzo/ui/product'

type SurfaceRow = Record<string, unknown> & { __rowId: string }

type SurfaceColumn = {
  key: string
  header: string
  width?: number
}

export type Surface = {
  id: string
  label: string
  endpoint: string
  empty: string
  hint?: string
  columns: SurfaceColumn[]
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; rows: SurfaceRow[] }

const rowKeys = [
  'data',
  'items',
  'rows',
  'results',
  'runs',
  'experiments',
  'dashboards',
  'widgets',
  'integrations',
  'history',
  'referrals',
  'services',
  'routers',
  'terminators',
  'identities',
  'sessions',
  'configs',
  'policies',
  'wallets',
]

const valueOf = (row: SurfaceRow, key: string): unknown => {
  const parts = key.split('.')
  let current: unknown = row
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

const formatValue = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '-'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '-'
  if (typeof value === 'string') {
    const dateish = /^\d{4}-\d{2}-\d{2}T/.test(value)
    if (dateish) {
      const d = new Date(value)
      return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
    }
    return value
  }
  if (Array.isArray(value)) return value.length ? value.map(formatValue).join(', ') : '-'
  return JSON.stringify(value)
}

const asRecords = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) {
    return value.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x))
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) return [value as Record<string, unknown>]
  return []
}

const extractRows = (payload: unknown): SurfaceRow[] => {
  if (Array.isArray(payload)) return withIds(asRecords(payload))
  if (!payload || typeof payload !== 'object') return []

  const obj = payload as Record<string, unknown>
  for (const key of rowKeys) {
    const records = asRecords(obj[key])
    if (records.length > 0) return withIds(records)
  }

  const nestedData = obj.data
  if (nestedData && typeof nestedData === 'object' && !Array.isArray(nestedData)) {
    const nested = nestedData as Record<string, unknown>
    for (const key of rowKeys) {
      const records = asRecords(nested[key])
      if (records.length > 0) return withIds(records)
    }
  }

  return withIds([obj])
}

const stableKey = (row: Record<string, unknown>, index: number): string => {
  for (const key of ['id', 'name', 'key', 'slug', 'url']) {
    const value = row[key]
    if (typeof value === 'string' && value) return value
  }
  return `row-${index}`
}

const withIds = (rows: Record<string, unknown>[]): SurfaceRow[] =>
  rows.map((row, index) => ({ ...row, __rowId: stableKey(row, index) }))

export function ForwardSurface({ surface }: { surface: Surface }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    restGet<unknown>(v1Url(surface.endpoint))
      .then((payload) => setState({ phase: 'ready', rows: extractRows(payload) }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [surface.endpoint])

  useEffect(() => {
    load()
  }, [load])

  const columns: Column<SurfaceRow>[] = useMemo(
    () =>
      surface.columns.map((column) => ({
        key: column.key,
        header: column.header,
        width: column.width,
        render: (row) => (
          <Text fontSize="$3" color={valueOf(row, column.key) ? '$color11' : '$color10'} numberOfLines={1}>
            {formatValue(valueOf(row, column.key))}
          </Text>
        ),
      })),
    [surface.columns],
  )

  if (state.phase === 'error') {
    return <BackendStateCard state={state.error} onRetry={load} hint={surface.hint ?? `endpoint · GET /v1/${surface.endpoint}`} />
  }

  return (
    <DataTable
      columns={columns}
      rows={state.phase === 'ready' ? state.rows : []}
      loading={state.phase === 'loading'}
      rowKey={(row) => row.__rowId}
      empty={surface.empty}
    />
  )
}

function TabbedFeatureModule({
  title,
  subtitle,
  basePath,
  surfaces,
  active,
  externalHref,
}: {
  title: string
  subtitle: string
  basePath: string
  surfaces: Surface[]
  active?: string
  externalHref?: string
}) {
  const router = useRouter()
  const current = surfaces.find((surface) => surface.id === active) ?? surfaces[0]

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={() => router.refresh()}>
              Refresh
            </Button>
            {externalHref ? (
              <Button
                size="$2"
                icon={<ExternalLink size={15} />}
                onPress={() => {
                  if (typeof window !== 'undefined') window.open(externalHref, '_blank', 'noopener')
                }}
              >
                Open surface
              </Button>
            ) : null}
          </XStack>
        }
      />
      <XStack gap="$1" flexWrap="wrap">
        {surfaces.map((surface) => (
          <Button
            key={surface.id}
            size="$2"
            bg={surface.id === current.id ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor="$borderColor"
            onPress={() => router.push(surface.id === surfaces[0].id ? `/${basePath}` : `/${basePath}/${surface.id}`)}
          >
            {surface.label}
          </Button>
        ))}
      </XStack>
      <ForwardSurface surface={current} />
    </>
  )
}

const experimentsSurfaces: Surface[] = [
  {
    id: 'runs',
    label: 'Runs',
    endpoint: 'evals/dataset-runs',
    empty: 'No experiment runs returned.',
    columns: [
      { key: 'name', header: 'Run' },
      { key: 'datasetName', header: 'Dataset', width: 180 },
      { key: 'model', header: 'Model', width: 180 },
      { key: 'status', header: 'Status', width: 120 },
      { key: 'createdAt', header: 'Created', width: 190 },
    ],
  },
  {
    id: 'experiments',
    label: 'Experiments',
    endpoint: 'evals/experiments',
    empty: 'No experiments returned.',
    columns: [
      { key: 'name', header: 'Experiment' },
      { key: 'datasetName', header: 'Dataset', width: 180 },
      { key: 'runs', header: 'Runs', width: 90 },
      { key: 'updatedAt', header: 'Updated', width: 190 },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    endpoint: 'evals/experiments/analytics',
    empty: 'No experiment analytics returned.',
    columns: [
      { key: 'metric', header: 'Metric' },
      { key: 'value', header: 'Value', width: 160 },
      { key: 'window', header: 'Window', width: 140 },
    ],
  },
]

export function ExperimentsModule({ params }: { params: Record<string, string> }) {
  return (
    <TabbedFeatureModule
      title="Experiments"
      subtitle="Dataset runs, comparisons, and evaluation analytics."
      basePath="experiments"
      active={params.tab}
      surfaces={experimentsSurfaces}
      externalHref="https://cloud.hanzo.ai"
    />
  )
}

const dashboardsSurfaces: Surface[] = [
  {
    id: 'dashboards',
    label: 'Dashboards',
    endpoint: 'o11y/dashboards',
    empty: 'No dashboards returned.',
    columns: [
      { key: 'name', header: 'Dashboard' },
      { key: 'description', header: 'Description' },
      { key: 'widgets', header: 'Widgets', width: 110 },
      { key: 'updatedAt', header: 'Updated', width: 190 },
    ],
  },
  {
    id: 'widgets',
    label: 'Widgets',
    endpoint: 'o11y/widgets',
    empty: 'No dashboard widgets returned.',
    columns: [
      { key: 'name', header: 'Widget' },
      { key: 'type', header: 'Type', width: 140 },
      { key: 'dashboardName', header: 'Dashboard', width: 180 },
      { key: 'updatedAt', header: 'Updated', width: 190 },
    ],
  },
]

export function DashboardsModule({ params }: { params: Record<string, string> }) {
  return (
    <TabbedFeatureModule
      title="Dashboards"
      subtitle="Saved analytics dashboards and widgets from the observability surface."
      basePath="dashboards"
      active={params.tab}
      surfaces={dashboardsSurfaces}
      externalHref="https://analytics.hanzo.ai"
    />
  )
}

// NOTE: the old read-only Integrations DataTable (blob-storage / Slack / Mixpanel /
// Insights surfaces) is superseded by the customer-facing Connect grid in
// `OrgIntegrationsModule` — the registry's `integrations` entry routes there now, so
// there is exactly ONE integrations surface. Its `integrationSurfaces` + module were
// removed here to avoid a second, dead one.

const referralSurfaces: Surface[] = [
  {
    id: 'summary',
    label: 'Summary',
    endpoint: 'referrals/summary',
    empty: 'No referral summary returned.',
    columns: [
      { key: 'code', header: 'Code' },
      { key: 'clicks', header: 'Clicks', width: 110 },
      { key: 'signups', header: 'Signups', width: 110 },
      { key: 'credits', header: 'Credits', width: 120 },
    ],
  },
  {
    id: 'history',
    label: 'History',
    endpoint: 'referrals/history',
    empty: 'No referral history returned.',
    columns: [
      { key: 'event', header: 'Event' },
      { key: 'email', header: 'User', width: 220 },
      { key: 'amount', header: 'Amount', width: 120 },
      { key: 'createdAt', header: 'Created', width: 190 },
    ],
  },
  {
    id: 'earnings',
    label: 'Earnings',
    endpoint: 'referrals/earnings',
    empty: 'No referral earnings returned.',
    columns: [
      { key: 'period', header: 'Period' },
      { key: 'amount', header: 'Amount', width: 120 },
      { key: 'status', header: 'Status', width: 120 },
      { key: 'paidAt', header: 'Paid', width: 190 },
    ],
  },
]

export function ReferralsModule({ params }: { params: Record<string, string> }) {
  return (
    <TabbedFeatureModule
      title="Referrals"
      subtitle="Referral link, earnings, and invite history."
      basePath="referrals"
      active={params.tab}
      surfaces={referralSurfaces}
    />
  )
}

export const zeroTrustSurfaces: Surface[] = [
  {
    id: 'services',
    label: 'Services',
    endpoint: 'zt/services',
    empty: 'No zero-trust services returned.',
    columns: [
      { key: 'name', header: 'Service' },
      { key: 'host', header: 'Host' },
      { key: 'status', header: 'Status', width: 120 },
      { key: 'updatedAt', header: 'Updated', width: 190 },
    ],
  },
  {
    id: 'identities',
    label: 'Identities',
    endpoint: 'zt/identities',
    empty: 'No zero-trust identities returned.',
    columns: [
      { key: 'name', header: 'Identity' },
      { key: 'type', header: 'Type', width: 140 },
      { key: 'status', header: 'Status', width: 120 },
      { key: 'updatedAt', header: 'Updated', width: 190 },
    ],
  },
  {
    id: 'routers',
    label: 'Routers',
    endpoint: 'zt/routers',
    empty: 'No zero-trust routers returned.',
    columns: [
      { key: 'name', header: 'Router' },
      { key: 'endpoint', header: 'Endpoint' },
      { key: 'status', header: 'Status', width: 120 },
      { key: 'updatedAt', header: 'Updated', width: 190 },
    ],
  },
  {
    id: 'policies',
    label: 'Policies',
    endpoint: 'zt/service-policies',
    empty: 'No zero-trust policies returned.',
    columns: [
      { key: 'name', header: 'Policy' },
      { key: 'service', header: 'Service', width: 180 },
      { key: 'identity', header: 'Identity', width: 180 },
      { key: 'updatedAt', header: 'Updated', width: 190 },
    ],
  },
  {
    id: 'sessions',
    label: 'Sessions',
    endpoint: 'zt/sessions',
    empty: 'No zero-trust sessions returned.',
    columns: [
      { key: 'id', header: 'Session' },
      { key: 'service', header: 'Service', width: 180 },
      { key: 'identity', header: 'Identity', width: 180 },
      { key: 'createdAt', header: 'Created', width: 190 },
    ],
  },
]

// ZeroTrustModule moved to its own rich module (`ZeroTrustModule.tsx`) — an
// Overview landing (KPIs, post-quantum posture, mesh topology) on top of these
// same `zeroTrustSurfaces` tables, which it reuses via the exported
// `ForwardSurface`. One zero-trust surface, not two.

const scoreAnalyticsSurface: Surface = {
  id: 'analytics',
  label: 'Analytics',
  endpoint: 'o11y/scores/analytics',
  empty: 'No score analytics returned.',
  columns: [
    { key: 'name', header: 'Score' },
    { key: 'count', header: 'Count', width: 100 },
    { key: 'avg', header: 'Average', width: 120 },
    { key: 'p95', header: 'P95', width: 120 },
    { key: 'window', header: 'Window', width: 140 },
  ],
}

export function ScoreAnalyticsModule(_props: { params: Record<string, string> }) {
  return (
    <>
      <PageHeader title="Score Analytics" subtitle="Aggregates and trends for recorded scores." />
      <ForwardSurface surface={scoreAnalyticsSurface} />
    </>
  )
}
