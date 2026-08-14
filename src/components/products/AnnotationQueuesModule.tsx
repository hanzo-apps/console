'use client'

/**
 * Annotation Queues — list of review queues (HIP-0106), native on @hanzo/gui.
 *
 * An annotation queue is a named work queue of traces/observations to review and
 * score against a set of rubrics. Reads the REAL `/v1/o11y/reviews`
 * surface; when the runtime is not initialized (503) or unrouted (404) it shows an
 * honest RuntimeNotice — never fabricated queues. Read-only list here; items are
 * worked in the annotation flow.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack } from '@hanzo/gui'
import { ArrowLeft, ChevronRight, RefreshCw } from '@hanzogui/lucide-icons-2'

import {
  O11yApi,
  type AnnotationQueue,
  type AnnotationQueueDetail,
  type AnnotationQueueItem,
  type O11yPageMeta,
} from '~/lib/api'
import { RuntimeNotice } from './observability/RuntimeNotice'
import { Pager } from './observability/Pager'
import { fmtDate } from './observability/format'
import { DataTable, PageHeader, type Column } from '@hanzo/ui/product'

const PAGE_LIMIT = 50

function AnnotationQueueListView({ onOpen }: { onOpen: (q: AnnotationQueue) => void }) {
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
    {
      key: 'name',
      header: 'Name',
      render: (q) => (
        <Button chromeless px="$0" onPress={() => onOpen(q)}>
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
            {q.name}
          </Text>
        </Button>
      ),
    },
    { key: 'description', header: 'Description', render: (q) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{q.description || '—'}</Text> },
    { key: 'scoreConfigIds', header: 'Score configs', width: 130, render: (q) => <Text fontSize="$3" color="$color11">{q.scoreConfigIds?.length ?? 0}</Text> },
    { key: 'createdAt', header: 'Created', width: 190, render: (q) => <Text fontSize="$3" color="$color11">{fmtDate(q.createdAt)}</Text> },
    {
      key: 'action',
      header: '',
      width: 120,
      render: (q) => (
        <XStack justify="flex-end" flex={1}>
          <Button size="$2" iconAfter={<ChevronRight size={14} />} onPress={() => onOpen(q)}>
            Open
          </Button>
        </XStack>
      ),
    },
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
            onRowPress={onOpen}
            empty="No annotation queues yet. Create a queue to organize human review and scoring."
          />
          <Pager meta={meta} onPage={setPage} />
        </>
      )}
    </>
  )
}

function AnnotationQueueDetailView({ id, onBack, onOpenTrace }: { id: string; onBack: () => void; onOpenTrace: (traceId: string) => void }) {
  const [queue, setQueue] = useState<AnnotationQueueDetail | null>(null)
  const [items, setItems] = useState<AnnotationQueueItem[]>([])
  const [meta, setMeta] = useState<O11yPageMeta | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const [detail, list] = await Promise.all([
        O11yApi.annotationQueue(id),
        O11yApi.annotationQueueItems(id, { page: p, limit: PAGE_LIMIT }),
      ])
      setQueue(detail)
      setItems(list.data ?? detail.items ?? [])
      setMeta(list.meta ?? null)
      setError(null)
    } catch (e) {
      setError(e)
      setQueue(null)
      setItems([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load(page)
  }, [load, page])

  const itemColumns: Column<AnnotationQueueItem>[] = [
    { key: 'id', header: 'Item', render: (i) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{i.id}</Text> },
    {
      key: 'traceId',
      header: 'Trace',
      render: (i) =>
        i.traceId ? (
          <Button chromeless px="$0" onPress={() => onOpenTrace(i.traceId as string)}>
            <Text fontSize="$3" color="$color12" numberOfLines={1}>{i.traceId}</Text>
          </Button>
        ) : (
          <Text fontSize="$3" color="$color10">—</Text>
        ),
    },
    { key: 'observationId', header: 'Observation', render: (i) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{i.observationId || '—'}</Text> },
    { key: 'status', header: 'Status', width: 120, render: (i) => <Text fontSize="$3" color="$color11">{i.status || '—'}</Text> },
    { key: 'assignee', header: 'Assignee', width: 180, render: (i) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{i.assignee || '—'}</Text> },
    { key: 'createdAt', header: 'Created', width: 190, render: (i) => <Text fontSize="$3" color="$color11">{fmtDate(i.createdAt)}</Text> },
  ]

  return (
    <>
      <PageHeader
        title={queue?.name ?? id}
        subtitle="Annotation queue detail and work items."
        actions={
          <XStack gap="$2">
            <Button icon={<ArrowLeft size={16} />} onPress={onBack}>
              Back
            </Button>
            <Button icon={<RefreshCw size={16} />} onPress={() => void load(page)}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {error ? (
        <RuntimeNotice surface="annotation-queue" error={error} />
      ) : loading && !queue ? (
        <Text color="$color11">Loading…</Text>
      ) : (
        <>
          {queue ? (
            <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
              <Text fontSize="$5" fontWeight="700">Overview</Text>
              <Text fontSize="$3" color="$color11">{queue.description || 'No description.'}</Text>
              <Text fontSize="$2" color="$color10">
                Score configs: {queue.scoreConfigIds?.length ? queue.scoreConfigIds.join(', ') : '—'}
              </Text>
            </Card>
          ) : null}
          <DataTable
            columns={itemColumns}
            rows={items}
            loading={loading}
            rowKey={(i) => i.id}
            empty="No items returned for this queue."
          />
          <Pager meta={meta} onPage={setPage} />
        </>
      )}
    </>
  )
}

export function AnnotationQueuesModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const id = params.id
  if (id) {
    return (
      <AnnotationQueueDetailView
        id={decodeURIComponent(id)}
        onBack={() => router.push('/annotation-queues')}
        onOpenTrace={(traceId) => router.push(`/o11y/${encodeURIComponent(traceId)}`)}
      />
    )
  }
  return <AnnotationQueueListView onOpen={(q) => router.push(`/annotation-queues/${encodeURIComponent(q.id)}`)} />
}
