'use client'

/**
 * Embeddings · Collections — the org's knowledge stores as vector collections
 * (`GET /v1/get-stores`), each mapping to the Qdrant/Search index
 * `{owner}-{store}-docs`. Search + status/model filters + pagination over real
 * rows; honest "—" for the stats the store API does not expose (vector count,
 * dimension, index size); metric is the real fixed cosine; the timestamp shown is
 * the store's createdTime (there is no updatedTime field — labelled honestly).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Text, XStack, YStack } from '@hanzo/gui'
import { Boxes, Plus, RefreshCw, Search, Trash } from '@hanzogui/lucide-icons-2'

import { EmbeddingsApi } from '~/lib/api/embeddings'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { EmptyState } from '~/components/ui/EmptyState'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { FieldSelect } from '~/components/ui/Field'
import type { Collection, CollectionStatus } from './logic'

const PAGE_SIZE = 8
const fmtDate = (s?: string) => {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString()
}

const DOT: Record<CollectionStatus, '$green10' | '$yellow10' | '$color8'> = {
  Healthy: '$green10',
  Rebuilding: '$yellow10',
  Paused: '$color8',
  Unknown: '$color8',
}

function StatusDot({ status }: { status: CollectionStatus }) {
  return (
    <XStack items="center" gap="$1.5">
      <YStack width={7} height={7} rounded="$10" bg={DOT[status]} />
      <Text fontSize="$1" color="$color11">
        {status}
      </Text>
    </XStack>
  )
}

export function CollectionsView({
  owner,
  onOpen,
  onNew,
}: {
  owner: string
  onOpen: (name: string) => void
  onNew: () => void
}) {
  const [rows, setRows] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('All')
  const [model, setModel] = useState('All')
  const [page, setPage] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await EmbeddingsApi.collections(owner))
    } catch (e) {
      setError(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [owner])

  useEffect(() => {
    void load()
  }, [load])

  const models = useMemo(
    () => ['All', ...Array.from(new Set(rows.map((r) => r.model).filter(Boolean)))],
    [rows],
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (status !== 'All' && r.status !== status) return false
      if (model !== 'All' && r.model !== model) return false
      if (needle && !`${r.name} ${r.description}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [rows, q, status, model])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  const onDelete = async (c: Collection) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete collection "${c.name}"? This removes its vectors.`)) return
    try {
      await EmbeddingsApi.remove(c.owner, c.name)
      setRows((rs) => rs.filter((r) => r.name !== c.name))
    } catch (e) {
      setError(classifyBackend(e))
    }
  }

  const onReindex = async (c: Collection) => {
    try {
      await EmbeddingsApi.refresh(c.owner, c.name)
    } catch (e) {
      setError(classifyBackend(e))
    }
  }

  const columns: Column<Collection>[] = [
    {
      key: 'collection',
      header: 'COLLECTION',
      render: (c) => (
        <YStack gap="$1">
          <Text fontSize="$3" fontWeight="600" color="$color12" cursor="pointer" onPress={() => onOpen(c.name)} numberOfLines={1}>
            {c.name}
          </Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1}>
            {c.description}
          </Text>
          <StatusDot status={c.status} />
        </YStack>
      ),
    },
    { key: 'model', header: 'MODEL', width: 150, render: (c) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{c.model || '—'}</Text> },
    { key: 'vectors', header: 'VECTORS', width: 90, render: (c) => <Text fontSize="$3" color="$color11">{c.vectors != null ? c.vectors.toLocaleString() : '—'}</Text> },
    { key: 'dimension', header: 'DIMENSION', width: 100, render: (c) => <Text fontSize="$3" color="$color11">{c.dimension ?? '—'}</Text> },
    { key: 'metric', header: 'METRIC', width: 90, render: (c) => <Text fontSize="$3" color="$color11">{c.metric}</Text> },
    { key: 'size', header: 'SIZE', width: 80, render: (c) => <Text fontSize="$3" color="$color11">{c.sizeBytes != null ? `${c.sizeBytes}` : '—'}</Text> },
    { key: 'created', header: 'CREATED', width: 110, render: (c) => <Text fontSize="$3" color="$color11">{fmtDate(c.created)}</Text> },
    {
      key: 'menu',
      header: '',
      width: 132,
      render: (c) => (
        <XStack gap="$1.5">
          <Button size="$2" chromeless icon={<Search size={14} />} onPress={() => onOpen(c.name)} />
          <Button size="$2" chromeless icon={<RefreshCw size={14} />} onPress={() => void onReindex(c)} />
          <Button size="$2" chromeless icon={<Trash size={14} />} onPress={() => void onDelete(c)} />
        </XStack>
      ),
    },
  ]

  if (error) {
    return <BackendStateCard state={error} onRetry={() => void load()} hint="endpoint · GET /v1/get-stores" />
  }
  if (!loading && rows.length === 0) {
    return (
      <EmptyState
        icon={Boxes}
        title="Create your first collection"
        description="A collection is a vector index for one knowledge base. Each maps to the Vector/Search index {org}-{name}-docs; ingest documents to fill it."
        bullets={[
          'Embeddings are generated with a Zen embedding model',
          'Ingest from upload, GitHub, crawl, or S3 (Jobs tab)',
          'Query it from Explore or the /v1/search API',
        ]}
        primary={{ label: 'Create collection', onPress: onNew }}
      />
    )
  }

  return (
    <YStack gap="$3">
      <XStack flexWrap="wrap" gap="$2" items="center" justify="space-between">
        <XStack flexWrap="wrap" gap="$2" items="center" flex={1}>
          <YStack width={240}>
            <Input size="$3" placeholder="Search collections…" value={q} onChangeText={(v) => { setQ(v); setPage(0) }} autoCapitalize="none" />
          </YStack>
          <YStack width={150}>
            <FieldSelect value={status} options={['All', 'Healthy', 'Rebuilding', 'Paused', 'Unknown']} onChange={(v) => { setStatus(v); setPage(0) }} />
          </YStack>
          <YStack width={170}>
            <FieldSelect value={model} options={models} onChange={(v) => { setModel(v); setPage(0) }} />
          </YStack>
        </XStack>
        <Button size="$3" icon={<Plus size={15} />} onPress={onNew}>
          New collection
        </Button>
      </XStack>

      <DataTable
        columns={columns}
        rows={pageRows}
        loading={loading}
        rowKey={(c) => `${c.owner}/${c.name}`}
        empty="No collections match these filters."
      />

      {filtered.length > PAGE_SIZE ? (
        <XStack justify="flex-end" items="center" gap="$3">
          <Text fontSize="$2" color="$color11">
            {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </Text>
          <Button size="$2" disabled={safePage === 0} onPress={() => setPage((p) => Math.max(0, p - 1))}>
            Prev
          </Button>
          <Button size="$2" disabled={safePage >= pageCount - 1} onPress={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>
            Next
          </Button>
        </XStack>
      ) : null}
    </YStack>
  )
}
