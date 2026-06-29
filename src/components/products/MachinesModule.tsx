'use client'

/**
 * Machines — Linux VMs (the Docker-Desktop replacement) run by the platform.
 *
 * Reads the machine inventory from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/machines`), which injects the service token server-side. When the
 * machines service isn't provisioned for the org the list load fails and the
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

type Machine = {
  id: string
  name?: string
  status?: string
  os?: string
  cpu?: string
  memory?: string
  ip?: string
}

export function MachinesModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Machine[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ machines?: Machine[] }>(paas('machines'))
      setRows(r.machines ?? [])
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

  const columns: Column<Machine>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (m) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {m.name || m.id}
        </Text>
      ),
    },
    {
      key: 'os',
      header: 'OS',
      width: 120,
      render: (m) => (
        <Text fontSize="$3" color="$color11">
          {m.os || '—'}
        </Text>
      ),
    },
    {
      key: 'cpu',
      header: 'CPU',
      width: 90,
      render: (m) => (
        <Text fontSize="$3" color="$color11">
          {m.cpu || '—'}
        </Text>
      ),
    },
    {
      key: 'memory',
      header: 'Memory',
      width: 100,
      render: (m) => (
        <Text fontSize="$3" color="$color11">
          {m.memory || '—'}
        </Text>
      ),
    },
    {
      key: 'ip',
      header: 'IP',
      width: 150,
      render: (m) => (
        <Text fontSize="$3" color="$color11">
          {m.ip || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (m) => <StatusTag status={m.status ?? 'unknown'} />,
    },
  ]

  return (
    <>
      <PageHeader
        title="Machines"
        subtitle="Linux VMs — the Docker-Desktop replacement."
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
          rowKey={(m) => m.id}
          empty="No machines yet."
        />
      )}
    </>
  )
}
