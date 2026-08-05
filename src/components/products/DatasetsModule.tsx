'use client'

/**
 * Datasets — curate evaluation datasets (ported from the old console's datasets
 * feature). Wired to the REAL cloud `/v1/evals/*` facade, which proxies the
 * console's public dataset API:
 *   - POST /v1/evals/datasets       create a dataset
 *   - POST /v1/evals/datasets/:name/items  add an item (input + expected output)
 *
 * The gateway does not mount a dataset LIST route yet, so the list area attempts
 * the forward-compatible GET and renders an honest "not available here yet" card
 * on 404/405 — it lights up automatically once the read route lands. Create and
 * add always work; nothing is fabricated.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Plus, RefreshCw, Database, Trash2 } from '@hanzogui/lucide-icons-2'

import { EvalsApi, type EvalDataset, type EvalDatasetItem, type EvalDatasetRun } from '~/lib/api'
import { BackendStateCard, DataTable, FieldRow, FieldText, FieldTextArea, PageHeader, classifyBackend, type BackendState, type Column } from '@hanzo/ui/product'

type ListState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; rows: EvalDataset[] }

const fmtTime = (s?: string) => {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

/** Plain text stays a string; valid JSON is sent as JSON; empty is omitted. */
const parseMaybeJson = (s: string): unknown => {
  const t = s.trim()
  if (!t) return undefined
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}

const columns: Column<EvalDataset>[] = [
  { key: 'name', header: 'Name', render: (d) => (
    <Text fontSize="$3" fontWeight="600" numberOfLines={1}>{d.name}</Text>
  ) },
  { key: 'description', header: 'Description', render: (d) => (
    <Text fontSize="$3" color={d.description ? '$color11' : '$color10'} numberOfLines={1}>
      {d.description || '—'}
    </Text>
  ) },
  { key: 'createdAt', header: 'Created', width: 190, render: (d) => (
    <Text fontSize="$3" color="$color10">{fmtTime(d.createdAt)}</Text>
  ) },
]

const preview = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function DatasetsModule(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const [list, setList] = useState<ListState>({ phase: 'loading' })

  // Create dataset
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [createMsg, setCreateMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  // Add item
  const [itemDataset, setItemDataset] = useState('')
  const [input, setInput] = useState('')
  const [expected, setExpected] = useState('')
  const [adding, setAdding] = useState(false)
  const [addMsg, setAddMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  const loadList = useCallback(() => {
    setList({ phase: 'loading' })
    EvalsApi.listDatasets()
      .then((rows) => setList({ phase: 'ready', rows }))
      .catch((e) => setList({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    loadList()
  }, [loadList])

  const createDataset = async () => {
    if (!name.trim()) {
      setCreateMsg({ tone: 'err', text: 'Name is required.' })
      return
    }
    setCreating(true)
    setCreateMsg(null)
    try {
      const d = await EvalsApi.createDataset({ name: name.trim(), description: description.trim() || undefined })
      setCreateMsg({ tone: 'ok', text: `Created dataset "${d?.name ?? name.trim()}".` })
      setItemDataset((cur) => cur || name.trim())
      setName('')
      setDescription('')
      loadList()
    } catch (e) {
      setCreateMsg({ tone: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setCreating(false)
    }
  }

  const addItem = async () => {
    if (!itemDataset.trim()) {
      setAddMsg({ tone: 'err', text: 'Dataset name is required.' })
      return
    }
    setAdding(true)
    setAddMsg(null)
    try {
      await EvalsApi.createDatasetItem(itemDataset.trim(), {
        input: parseMaybeJson(input),
        expectedOutput: parseMaybeJson(expected),
      })
      setAddMsg({ tone: 'ok', text: `Added item to "${itemDataset.trim()}".` })
      setInput('')
      setExpected('')
    } catch (e) {
      setAddMsg({ tone: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setAdding(false)
    }
  }

  const Status = ({ m }: { m: { tone: 'ok' | 'err'; text: string } | null }) =>
    m ? (
      <Text fontSize="$2" color={m.tone === 'ok' ? '$color11' : '$color12'}>
        {m.text}
      </Text>
    ) : null

  // Delete a dataset + its items (real DELETE /v1/evals/datasets/:name, org-scoped).
  const onDeleteDataset = async (d: EvalDataset) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete dataset "${d.name}" and all its items?`)) return
    try {
      await EvalsApi.deleteDataset(d.name)
      setCreateMsg({ tone: 'ok', text: `Deleted dataset "${d.name}".` })
      loadList()
    } catch (e) {
      setCreateMsg({ tone: 'err', text: `Could not delete "${d.name}": ${classifyBackend(e).message}` })
    }
  }

  // The display columns + a row-level delete (the const `columns` can't reach a
  // handler; the action column lives here where `onDeleteDataset` is in scope).
  const datasetColumns: Column<EvalDataset>[] = [
    ...columns,
    {
      key: 'action',
      header: '',
      width: 80,
      render: (d) => (
        <XStack justify="flex-end" flex={1}>
          <Button size="$2" icon={<Trash2 size={14} />} onPress={() => void onDeleteDataset(d)} aria-label={`Delete ${d.name}`} />
        </XStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Datasets"
        subtitle="Curate evaluation datasets and items."
        actions={
          <XStack gap="$2">
            <Button size="$2" onPress={() => router.push('/datasets/items')}>
              Items
            </Button>
            <Button size="$2" onPress={() => router.push('/datasets/runs')}>
              Runs
            </Button>
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={loadList}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {/* ── List (forward-compatible; honest when the read route is absent) ── */}
      {list.phase === 'error' ? (
        <BackendStateCard state={list.error} onRetry={loadList} hint="endpoint · GET /v1/evals/datasets" />
      ) : (
        <DataTable
          columns={datasetColumns}
          rows={list.phase === 'ready' ? list.rows : []}
          loading={list.phase === 'loading'}
          rowKey={(d) => d.id ?? d.name}
          empty="No datasets returned. Create one below, then add items."
        />
      )}

      {/* ── Create + add ───────────────────────────────────────────────── */}
      <XStack gap="$4" flexWrap="wrap" items="flex-start">
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" flex={1} minW={340}>
          <XStack gap="$2" items="center">
            <Database size={16} />
            <Text fontSize="$4" fontWeight="700">New dataset</Text>
          </XStack>
          <FieldRow label="Name">
            <FieldText value={name} onChange={setName} placeholder="my-eval-set" />
          </FieldRow>
          <FieldRow label="Description">
            <FieldText value={description} onChange={setDescription} />
          </FieldRow>
          <XStack gap="$3" items="center">
            <Button self="flex-start" icon={<Plus size={15} />} disabled={creating} onPress={() => void createDataset()}>
              {creating ? 'Creating…' : 'Create'}
            </Button>
            <Status m={createMsg} />
          </XStack>
        </Card>

        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" flex={1} minW={340}>
          <XStack gap="$2" items="center">
            <Plus size={16} />
            <Text fontSize="$4" fontWeight="700">Add item</Text>
          </XStack>
          <FieldRow label="Dataset">
            <FieldText value={itemDataset} onChange={setItemDataset} placeholder="dataset name" />
          </FieldRow>
          <FieldRow label="Input">
            <FieldTextArea value={input} onChange={setInput} rows={3} />
          </FieldRow>
          <FieldRow label="Expected output">
            <FieldTextArea value={expected} onChange={setExpected} rows={3} />
          </FieldRow>
          <XStack gap="$3" items="center">
            <Button self="flex-start" icon={<Plus size={15} />} disabled={adding} onPress={() => void addItem()}>
              {adding ? 'Adding…' : 'Add item'}
            </Button>
            <Status m={addMsg} />
          </XStack>
          <Text fontSize="$2" color="$color10">
            Input and expected output accept plain text or JSON.
          </Text>
        </Card>
      </XStack>
    </>
  )
}

export function DatasetItemsModule(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const [list, setList] = useState<
    | { phase: 'loading' }
    | { phase: 'error'; error: BackendState }
    | { phase: 'ready'; rows: EvalDatasetItem[] }
  >({ phase: 'loading' })

  const load = useCallback(() => {
    setList({ phase: 'loading' })
    // A dataset item only exists inside a set; fetch the org's datasets, then
    // their items in parallel, and flatten — real rows, never fabricated.
    EvalsApi.listDatasets()
      .then((datasets) =>
        Promise.all(datasets.map((d) => EvalsApi.listDatasetItems(d.name).catch(() => [] as EvalDatasetItem[]))),
      )
      .then((batches) => setList({ phase: 'ready', rows: batches.flat() }))
      .catch((e) => setList({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const itemColumns: Column<EvalDatasetItem>[] = [
    { key: 'id', header: 'Item', render: (i) => <Text fontSize="$3" fontWeight="600" numberOfLines={1}>{i.id || '—'}</Text> },
    { key: 'datasetName', header: 'Dataset', width: 180, render: (i) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{i.datasetName || '—'}</Text> },
    { key: 'input', header: 'Input', render: (i) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{preview(i.input)}</Text> },
    { key: 'expectedOutput', header: 'Expected', render: (i) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{preview(i.expectedOutput)}</Text> },
    { key: 'createdAt', header: 'Created', width: 190, render: (i) => <Text fontSize="$3" color="$color10">{fmtTime(i.createdAt)}</Text> },
  ]

  return (
    <>
      <PageHeader
        title="Dataset Items"
        subtitle="Evaluation inputs and expected outputs."
        actions={
          <XStack gap="$2">
            <Button size="$2" onPress={() => router.push('/datasets')}>
              Datasets
            </Button>
            <Button size="$2" onPress={() => router.push('/datasets/runs')}>
              Runs
            </Button>
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
          </XStack>
        }
      />
      {list.phase === 'error' ? (
        <BackendStateCard state={list.error} onRetry={load} hint="endpoint · GET /v1/evals/datasets/:name/items" />
      ) : (
        <DataTable
          columns={itemColumns}
          rows={list.phase === 'ready' ? list.rows : []}
          loading={list.phase === 'loading'}
          rowKey={(i) => i.id ?? `${i.datasetName ?? 'dataset'}-${preview(i.input)}`}
          empty="No dataset items returned."
        />
      )}
    </>
  )
}

export function DatasetRunsModule(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const [list, setList] = useState<
    | { phase: 'loading' }
    | { phase: 'error'; error: BackendState }
    | { phase: 'ready'; rows: EvalDatasetRun[] }
  >({ phase: 'loading' })

  const load = useCallback(() => {
    setList({ phase: 'loading' })
    EvalsApi.listRuns()
      .then((rows) => setList({ phase: 'ready', rows }))
      .catch((e) => setList({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const runColumns: Column<EvalDatasetRun>[] = [
    { key: 'runName', header: 'Run', render: (r) => <Text fontSize="$3" fontWeight="600" numberOfLines={1}>{r.runName || '—'}</Text> },
    { key: 'dataset', header: 'Dataset', width: 160, render: (r) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{r.dataset || '—'}</Text> },
    { key: 'model', header: 'Model', width: 160, render: (r) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{r.model || '—'}</Text> },
    { key: 'judgeModel', header: 'Judge', width: 150, render: (r) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{r.judgeModel || '—'}</Text> },
    { key: 'scored', header: 'Scored', width: 90, render: (r) => <Text fontSize="$3" color="$color11">{r.scored != null ? `${r.scored}/${r.items ?? '—'}` : '—'}</Text> },
    { key: 'avgScore', header: 'Avg score', width: 100, render: (r) => <Text fontSize="$3" color="$color11">{typeof r.avgScore === 'number' ? r.avgScore.toFixed(3) : '—'}</Text> },
    { key: 'createdAt', header: 'Created', width: 180, render: (r) => <Text fontSize="$3" color="$color10">{fmtTime(r.createdAt)}</Text> },
  ]

  return (
    <>
      <PageHeader
        title="Dataset Runs"
        subtitle="Experiment runs created from datasets."
        actions={
          <XStack gap="$2">
            <Button size="$2" onPress={() => router.push('/datasets')}>
              Datasets
            </Button>
            <Button size="$2" onPress={() => router.push('/datasets/items')}>
              Items
            </Button>
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
          </XStack>
        }
      />
      {list.phase === 'error' ? (
        <BackendStateCard state={list.error} onRetry={load} hint="endpoint · GET /v1/evals/dataset-runs" />
      ) : (
        <DataTable
          columns={runColumns}
          rows={list.phase === 'ready' ? list.rows : []}
          loading={list.phase === 'loading'}
          rowKey={(r) => `${r.dataset ?? 'dataset'}-${r.runName ?? 'run'}`}
          empty="No dataset runs returned."
        />
      )}
    </>
  )
}
