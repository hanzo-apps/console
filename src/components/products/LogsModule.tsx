'use client'

/**
 * Logs — structured application and platform log lines (time, level, service,
 * message) collected by the platform.
 *
 * Reads the log stream from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/logs`), which injects the service token server-side. When the log
 * service isn't provisioned for the org the list load fails and the honest
 * not-configured / unavailable card renders instead of an empty grid — matching
 * every other infra module.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { restGet } from '~/lib/api/client'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

const paas = (path: string) => `/paas/${path.replace(/^\/+/, '')}`

type LogEntry = {
  id: string
  timestamp?: string
  level?: string
  service?: string
  message?: string
}

export function LogsModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ logs?: LogEntry[] }>(paas('logs'))
      setRows(r.logs ?? [])
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

  const columns: Column<LogEntry>[] = [
    {
      key: 'timestamp',
      header: 'Time',
      width: 190,
      render: (l) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {l.timestamp ? new Date(l.timestamp).toLocaleString() : '—'}
        </Text>
      ),
    },
    {
      key: 'level',
      header: 'Level',
      width: 90,
      render: (l) => (
        <Text fontSize="$3" color="$color11">
          {l.level || '—'}
        </Text>
      ),
    },
    {
      key: 'service',
      header: 'Service',
      width: 150,
      render: (l) => (
        <Text fontSize="$3" color="$color11">
          {l.service || '—'}
        </Text>
      ),
    },
    {
      key: 'message',
      header: 'Message',
      render: (l) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {l.message || '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Logs"
        subtitle="Structured application and platform logs."
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
          rowKey={(r) => r.id}
          empty="No logs to show."
        />
      )}
    </>
  )
}
