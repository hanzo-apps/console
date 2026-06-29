'use client'

/**
 * Alerts — alert rules (conditions, severities, recent firings) evaluated by the
 * platform.
 *
 * Reads the alert rules from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/alerts`), which injects the service token server-side. When the
 * alerting service isn't provisioned for the org the list load fails and the
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

type Alert = {
  id: string
  name?: string
  severity?: string
  status?: string
  condition?: string
  lastFired?: string
}

export function AlertsModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ alerts?: Alert[] }>(paas('alerts'))
      setRows(r.alerts ?? [])
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

  const columns: Column<Alert>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (a) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {a.name || a.id}
        </Text>
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      width: 110,
      render: (a) => (
        <Text fontSize="$3" color="$color11">
          {a.severity || '—'}
        </Text>
      ),
    },
    {
      key: 'condition',
      header: 'Condition',
      width: 220,
      render: (a) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {a.condition || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (a) => <StatusTag status={a.status ?? 'unknown'} />,
    },
    {
      key: 'lastFired',
      header: 'Last fired',
      width: 190,
      render: (a) => (
        <Text fontSize="$3" color="$color11">
          {a.lastFired ? new Date(a.lastFired).toLocaleString() : '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Alert rules — conditions, severities, recent firings."
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
          rowKey={(a) => a.id}
          empty="No alert rules yet."
        />
      )}
    </>
  )
}
