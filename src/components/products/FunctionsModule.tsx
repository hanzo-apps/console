'use client'

/**
 * Functions — serverless compute (FaaS) deployed and invoked by the platform.
 *
 * Reads the function inventory from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/functions`), which injects the service token server-side. When the
 * functions service isn't provisioned for the org the list load fails and the
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

type Func = {
  id: string
  name?: string
  runtime?: string
  status?: string
  invocations?: string
  lastInvoked?: string
}

export function FunctionsModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Func[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ functions?: Func[] }>(paas('functions'))
      setRows(r.functions ?? [])
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

  const columns: Column<Func>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (f) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {f.name || f.id}
        </Text>
      ),
    },
    {
      key: 'runtime',
      header: 'Runtime',
      width: 140,
      render: (f) => (
        <Text fontSize="$3" color="$color11">
          {f.runtime || '—'}
        </Text>
      ),
    },
    {
      key: 'invocations',
      header: 'Invocations',
      width: 120,
      render: (f) => (
        <Text fontSize="$3" color="$color11">
          {f.invocations || '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (f) => <StatusTag status={f.status ?? 'unknown'} />,
    },
    {
      key: 'lastInvoked',
      header: 'Last invoked',
      width: 190,
      render: (f) => (
        <Text fontSize="$3" color="$color11">
          {f.lastInvoked ? new Date(f.lastInvoked).toLocaleString() : '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Functions"
        subtitle="Serverless compute (FaaS)."
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
          rowKey={(f) => f.id}
          empty="No functions deployed yet."
        />
      )}
    </>
  )
}
