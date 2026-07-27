'use client'

/**
 * Service Mesh — inter-service routing, mutual-TLS, and traffic policy for the
 * platform's workloads (the sidecar/mesh data plane).
 *
 * Reads the mesh service registry from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/mesh/services`), which injects the service token server-side. When the
 * mesh isn't provisioned for the org the list load fails and the honest
 * not-configured / unavailable card renders instead of an empty grid — matching
 * every other infra module.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { restGet, originV1Url } from '~/lib/api/client'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

type MeshService = {
  id: string
  service?: string
  namespace?: string
  mtls?: string
  requests?: number
  status?: string
}

export function ServiceMeshModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<MeshService[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ services?: MeshService[] }>(originV1Url('mesh/services'))
      setRows(r.services ?? [])
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

  const columns: Column<MeshService>[] = [
    {
      key: 'service',
      header: 'Service',
      render: (m) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {m.service || m.id}
        </Text>
      ),
    },
    {
      key: 'namespace',
      header: 'Namespace',
      width: 160,
      render: (m) => (
        <Text fontSize="$3" color="$color11">
          {m.namespace || '—'}
        </Text>
      ),
    },
    {
      key: 'mtls',
      header: 'mTLS',
      width: 90,
      render: (m) => (
        <Text fontSize="$3" color="$color11">
          {m.mtls || '—'}
        </Text>
      ),
    },
    {
      key: 'requests',
      header: 'Requests',
      width: 120,
      render: (m) => (
        <Text fontSize="$3" color="$color11">
          {m.requests ?? '—'}
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
        title="Service Mesh"
        subtitle="Inter-service routing, mTLS, and traffic."
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
          empty="No mesh services yet."
        />
      )}
    </>
  )
}
