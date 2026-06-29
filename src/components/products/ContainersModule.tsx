'use client'

/**
 * Containers — running container workloads scheduled by the platform.
 *
 * Reads the container inventory from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/containers`), which injects the service token server-side. When the
 * container service isn't provisioned for the org the list load fails and the
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

type Container = {
  id: string
  name?: string
  image?: string
  status?: string
  cpu?: string
  memory?: string
  node?: string
}

export function ContainersModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Container[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ containers?: Container[] }>(paas('containers'))
      setRows(r.containers ?? [])
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

  const columns: Column<Container>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (c) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {c.name || c.id}
        </Text>
      ),
    },
    {
      key: 'image',
      header: 'Image',
      width: 220,
      render: (c) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {c.image || '—'}
        </Text>
      ),
    },
    {
      key: 'node',
      header: 'Node',
      width: 140,
      render: (c) => (
        <Text fontSize="$3" color="$color11">
          {c.node || '—'}
        </Text>
      ),
    },
    {
      key: 'cpu',
      header: 'CPU',
      width: 90,
      render: (c) => (
        <Text fontSize="$3" color="$color11">
          {c.cpu || '—'}
        </Text>
      ),
    },
    {
      key: 'memory',
      header: 'Memory',
      width: 100,
      render: (c) => (
        <Text fontSize="$3" color="$color11">
          {c.memory || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (c) => <StatusTag status={c.status ?? 'unknown'} />,
    },
  ]

  return (
    <>
      <PageHeader
        title="Containers"
        subtitle="Running container workloads."
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
          rowKey={(c) => c.id}
          empty="No containers running yet."
        />
      )}
    </>
  )
}
