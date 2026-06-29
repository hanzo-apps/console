'use client'

/**
 * GPUs — accelerator inventory and utilization tracked by the platform.
 *
 * Reads the GPU inventory from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/gpus`), which injects the service token server-side. When the
 * GPU service isn't provisioned for the org the list load fails and the
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

type Gpu = {
  id: string
  name?: string
  model?: string
  status?: string
  utilization?: string
  memory?: string
  node?: string
}

export function GpusModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Gpu[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ gpus?: Gpu[] }>(paas('gpus'))
      setRows(r.gpus ?? [])
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

  const columns: Column<Gpu>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (g) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {g.name || g.id}
        </Text>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      width: 160,
      render: (g) => (
        <Text fontSize="$3" color="$color11">
          {g.model || '—'}
        </Text>
      ),
    },
    {
      key: 'node',
      header: 'Node',
      width: 140,
      render: (g) => (
        <Text fontSize="$3" color="$color11">
          {g.node || '—'}
        </Text>
      ),
    },
    {
      key: 'utilization',
      header: 'Utilization',
      width: 120,
      render: (g) => (
        <Text fontSize="$3" color="$color11">
          {g.utilization || '—'}
        </Text>
      ),
    },
    {
      key: 'memory',
      header: 'Memory',
      width: 110,
      render: (g) => (
        <Text fontSize="$3" color="$color11">
          {g.memory || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (g) => <StatusTag status={g.status ?? 'unknown'} />,
    },
  ]

  return (
    <>
      <PageHeader
        title="GPUs"
        subtitle="Accelerator inventory and utilization."
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
          rowKey={(g) => g.id}
          empty="No GPUs yet."
        />
      )}
    </>
  )
}
