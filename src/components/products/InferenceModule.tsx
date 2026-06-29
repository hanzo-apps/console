'use client'

/**
 * Inference — deployed model-serving endpoints (replicas, request volume, rollout
 * status) served by the platform.
 *
 * Reads the endpoint inventory from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/inference/endpoints`), which injects the service token server-side.
 * When the inference service isn't provisioned for the org the list load fails and
 * the honest not-configured / unavailable card renders instead of an empty grid —
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

type InferenceEndpoint = {
  id: string
  name?: string
  model?: string
  status?: string
  replicas?: number
  requests?: number
}

export function InferenceModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<InferenceEndpoint[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ endpoints?: InferenceEndpoint[] }>(paas('inference/endpoints'))
      setRows(r.endpoints ?? [])
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

  const columns: Column<InferenceEndpoint>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (e) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {e.name || e.id}
        </Text>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      width: 180,
      render: (e) => (
        <Text fontSize="$3" color="$color11">
          {e.model || '—'}
        </Text>
      ),
    },
    {
      key: 'replicas',
      header: 'Replicas',
      width: 100,
      render: (e) => (
        <Text fontSize="$3" color="$color11">
          {e.replicas ?? '—'}
        </Text>
      ),
    },
    {
      key: 'requests',
      header: 'Requests',
      width: 120,
      render: (e) => (
        <Text fontSize="$3" color="$color11">
          {e.requests ?? '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (e) => <StatusTag status={e.status ?? 'unknown'} />,
    },
  ]

  return (
    <>
      <PageHeader
        title="Inference"
        subtitle="Deployed model-serving endpoints."
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
          rowKey={(e) => e.id}
          empty="No inference endpoints yet."
        />
      )}
    </>
  )
}
