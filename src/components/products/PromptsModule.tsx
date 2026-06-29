'use client'

/**
 * Prompts — versioned prompt management, ported from the old console.
 *
 * Routes:
 *   /prompts          list prompt metadata
 *   /prompts/new      create a prompt through the forward-compatible API
 *   /prompts/metrics  prompt usage/performance metrics
 *   /prompts/:name    prompt detail/history payload
 *
 * The cloud gateway may not mount every prompt route yet. When a route returns
 * 404/405/503, the shared backend-state card renders instead of placeholder
 * prompts or charts.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, BarChart3, ExternalLink, Plus, RefreshCw } from '@hanzogui/lucide-icons-2'

import { restGet, restPost, v1Url } from '~/lib/api/client'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { FieldRow, FieldText, FieldTextArea } from '~/components/ui/Field'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'

const PROMPTS_SURFACE = 'https://insights.hanzo.ai'
const PROMPTS_DOCS = 'https://docs.hanzo.ai/prompts'

type PromptMeta = {
  name: string
  versions?: number[]
  type?: string
  labels?: string[]
  tags?: string[]
  lastUpdatedAt?: string
}

type MetricRow = Record<string, unknown> & { __rowId: string }

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

const fmtTime = (s?: string) => {
  if (!s) return '-'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

const list = (xs?: string[]) => (xs && xs.length ? xs.join(', ') : '-')

const csv = (s: string): string[] | undefined => {
  const xs = s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  return xs.length ? xs : undefined
}

const promptRows = (payload: { data?: PromptMeta[] } | PromptMeta[]): PromptMeta[] =>
  Array.isArray(payload) ? payload : (payload.data ?? [])

const metricRows = (payload: unknown): MetricRow[] => {
  const rows =
    Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object'
        ? ((payload as Record<string, unknown>).data ??
          (payload as Record<string, unknown>).metrics ??
          (payload as Record<string, unknown>).rows)
        : []
  if (!Array.isArray(rows)) return []
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    .map((row, index) => ({
      ...row,
      __rowId:
        (typeof row.name === 'string' && row.name) ||
        (typeof row.id === 'string' && row.id) ||
        `metric-${index}`,
    }))
}

function PromptListView() {
  const router = useRouter()
  const [state, setState] = useState<Async<PromptMeta[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    restGet<{ data?: PromptMeta[] } | PromptMeta[]>(v1Url('prompts'))
      .then((res) => setState({ phase: 'ready', data: promptRows(res) }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const columns: Column<PromptMeta>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (p) => (
        <Button chromeless px="$0" onPress={() => router.push(`/prompts/${encodeURIComponent(p.name)}`)}>
          <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
            {p.name}
          </Text>
        </Button>
      ),
    },
    {
      key: 'versions',
      header: 'Versions',
      width: 100,
      render: (p) => <Text fontSize="$3" color="$color11">{p.versions?.length ?? '-'}</Text>,
    },
    {
      key: 'type',
      header: 'Type',
      width: 90,
      render: (p) => <Text fontSize="$3" color="$color11">{p.type || '-'}</Text>,
    },
    {
      key: 'labels',
      header: 'Labels',
      render: (p) => (
        <Text fontSize="$3" color={p.labels?.length ? '$color11' : '$color10'} numberOfLines={1}>
          {list(p.labels)}
        </Text>
      ),
    },
    {
      key: 'lastUpdatedAt',
      header: 'Updated',
      width: 190,
      render: (p) => <Text fontSize="$3" color="$color10">{fmtTime(p.lastUpdatedAt)}</Text>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Prompts"
        subtitle="Versioned prompts with labels, history, and metrics."
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<BarChart3 size={15} />} onPress={() => router.push('/prompts/metrics')}>
              Metrics
            </Button>
            <Button size="$2" icon={<Plus size={15} />} onPress={() => router.push('/prompts/new')}>
              New
            </Button>
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {state.phase === 'error' ? (
        <YStack gap="$3">
          <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/prompts" />
          <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" bg="$color2" maxWidth={640}>
            <Text fontSize="$4" fontWeight="700">Where prompts live today</Text>
            <Text fontSize="$3" color="$color11">
              Prompt versions, labels, and history are managed in the observability surface until
              the unified prompt API is mounted on this deployment.
            </Text>
            <XStack gap="$2">
              <Button
                size="$2"
                iconAfter={<ExternalLink size={14} />}
                onPress={() => {
                  if (typeof window !== 'undefined') window.open(PROMPTS_SURFACE, '_blank', 'noopener')
                }}
              >
                Observability
              </Button>
              <Button
                size="$2"
                chromeless
                iconAfter={<ExternalLink size={14} />}
                onPress={() => {
                  if (typeof window !== 'undefined') window.open(PROMPTS_DOCS, '_blank', 'noopener')
                }}
              >
                Docs
              </Button>
            </XStack>
          </Card>
        </YStack>
      ) : (
        <DataTable
          columns={columns}
          rows={state.phase === 'ready' ? state.data : []}
          loading={state.phase === 'loading'}
          rowKey={(p) => p.name}
          empty="No prompts yet."
          onRowPress={(p) => router.push(`/prompts/${encodeURIComponent(p.name)}`)}
        />
      )}
    </>
  )
}

function PromptDetailView({ name }: { name: string }) {
  const router = useRouter()
  const [state, setState] = useState<Async<unknown>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    restGet<unknown>(v1Url(`prompts/${encodeURIComponent(name)}`))
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [name])

  useEffect(() => {
    load()
  }, [load])

  return (
    <>
      <PageHeader
        title={name}
        subtitle="Prompt detail and version history."
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<ArrowLeft size={15} />} onPress={() => router.push('/prompts')}>
              Back
            </Button>
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
          </XStack>
        }
      />
      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} hint={`endpoint · GET /v1/prompts/${name}`} />
      ) : state.phase === 'loading' ? (
        <Text color="$color11">Loading...</Text>
      ) : (
        <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$5" fontWeight="700">Payload</Text>
          <YStack maxH={520} overflow="scroll" bg="$color2" rounded="$3" p="$3">
            <Text fontSize="$2" color="$color11" selectable style={{ fontFamily: 'monospace' }}>
              {JSON.stringify(state.data, null, 2)}
            </Text>
          </YStack>
        </Card>
      )}
    </>
  )
}

function PromptMetricsView() {
  const router = useRouter()
  const [state, setState] = useState<Async<MetricRow[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    restGet<unknown>(v1Url('prompts/metrics'))
      .then((data) => setState({ phase: 'ready', data: metricRows(data) }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const columns: Column<MetricRow>[] = useMemo(
    () => [
      { key: 'name', header: 'Prompt', render: (r) => <Text fontSize="$3" fontWeight="600">{String(r.name ?? r.id ?? '-')}</Text> },
      { key: 'version', header: 'Version', width: 100, render: (r) => <Text fontSize="$3" color="$color11">{String(r.version ?? '-')}</Text> },
      { key: 'count', header: 'Calls', width: 100, render: (r) => <Text fontSize="$3" color="$color11">{String(r.count ?? '-')}</Text> },
      { key: 'latency', header: 'Latency', width: 120, render: (r) => <Text fontSize="$3" color="$color11">{String(r.latency ?? r.avgLatency ?? '-')}</Text> },
      { key: 'updatedAt', header: 'Updated', width: 190, render: (r) => <Text fontSize="$3" color="$color11">{fmtTime(typeof r.updatedAt === 'string' ? r.updatedAt : undefined)}</Text> },
    ],
    [],
  )

  return (
    <>
      <PageHeader
        title="Prompt Metrics"
        subtitle="Usage and performance metrics for prompt versions."
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<ArrowLeft size={15} />} onPress={() => router.push('/prompts')}>
              Back
            </Button>
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
          </XStack>
        }
      />
      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/prompts/metrics" />
      ) : (
        <DataTable
          columns={columns}
          rows={state.phase === 'ready' ? state.data : []}
          loading={state.phase === 'loading'}
          rowKey={(r) => r.__rowId}
          empty="No prompt metrics returned."
        />
      )}
    </>
  )
}

function PromptCreateView() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [type, setType] = useState('text')
  const [prompt, setPrompt] = useState('')
  const [labels, setLabels] = useState('')
  const [tags, setTags] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<BackendState | null>(null)

  const create = async () => {
    if (!name.trim()) {
      setError({ kind: 'error', message: 'Name is required.' })
      return
    }
    setWorking(true)
    setError(null)
    try {
      await restPost<unknown>(v1Url('prompts'), {
        name: name.trim(),
        type: type.trim() || 'text',
        prompt,
        labels: csv(labels),
        tags: csv(tags),
      })
      router.push(`/prompts/${encodeURIComponent(name.trim())}`)
    } catch (e) {
      setError(classifyBackend(e))
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <PageHeader
        title="New Prompt"
        subtitle="Create a versioned prompt through the unified prompt API."
        actions={
          <Button size="$2" icon={<ArrowLeft size={15} />} onPress={() => router.push('/prompts')}>
            Back
          </Button>
        }
      />
      {error ? <BackendStateCard state={error} hint="endpoint · POST /v1/prompts" /> : null}
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={760}>
        <FieldRow label="Name">
          <FieldText value={name} onChange={setName} placeholder="support-triage" />
        </FieldRow>
        <FieldRow label="Type">
          <FieldText value={type} onChange={setType} placeholder="text or chat" />
        </FieldRow>
        <FieldRow label="Prompt">
          <FieldTextArea value={prompt} onChange={setPrompt} rows={8} />
        </FieldRow>
        <FieldRow label="Labels">
          <FieldText value={labels} onChange={setLabels} placeholder="production, latest" />
        </FieldRow>
        <FieldRow label="Tags">
          <FieldText value={tags} onChange={setTags} placeholder="support, routing" />
        </FieldRow>
        <Button self="flex-start" icon={<Plus size={15} />} disabled={working} onPress={() => void create()}>
          {working ? 'Creating...' : 'Create prompt'}
        </Button>
      </Card>
    </>
  )
}

export function PromptsModule({ params }: { params: Record<string, string> }) {
  if (params.name) return <PromptDetailView name={decodeURIComponent(params.name)} />
  return <PromptListView />
}

export function PromptCreateModule(_props: { params: Record<string, string> }) {
  return <PromptCreateView />
}

export function PromptMetricsModule(_props: { params: Record<string, string> }) {
  return <PromptMetricsView />
}
