'use client'

/**
 * admin.hanzo.ai PROJECTS board — the cross-org "what is deployed" view for staff:
 * every org's apps/projects across all clusters, with health, cluster, and live URL.
 * READ-ONLY. GLOBAL-ADMIN ONLY (`admin: true` hides it from every customer). It is a
 * lens over the EXISTING global platform apps inventory (`PlatformApi.apps()` via
 * `AdminProjectsApi`) — no new backend surface, nothing fabricated. Drill by org with
 * the filter. Honest loading/empty/403 states.
 */
import { useCallback, useMemo, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Boxes, ExternalLink, Network, RefreshCw, Building2 } from '@hanzogui/lucide-icons-2'

import { AdminProjectsApi, groupByOrg, type ProjectRow } from '~/lib/api/admin-projects'
import { DASH, shortDate } from '~/lib/format'
import { searchRows, useSort } from '~/lib/table'
import { useAdminResource } from '~/lib/hooks/useAdminResource'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard } from '~/components/ui/Metric'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { SearchInput } from '~/components/ui/Filters'
import { ErrorState, isForbidden, OperatorAccessRequired } from '~/components/ui/States'

function HealthBadge({ status }: { status: string }) {
  // Literal union (not a Record<string,string>) so the theme-token type is preserved.
  // Unknown/other degrades to a neutral gray — never fabricated.
  const color =
    status === 'green' ? '$green11' : status === 'yellow' ? '$yellow11' : status === 'red' ? '$red11' : '$color10'
  return (
    <XStack items="center" gap="$1.5">
      <YStack width={8} height={8} rounded="$10" bg={color} />
      <Text fontSize="$1" color="$color11">{status || 'unknown'}</Text>
    </XStack>
  )
}

const columns: Column<ProjectRow>[] = [
  { key: 'org', header: 'Org', sortable: true, render: (r) => r.org || DASH },
  { key: 'app', header: 'Project / app', sortable: true, render: (r) => (
    <YStack><Text fontSize="$2" color="$color12">{r.app || DASH}</Text>{r.env ? <Text fontSize="$1" color="$color10">{r.env}</Text> : null}</YStack>
  ) },
  { key: 'status', header: 'Status', width: 120, sortable: true, render: (r) => <HealthBadge status={r.status} /> },
  { key: 'cluster', header: 'Cluster', sortable: true, render: (r) => r.cluster || DASH },
  { key: 'drift', header: 'Drift', width: 90, sortable: true, render: (r) => <Text fontSize="$1" color={r.drift ? '$yellow11' : '$color9'}>{r.drift || DASH}</Text> },
  { key: 'url', header: 'Live URL', sortable: true, render: (r) => (
    r.url ? (
      <XStack
        items="center"
        gap="$1"
        cursor="pointer"
        hoverStyle={{ opacity: 0.8 }}
        onPress={() => { if (typeof window !== 'undefined') window.open(r.url, '_blank', 'noopener,noreferrer') }}
      >
        <Text fontSize="$1" color="$color12" numberOfLines={1}>{r.url.replace(/^https?:\/\//, '')}</Text>
        <ExternalLink size={12} color="$color12" />
      </XStack>
    ) : <Text fontSize="$1" color="$color9">{DASH}</Text>
  ) },
  { key: 'updatedAt', header: 'Updated', width: 110, align: 'right', mono: true, sortable: true, render: (r) => shortDate(r.updatedAt) },
]

export function ProjectsModule() {
  const [q, setQ] = useState('')
  const { data, loading, err, reload } = useAdminResource(useCallback(() => AdminProjectsApi.list(), []))
  const { sort, onSortChange, apply } = useSort('org')

  const all = useMemo(() => data ?? [], [data])
  const rows = useMemo(
    () => apply(searchRows(all, q, (r) => `${r.org} ${r.app} ${r.env} ${r.cluster} ${r.namespace} ${r.url}`)),
    [all, q, apply],
  )
  const orgCount = useMemo(() => groupByOrg(all).length, [all])

  if (err && isForbidden(err)) return <OperatorAccessRequired />
  if (err) return <YStack p="$4" gap="$4"><PageHeader title="Projects" /><ErrorState err={err} onRetry={reload} /></YStack>

  return (
    <YStack p="$4" gap="$4">
      <PageHeader
        title="Projects"
        subtitle="Every org’s deployed apps across all clusters — health, cluster, and live URL. Read-only. Global-admin only."
        actions={<Button size="$3" icon={<RefreshCw size={15} />} onPress={reload}>Refresh</Button>}
      />
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Boxes size={16} />} label="Projects" value={String(all.length)} caption="deployed apps" />
        <MetricCard icon={<Building2 size={16} />} label="Orgs" value={String(orgCount)} caption="with deployments" />
        <MetricCard icon={<Network size={16} />} label="Clusters" value={String(new Set(all.map((r) => r.cluster).filter(Boolean)).size)} caption="in the fleet" />
      </XStack>

      <SearchInput value={q} onChange={setQ} placeholder="Search orgs, apps, clusters, URLs…" />

      <DataTable<ProjectRow>
        columns={columns}
        rows={rows}
        loading={loading}
        empty={q ? 'No projects match that filter.' : 'No deployed projects yet.'}
        rowKey={(r) => `${r.org}/${r.app}/${r.cluster}/${r.namespace}`}
        sort={sort}
        onSortChange={onSortChange}
      />
    </YStack>
  )
}
