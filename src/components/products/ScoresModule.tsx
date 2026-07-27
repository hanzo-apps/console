'use client'

/**
 * Scores — list for evaluation scores (HIP-0106), native on @hanzo/gui.
 *
 * List at `/scores`. Reads the REAL `/v1/o11y/scores` surface; when the runtime
 * is not initialized (503) or unrouted (404) it shows an honest RuntimeNotice —
 * never fabricated scores or charts. A score links to its trace.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Text, XStack } from '@hanzo/gui'
import { ChevronRight, RefreshCw } from '@hanzogui/lucide-icons-2'

import { O11yApi, type O11yPageMeta, type Score } from '~/lib/api'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { RuntimeNotice } from './observability/RuntimeNotice'
import { Pager } from './observability/Pager'
import { Badge } from './observability/parts'
import { fmtDate, scoreValue } from './observability/format'

const PAGE_LIMIT = 50

export function ScoresModule(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const [rows, setRows] = useState<Score[]>([])
  const [meta, setMeta] = useState<O11yPageMeta | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const res = await O11yApi.scores({ page: p, limit: PAGE_LIMIT })
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

  const columns: Column<Score>[] = [
    { key: 'name', header: 'Name', render: (s) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{s.name}</Text> },
    { key: 'value', header: 'Value', width: 160, render: (s) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{scoreValue(s)}</Text> },
    { key: 'dataType', header: 'Type', width: 120, render: (s) => <Badge label={s.dataType} /> },
    { key: 'source', header: 'Source', width: 120, render: (s) => <Badge label={s.source} /> },
    { key: 'timestamp', header: 'Timestamp', width: 190, render: (s) => <Text fontSize="$3" color="$color11">{fmtDate(s.timestamp)}</Text> },
    {
      key: 'action',
      header: '',
      width: 120,
      render: (s) =>
        s.traceId ? (
          <XStack justify="flex-end" flex={1}>
            <Button
              size="$2"
              iconAfter={<ChevronRight size={14} />}
              onPress={() => router.push(`/o11y/${encodeURIComponent(s.traceId as string)}`)}
            >
              Trace
            </Button>
          </XStack>
        ) : null,
    },
  ]

  return (
    <>
      <PageHeader
        title="Scores"
        subtitle="Evaluation scores from feedback, model graders, and manual review."
        actions={
          <XStack gap="$2">
            <Button size="$2" onPress={() => router.push('/scores/analytics')}>
              Analytics
            </Button>
            <Button icon={<RefreshCw size={16} />} onPress={() => void load(page)}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {error ? (
        <RuntimeNotice surface="scores" error={error} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(s) => s.id}
            empty="No scores yet. Scores appear here once evaluations or feedback are recorded."
          />
          <Pager meta={meta} onPage={setPage} />
        </>
      )}
    </>
  )
}
