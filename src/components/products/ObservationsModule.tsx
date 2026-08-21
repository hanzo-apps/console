'use client'

/**
 * Observations — the spans/generations/events inside traces. The flat,
 * cross-trace view of every observation (the leaves a trace is built from),
 * paged from the cloud o11y backend (`GET /v1/o11y/llm/observations`). Honest
 * runtime-not-initialized state when o11y isn't provisioned for the deployment.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { O11yApi, type Observation, type O11yPageMeta } from '~/lib/api'
import { RuntimeNotice } from './observability/RuntimeNotice'
import { Pager } from './observability/Pager'
import { fmtDate } from './observability/format'
import { DataTable, PageHeader, StatusTag, type Column } from '@hanzo/ui/product'

const PAGE_LIMIT = 50

export function ObservationsModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Observation[]>([])
  const [meta, setMeta] = useState<O11yPageMeta | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const res = await O11yApi.observations({ page: p, limit: PAGE_LIMIT })
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

  const columns: Column<Observation>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (o) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {o.name || o.id}
        </Text>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: 130,
      render: (o) => (
        <Text fontSize="$3" color="$color11">
          {o.type || '—'}
        </Text>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      width: 170,
      render: (o) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {o.model || '—'}
        </Text>
      ),
    },
    {
      key: 'usage',
      header: 'Tokens',
      width: 110,
      render: (o) => (
        <Text fontSize="$3" color="$color11">
          {o.usage?.total ?? '—'}
        </Text>
      ),
    },
    {
      key: 'level',
      header: 'Level',
      width: 110,
      render: (o) => <StatusTag status={o.level ?? 'default'} />,
    },
    {
      key: 'startTime',
      header: 'Start',
      width: 190,
      render: (o) => (
        <Text fontSize="$3" color="$color11">
          {fmtDate(o.startTime)}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Observations"
        subtitle="Spans, generations, and events — the observations inside your traces."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load(page)}>
            Refresh
          </Button>
        }
      />

      {error ? (
        <RuntimeNotice surface="observations" error={error} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(o) => o.id}
            empty="No observations yet. Instrument your app to emit traces and their observations appear here."
          />
          <Pager meta={meta} onPage={setPage} />
        </>
      )}
    </>
  )
}
