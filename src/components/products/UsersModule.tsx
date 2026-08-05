'use client'

/**
 * Users — the per-user analytics rollup the o11y backend aggregates from traces
 * carrying a `userId` (trace count, cost, tokens, last seen). Paged from
 * `GET /v1/o11y/users`. Honest runtime-not-initialized state when o11y isn't
 * provisioned for the deployment.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { O11yApi, type O11yUser, type O11yPageMeta } from '~/lib/api'
import { RuntimeNotice } from './observability/RuntimeNotice'
import { Pager } from './observability/Pager'
import { fmtDate } from './observability/format'
import { DataTable, PageHeader, type Column } from '@hanzo/ui/product'

const PAGE_LIMIT = 50
const usd = (n?: number) => (typeof n === 'number' ? `$${n.toFixed(4)}` : '—')

export function UsersModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<O11yUser[]>([])
  const [meta, setMeta] = useState<O11yPageMeta | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const res = await O11yApi.users({ page: p, limit: PAGE_LIMIT })
      setRows(res.data ?? [])
      setMeta(res.meta ?? null)
      setError(null)
    } catch (e) {
      setError(e)
      setRows([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(page)
  }, [load, page])

  const columns: Column<O11yUser>[] = [
    {
      key: 'userId',
      header: 'User',
      render: (u) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {u.userId}
        </Text>
      ),
    },
    {
      key: 'traceCount',
      header: 'Traces',
      width: 110,
      render: (u) => (
        <Text fontSize="$3" color="$color11">
          {u.traceCount ?? '—'}
        </Text>
      ),
    },
    {
      key: 'totalTokens',
      header: 'Tokens',
      width: 120,
      render: (u) => (
        <Text fontSize="$3" color="$color11">
          {u.totalTokens ?? '—'}
        </Text>
      ),
    },
    {
      key: 'totalCost',
      header: 'Cost',
      width: 120,
      render: (u) => (
        <Text fontSize="$3" color="$color11">
          {usd(u.totalCost)}
        </Text>
      ),
    },
    {
      key: 'lastSeen',
      header: 'Last seen',
      width: 190,
      render: (u) => (
        <Text fontSize="$3" color="$color11">
          {u.lastSeen ? fmtDate(u.lastSeen) : '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Per-user analytics — trace volume, token usage, and cost by userId."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load(page)}>
            Refresh
          </Button>
        }
      />

      {error ? (
        <RuntimeNotice surface="users" error={error} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(u) => u.userId}
            empty="No users yet. Tag traces with a userId to see per-user analytics here."
          />
          <Pager meta={meta} onPage={setPage} />
        </>
      )}
    </>
  )
}
