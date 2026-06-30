'use client'

/**
 * Embeddings · Jobs — ingest/index activity. The backend runs ingest synchronously
 * (no async job entity), so the real surface is per-file index status from
 * `GET /v1/get-files` (Pending · Processing · Finished · Error). The ingest panel
 * runs a REAL upload ingest (`POST /v1/docs/ingest`, source=upload — the balance-
 * free path) and shows the returned `IngestStats`. No fabricated job log.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ListChecks, Upload } from '@hanzogui/lucide-icons-2'

import { EmbeddingsApi, type FileRow, type IngestStats } from '~/lib/api/embeddings'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { EmptyState } from '~/components/ui/EmptyState'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { FieldRow, FieldSelect, FieldText, FieldTextArea } from '~/components/ui/Field'
import type { Collection } from './logic'

const fmtDate = (s?: string) => {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

const statusTone = (s?: string): '$green10' | '$yellow10' | '$red10' | '$color11' => {
  const v = (s ?? '').toLowerCase()
  if (v === 'finished') return '$green10'
  if (v === 'processing' || v === 'pending') return '$yellow10'
  if (v === 'error') return '$red10'
  return '$color11'
}

type Ingest =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; stats: IngestStats }

export function JobsView({ owner }: { owner: string }) {
  const [files, setFiles] = useState<FileRow[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)

  const [store, setStore] = useState('')
  const [docName, setDocName] = useState('note.md')
  const [content, setContent] = useState('')
  const [ingest, setIngest] = useState<Ingest>({ phase: 'idle' })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [f, cols] = await Promise.all([EmbeddingsApi.files(owner), EmbeddingsApi.collections(owner)])
      setFiles(f)
      setCollections(cols)
      setStore((cur) => cur || cols[0]?.name || '')
    } catch (e) {
      setError(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [owner])

  useEffect(() => {
    void load()
  }, [load])

  const runIngest = async () => {
    if (!store || !content.trim()) return
    setIngest({ phase: 'loading' })
    try {
      const stats = await EmbeddingsApi.ingestText(store, docName.trim() || 'note.md', content.trim())
      setIngest({ phase: 'ready', stats })
      setContent('')
      void load()
    } catch (e) {
      setIngest({ phase: 'error', message: e instanceof Error ? e.message : 'Ingest failed' })
    }
  }

  const columns: Column<FileRow>[] = [
    { key: 'name', header: 'FILE', render: (f) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{f.name || '—'}</Text> },
    { key: 'store', header: 'COLLECTION', width: 160, render: (f) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{f.store || '—'}</Text> },
    {
      key: 'status',
      header: 'STATUS',
      width: 120,
      render: (f) => (
        <XStack items="center" gap="$1.5">
          <YStack width={7} height={7} rounded="$10" bg={statusTone(f.status)} />
          <Text fontSize="$2" color="$color11">{f.status || '—'}</Text>
        </XStack>
      ),
    },
    { key: 'tokenCount', header: 'TOKENS', width: 90, render: (f) => <Text fontSize="$3" color="$color11">{f.tokenCount != null ? f.tokenCount.toLocaleString() : '—'}</Text> },
    { key: 'createdTime', header: 'CREATED', width: 170, render: (f) => <Text fontSize="$3" color="$color11">{fmtDate(f.createdTime)}</Text> },
  ]

  const names = collections.map((c) => c.name)

  return (
    <YStack gap="$4">
      {/* ── Ingest documents (real upload ingest) ────────────────────────── */}
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack items="center" gap="$2">
          <Upload size={16} />
          <Text fontSize="$5" fontWeight="800" color="$color12">
            Ingest a document
          </Text>
        </XStack>
        <Text fontSize="$2" color="$color10">
          Ingest runs synchronously — the file is chunked, embedded, and indexed into the collection on submit.
          External sources (GitHub, crawl, S3) run through the same /v1/docs/ingest endpoint from the CLI/API.
        </Text>
        <FieldRow label="Into collection">
          {names.length ? (
            <FieldSelect value={store} options={names} onChange={setStore} />
          ) : (
            <Text fontSize="$3" color="$color11">Create a collection first.</Text>
          )}
        </FieldRow>
        <FieldRow label="Document name">
          <FieldText value={docName} onChange={setDocName} placeholder="note.md" />
        </FieldRow>
        <FieldRow label="Content">
          <FieldTextArea value={content} onChange={setContent} rows={4} />
        </FieldRow>
        <XStack gap="$3" items="center">
          <PrimaryButton
            icon={<Upload size={15} />}
            disabled={!store || !content.trim() || ingest.phase === 'loading'}
            onPress={() => void runIngest()}
          >
            Ingest
          </PrimaryButton>
          {ingest.phase === 'ready' ? (
            <Text fontSize="$2" color="$color11">
              {ingest.stats.documentsIndexed ?? 0} chunks indexed into {ingest.stats.store || store}
            </Text>
          ) : ingest.phase === 'error' ? (
            <Text fontSize="$2" color="$red10" numberOfLines={2}>
              {ingest.message}
            </Text>
          ) : null}
        </XStack>
      </Card>

      {/* ── File index status ────────────────────────────────────────────── */}
      <YStack gap="$2">
        <Text fontSize="$5" fontWeight="800" color="$color12">
          Index status
        </Text>
        {error ? (
          <BackendStateCard state={error} onRetry={() => void load()} hint="endpoint · GET /v1/get-files" />
        ) : !loading && files.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No files indexed yet"
            description="Once you ingest documents into a collection, each file's chunk/embed/index status appears here — Pending, Processing, Finished, or Error."
            bullets={['Ingest a document above, or from the hanzo CLI', 'Status updates as the file is chunked and embedded']}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={files}
            loading={loading}
            rowKey={(f) => `${f.owner}/${f.store ?? ''}/${f.name}`}
            empty="No indexed files yet."
          />
        )}
      </YStack>
    </YStack>
  )
}
