'use client'

/**
 * Authorization — fine-grained access-control policies (allow/deny effects over
 * resources and principals) evaluated by the platform's policy engine.
 *
 * Reads the policy set from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/authz/policies`), which injects the service token server-side. When
 * the authorization service isn't provisioned for the org the list load fails and
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

type Policy = {
  id: string
  name?: string
  effect?: string
  resource?: string
  principals?: string[]
  updatedAt?: string
}

export function AuthzModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ policies?: Policy[] }>(paas('authz/policies'))
      setRows(r.policies ?? [])
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

  const columns: Column<Policy>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (p) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {p.name || p.id}
        </Text>
      ),
    },
    {
      key: 'effect',
      header: 'Effect',
      width: 110,
      render: (p) => (
        <Text fontSize="$3" color="$color11">
          {p.effect || '—'}
        </Text>
      ),
    },
    {
      key: 'resource',
      header: 'Resource',
      width: 200,
      render: (p) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {p.resource || '—'}
        </Text>
      ),
    },
    {
      key: 'principals',
      header: 'Principals',
      width: 110,
      render: (p) => (
        <Text fontSize="$3" color="$color11">
          {p.principals?.length ?? 0}
        </Text>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      width: 190,
      render: (p) => (
        <Text fontSize="$3" color="$color11">
          {p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Authorization"
        subtitle="Fine-grained access-control policies."
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
          rowKey={(p) => p.id}
          empty="No authorization policies yet."
        />
      )}
    </>
  )
}
