'use client'

/**
 * Prompts — versioned prompt management over the REAL cloud `/v1/prompts` surface
 * (cloud `clients/prompts`), reached through the console's OWN user-bearer `/v1`
 * proxy (`PromptsApi` → `originV1Url('prompts')`). The proxy mints a short-lived
 * user token server-side and the backend scopes to the token owner's org, so every
 * read is org-scoped and no credential reaches the browser — the SAME per-tenant
 * path Agents + Functions use.
 *
 * This replaces the old cookie-only same-origin `v1Url('prompts')` calls, which the
 * cloud surface 403'd ("X-Org-Id required") and surfaced as the live "Access
 * required · GET /v1/prompts" card (same class as the "models empty" bug).
 *
 * Routes:
 *   /prompts          list prompt metadata
 *   /prompts/new      create a prompt
 *   /prompts/metrics  prompt usage/performance metrics
 *   /prompts/:name    prompt detail / version history
 *
 * Every state is honest: loading, the shared backend-state card on 401/403/404/503,
 * and a true empty state — never placeholder prompts or fabricated metrics.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, BarChart3, Check, Download, Library, Plus, RefreshCw } from '@hanzogui/lucide-icons-2'

import { PromptsApi, type Prompt, type PromptMetricRow, type CatalogEntry } from '~/lib/api/prompts'
import { BackendStateCard, DataTable, FieldRow, FieldText, FieldTextArea, PageHeader, classifyBackend, type BackendState, type Column } from '@hanzo/ui/product'

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

/**
 * StarterLibrary — browse the read-only Hanzo starter catalog and import an
 * entry into THIS org's prompts. Import is a normal create; the org store stays
 * honestly empty until the user chooses. `existing` marks names the org already
 * has so we never offer a duplicate import.
 */
function StarterLibrary({ existing, onImported }: { existing: Set<string>; onImported: () => void }) {
  const [state, setState] = useState<Async<CatalogEntry[]>>({ phase: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    PromptsApi.catalog()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const importOne = async (e: CatalogEntry) => {
    setBusy(e.name)
    try {
      await PromptsApi.create({ name: e.name, type: e.type, prompt: e.prompt, labels: e.labels, tags: e.tags })
      setDone((s) => new Set(s).add(e.name))
      onImported()
    } catch {
      // Honest: leave the row un-imported; the list refresh will reflect reality.
    } finally {
      setBusy(null)
    }
  }

  if (state.phase === 'error') {
    return <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/prompts/catalog" />
  }
  const entries = state.phase === 'ready' ? state.data : []

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" mb="$3">
      <XStack items="center" gap="$2">
        <Library size={16} />
        <Text fontSize="$5" fontWeight="700">Starter library</Text>
        <Text fontSize="$2" color="$color10">
          {state.phase === 'loading' ? 'Loading…' : `${entries.length} curated starters — import to your org`}
        </Text>
      </XStack>
      <YStack maxH={360} overflow="scroll" gap="$1">
        {entries.map((e) => {
          const already = existing.has(e.name) || done.has(e.name)
          return (
            <XStack key={e.name} items="center" justify="space-between" gap="$3" py="$2" px="$2" rounded="$2" hoverStyle={{ bg: '$color2' }}>
              <YStack flex={1} gap="$1">
                <Text fontSize="$3" fontWeight="600" numberOfLines={1}>{e.name}</Text>
                <Text fontSize="$2" color="$color10" numberOfLines={1}>{list(e.tags)}</Text>
              </YStack>
              <Button
                size="$2"
                disabled={already || busy === e.name}
                icon={already ? <Check size={14} /> : <Download size={14} />}
                onPress={() => void importOne(e)}
              >
                {already ? 'Imported' : busy === e.name ? 'Importing…' : 'Import'}
              </Button>
            </XStack>
          )
        })}
      </YStack>
    </Card>
  )
}

function PromptListView() {
  const router = useRouter()
  const [state, setState] = useState<Async<Prompt[]>>({ phase: 'loading' })
  const [showCatalog, setShowCatalog] = useState(false)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    PromptsApi.list()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const existing = useMemo(
    () => new Set(state.phase === 'ready' ? state.data.map((p) => p.name) : []),
    [state],
  )

  const columns: Column<Prompt>[] = [
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
            <Button size="$2" icon={<Library size={15} />} onPress={() => setShowCatalog((v) => !v)}>
              Starter library
            </Button>
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

      {showCatalog ? <StarterLibrary existing={existing} onImported={load} /> : null}

      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/prompts" />
      ) : (
        <DataTable
          columns={columns}
          rows={state.phase === 'ready' ? state.data : []}
          loading={state.phase === 'loading'}
          rowKey={(p) => p.name}
          empty="No prompts yet. Create your own, or open the Starter library to import curated prompts."
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
    PromptsApi.get(name)
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
  const [state, setState] = useState<Async<PromptMetricRow[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    PromptsApi.metrics()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const columns: Column<PromptMetricRow>[] = useMemo(
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
      await PromptsApi.create({
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
        subtitle="Create a versioned prompt on the unified prompt API."
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
