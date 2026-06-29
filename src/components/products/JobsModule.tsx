'use client'

/**
 * Jobs — scheduled and one-off batch workloads run by the platform.
 *
 * Reads the job inventory from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/jobs`), which injects the service token server-side. When the
 * jobs service isn't provisioned for the org the list load fails and the
 * honest not-configured / unavailable card renders instead of an empty grid —
 * matching every other infra module.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { restGet } from '~/lib/api/client'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

const paas = (path: string) => `/paas/${path.replace(/^\/+/, '')}`

type Job = {
  id: string
  name?: string
  type?: string
  status?: string
  schedule?: string
  lastRun?: string
}

export function JobsModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ jobs?: Job[] }>(paas('jobs'))
      setRows(r.jobs ?? [])
      setLoadError(null)
    } catch (e) {
      setLoadError(interpretPlatformError(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const columns: Column<Job>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (j) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {j.name || j.id}
        </Text>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: 120,
      render: (j) => (
        <Text fontSize="$3" color="$color11">
          {j.type || '—'}
        </Text>
      ),
    },
    {
      key: 'schedule',
      header: 'Schedule',
      width: 140,
      render: (j) => (
        <Text fontSize="$3" color="$color11">
          {j.schedule || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (j) => <StatusTag status={j.status ?? 'unknown'} />,
    },
    {
      key: 'lastRun',
      header: 'Last run',
      width: 190,
      render: (j) => (
        <Text fontSize="$3" color="$color11">
          {j.lastRun ? new Date(j.lastRun).toLocaleString() : '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle="Scheduled and one-off batch workloads."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
        }
      />

      {loadError ? (
        <PlatformStateCard error={loadError} onRetry={() => void load()} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(j) => j.id}
          empty="No jobs yet."
        />
      )}
    </>
  )
}
