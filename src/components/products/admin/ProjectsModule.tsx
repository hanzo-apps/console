'use client'

/**
 * admin.hanzo.ai PROJECTS board — the cross-org "what is deployed" view for staff:
 * every org's apps/projects across all clusters, with health, cluster, and live URL.
 * READ-ONLY. GLOBAL-ADMIN ONLY (`admin: true` hides it from every customer). It is a
 * lens over the EXISTING global platform apps inventory (`PlatformApi.apps()` via
 * `AdminProjectsApi`) — no new backend surface, nothing fabricated. Drill by org with
 * the filter. Honest loading/empty/403 states.
 */
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Boxes, ExternalLink, Network, RefreshCw, Building2 } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { AdminProjectsApi, groupByOrg, type ProjectRow } from '~/lib/api/admin-projects'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard } from '~/components/ui/Metric'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { ErrorState, asApiError, isForbidden, SuperAdminRequired } from '~/components/ui/States'

const shortDate = (s: string): string => (s ? (s.split('T')[0] ?? s) : '—')

const INPUT_BASE: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--borderColor)',
  borderRadius: 8,
  padding: '8px 10px',
  color: 'var(--color12)',
}

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

export function ProjectsModule() {
  const [rows, setRows] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<ApiError | null>(null)
  const [orgFilter, setOrgFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      setRows(await AdminProjectsApi.list())
    } catch (e) {
      setErr(asApiError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = orgFilter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.org.toLowerCase().includes(q) || r.app.toLowerCase().includes(q))
  }, [rows, orgFilter])

  const orgCount = useMemo(() => groupByOrg(rows).length, [rows])

  if (err && isForbidden(err)) return <SuperAdminRequired />
  if (err) return <YStack p="$4" gap="$4"><PageHeader title="Projects" /><ErrorState err={err} onRetry={load} /></YStack>

  const columns: Column<ProjectRow>[] = [
    { key: 'org', header: 'Org', render: (r) => <Text fontSize="$3" color="$color12">{r.org || '—'}</Text> },
    { key: 'app', header: 'Project / app', render: (r) => (
      <YStack><Text fontSize="$2" color="$color12">{r.app || '—'}</Text>{r.env ? <Text fontSize="$1" color="$color10">{r.env}</Text> : null}</YStack>
    ) },
    { key: 'status', header: 'Status', width: 120, render: (r) => <HealthBadge status={r.status} /> },
    { key: 'cluster', header: 'Cluster', render: (r) => <Text fontSize="$2" color="$color11">{r.cluster || '—'}</Text> },
    { key: 'drift', header: 'Drift', width: 90, render: (r) => <Text fontSize="$1" color={r.drift ? '$yellow11' : '$color9'}>{r.drift || '—'}</Text> },
    { key: 'url', header: 'Live URL', render: (r) => (
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
      ) : <Text fontSize="$1" color="$color9">—</Text>
    ) },
    { key: 'updatedAt', header: 'Updated', width: 110, render: (r) => <Text fontSize="$1" color="$color10">{shortDate(r.updatedAt)}</Text> },
  ]

  return (
    <YStack p="$4" gap="$4">
      <PageHeader
        title="Projects"
        subtitle="Every org’s deployed apps across all clusters — health, cluster, and live URL. Read-only. Global-admin only."
        actions={<Button size="$3" icon={<RefreshCw size={15} />} onPress={load}>Refresh</Button>}
      />
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Boxes size={16} />} label="Projects" value={String(rows.length)} caption="deployed apps" />
        <MetricCard icon={<Building2 size={16} />} label="Orgs" value={String(orgCount)} caption="with deployments" />
        <MetricCard icon={<Network size={16} />} label="Clusters" value={String(new Set(rows.map((r) => r.cluster).filter(Boolean)).size)} caption="in the fleet" />
      </XStack>

      <XStack gap="$2" items="center">
        <input value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)} placeholder="Filter by org or app…" style={{ ...INPUT_BASE, width: 260 }} />
        {orgFilter ? <Button size="$2" chromeless onPress={() => setOrgFilter('')}>Clear</Button> : null}
      </XStack>

      <DataTable<ProjectRow>
        columns={columns}
        rows={filtered}
        loading={loading}
        empty={orgFilter ? 'No projects match that filter.' : 'No deployed projects yet.'}
        rowKey={(r) => `${r.org}/${r.app}/${r.cluster}/${r.namespace}`}
      />
    </YStack>
  )
}
