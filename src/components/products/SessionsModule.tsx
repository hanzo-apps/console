'use client'

/**
 * Sessions — list + detail for grouped traces (HIP-0106), native on @hanzo/gui.
 *
 * List at `/sessions`, one session at `/sessions/<id>` (selected by the `id`
 * route param). Reads the REAL `/v1/o11y/sessions` surface; when the runtime is
 * not initialized (503) or unrouted (404) it shows an honest RuntimeNotice —
 * never fabricated sessions or traces.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, ChevronRight, RefreshCw } from '@hanzogui/lucide-icons-2'

import {
  O11yApi,
  type O11yPageMeta,
  type Session,
  type SessionDetail,
  type Trace,
} from '~/lib/api'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { RuntimeNotice } from './observability/RuntimeNotice'
import { Pager } from './observability/Pager'
import { DetailRow } from './observability/parts'
import { fmtCost, fmtDate, fmtLatency } from './observability/format'

const PAGE_LIMIT = 50

/** List + pager surface — the index view. */
function SessionListView({ onOpen }: { onOpen: (s: Session) => void }) {
  const [rows, setRows] = useState<Session[]>([])
  const [meta, setMeta] = useState<O11yPageMeta | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const res = await O11yApi.sessions({ page: p, limit: PAGE_LIMIT })
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

  const columns: Column<Session>[] = [
    {
      key: 'id',
      header: 'Session',
      render: (s) => (
        <Button chromeless px="$0" onPress={() => onOpen(s)}>
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
            {s.id}
          </Text>
        </Button>
      ),
    },
    { key: 'createdAt', header: 'Created', width: 220, render: (s) => <Text fontSize="$3" color="$color11">{fmtDate(s.createdAt)}</Text> },
    { key: 'environment', header: 'Environment', width: 160, render: (s) => <Text fontSize="$3" color="$color11">{s.environment || 'default'}</Text> },
    {
      key: 'action',
      header: '',
      width: 120,
      render: (s) => (
        <XStack justify="flex-end" flex={1}>
          <Button size="$2" iconAfter={<ChevronRight size={14} />} onPress={() => onOpen(s)}>
            Open
          </Button>
        </XStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Sessions"
        subtitle="Traces grouped into multi-turn sessions."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load(page)}>
            Refresh
          </Button>
        }
      />

      {error ? (
        <RuntimeNotice surface="sessions" error={error} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(s) => s.id}
            empty="No sessions yet. Sessions appear here once your traces carry a session id."
          />
          <Pager meta={meta} onPage={setPage} />
        </>
      )}
    </>
  )
}

/** Detail surface — overview plus the session's traces. */
function SessionDetailView({ id, onBack, onOpenTrace }: { id: string; onBack: () => void; onOpenTrace: (t: Trace) => void }) {
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await O11yApi.session(id)
      setSession(data)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const traceColumns: Column<Trace>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (t) => (
        <Button chromeless px="$0" onPress={() => onOpenTrace(t)}>
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
            {t.name || t.id}
          </Text>
        </Button>
      ),
    },
    { key: 'timestamp', header: 'Timestamp', width: 190, render: (t) => <Text fontSize="$3" color="$color11">{fmtDate(t.timestamp)}</Text> },
    { key: 'latency', header: 'Latency', width: 100, render: (t) => <Text fontSize="$3" color="$color11">{fmtLatency(t.latency)}</Text> },
    { key: 'totalCost', header: 'Cost', width: 100, render: (t) => <Text fontSize="$3" color="$color11">{fmtCost(t.totalCost)}</Text> },
  ]

  return (
    <>
      <PageHeader
        title={id}
        subtitle="Session detail"
        actions={
          <XStack gap="$2">
            <Button icon={<ArrowLeft size={16} />} onPress={onBack}>
              Back
            </Button>
            <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {error ? (
        <RuntimeNotice surface="sessions" error={error} />
      ) : loading && !session ? (
        <Text color="$color11">Loading…</Text>
      ) : session ? (
        <>
          <Card p="$4" gap="$1" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$5" fontWeight="700" mb="$2">
              Overview
            </Text>
            <DetailRow label="ID" value={session.id} />
            <DetailRow label="Created" value={fmtDate(session.createdAt)} />
            <DetailRow label="Environment" value={session.environment || 'default'} />
            <DetailRow label="Traces" value={String(session.traces?.length ?? 0)} />
          </Card>

          <YStack gap="$2">
            <Text fontSize="$5" fontWeight="700">
              Traces
            </Text>
            <DataTable
              columns={traceColumns}
              rows={session.traces ?? []}
              rowKey={(t) => t.id}
              empty="No traces in this session."
            />
          </YStack>
        </>
      ) : null}
    </>
  )
}

export function SessionsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const id = params.id
  if (id) {
    return (
      <SessionDetailView
        id={decodeURIComponent(id)}
        onBack={() => router.push('/sessions')}
        onOpenTrace={(t) => router.push(`/o11y/${encodeURIComponent(t.id)}`)}
      />
    )
  }
  return <SessionListView onOpen={(s) => router.push(`/sessions/${encodeURIComponent(s.id)}`)} />
}
