'use client'

/**
 * Service Mesh — inter-service routing and mutual TLS across the org's workloads.
 *
 * A mesh row IS an edge service of the org's Zero Trust overlay, so it is read where
 * its parent lives: `GET /v1/network/services` (HIP-0139). Unlike the overlay read
 * this one does not degrade — an unconfigured deployment answers 503 and the honest
 * not-configured / unavailable card renders, so the page never shows "no services"
 * for a fabric it simply could not read.
 */
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { PlatformStateCard } from './platform/state'
import { useResourceList } from './useResourceList'
import { DataTable, PageHeader, StatusTag, type Column } from '@hanzo/ui/product'

type MeshService = {
  id: string
  service?: string
  mtls?: string
  status?: string
}

export function ServiceMeshModule(_props: { params: Record<string, string> }) {
  const { rows, loading, error: loadError, reload: load } =
    useResourceList<MeshService>('network/services', 'services')

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
        subtitle="Inter-service routing and mTLS."
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
          empty="No mesh services yet. Workloads appear here once they route through the mesh, each with its mTLS mode."
        />
      )}
    </>
  )
}
