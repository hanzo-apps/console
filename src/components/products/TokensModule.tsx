'use client'

/**
 * Tokens — issued tokens with supply, holder counts, and contract addresses
 * across chains, tracked by the platform.
 *
 * Reads the token registry from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/tokens`), which injects the service token server-side. When the
 * token service isn't provisioned for the org the list load fails and the
 * honest not-configured / unavailable card renders instead of an empty grid —
 * matching every other infra module.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { restGet } from '~/lib/api/client'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

const paas = (path: string) => `/paas/${path.replace(/^\/+/, '')}`

type Token = {
  id: string
  symbol?: string
  name?: string
  supply?: string
  holders?: string
  contract?: string
  chain?: string
}

export function TokensModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Token[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ tokens?: Token[] }>(paas('tokens'))
      setRows(r.tokens ?? [])
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

  const columns: Column<Token>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      render: (t) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {t.symbol || t.id}
        </Text>
      ),
    },
    {
      key: 'name',
      header: 'Name',
      width: 180,
      render: (t) => (
        <Text fontSize="$3" color="$color11">
          {t.name || '—'}
        </Text>
      ),
    },
    {
      key: 'supply',
      header: 'Supply',
      width: 140,
      render: (t) => (
        <Text fontSize="$3" color="$color11">
          {t.supply || '—'}
        </Text>
      ),
    },
    {
      key: 'holders',
      header: 'Holders',
      width: 110,
      render: (t) => (
        <Text fontSize="$3" color="$color11">
          {t.holders || '—'}
        </Text>
      ),
    },
    {
      key: 'chain',
      header: 'Chain',
      width: 120,
      render: (t) => (
        <Text fontSize="$3" color="$color11">
          {t.chain || '—'}
        </Text>
      ),
    },
    {
      key: 'contract',
      header: 'Contract',
      width: 220,
      render: (t) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {t.contract || '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Tokens"
        subtitle="Issued tokens — supply, holders, and contract addresses."
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
          rowKey={(t) => t.id}
          empty="No tokens issued yet."
        />
      )}
    </>
  )
}
