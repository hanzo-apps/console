'use client'

/**
 * Annotation Queues — list of review queues (HIP-0106), native on @hanzo/gui.
 *
 * An annotation queue is a named work queue of traces/observations to review and
 * score against a set of score configs. Reads the REAL `/v1/o11y/annotation-queues`
 * surface; when the runtime is not initialized (503) or unrouted (404) it shows an
 * honest RuntimeNotice — never fabricated queues. Read-only list here; items are
 * worked in the annotation flow.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { O11yApi, type AnnotationQueue, type O11yPageMeta } from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { RuntimeNotice } from './observability/RuntimeNotice'
import { Pager } from './observability/Pager'
import { fmtDate } from './observability/format'

const PAGE_LIMIT = 50

export function AnnotationQueuesModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<AnnotationQueue[]>([])
  const [meta, setMeta] = useState<O11yPageMeta | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const res = await O11yApi.annotationQueues({ page: p, limit: PAGE_LIMIT })
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

  const columns: Column<AnnotationQueue>[] = [
    { key: 'name', header: 'Name', render: (q) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{q.name}</Text> },
    { key: 'description', header: 'Description', render: (q) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{q.description || '—'}</Text> },
    { key: 'scoreConfigIds', header: 'Score configs', width: 130, render: (q) => <Text fontSize="$3" color="$color11">{q.scoreConfigIds?.length ?? 0}</Text> },
    { key: 'createdAt', header: 'Created', width: 190, render: (q) => <Text fontSize="$3" color="$color11">{fmtDate(q.createdAt)}</Text> },
  ]

  return (
    <>
      <PageHeader
        title="Annotation Queues"
        subtitle="Review queues — traces and observations to score against score configs."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load(page)}>
            Refresh
          </Button>
        }
      />

      {error ? (
        <RuntimeNotice surface="annotation-queues" error={error} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(q) => q.id}
            empty="No annotation queues yet. Create a queue to organize human review and scoring."
          />
          <Pager meta={meta} onPage={setPage} />
        </>
      )}
    </>
  )
}
