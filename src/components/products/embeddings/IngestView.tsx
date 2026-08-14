'use client'

/**
 * Embeddings · Ingest — the ONE ingest surface for a knowledge store. There is NO
 * bespoke "jobs" system: a short source (pasted text / upload) indexes inline; a long
 * source (GitHub repo, web crawl) is enqueued as a durable hanzoai/tasks workflow (the
 * one async system) and tracked in the Tasks product by its workflow id. The lower
 * panel is the store's REAL indexed files (`GET /v1/get-files`) — what's actually in
 * the collection, not a fabricated job log.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Card, Text, XStack, YStack } from '@hanzo/gui'
import { FileStack, Github, Globe, Upload } from '@hanzogui/lucide-icons-2'

import { EmbeddingsApi, type FileRow, type IngestStats } from '~/lib/api/embeddings'
import type { Collection } from './logic'
import { BackendStateCard, DataTable, EmptyState, FieldRow, FieldSelect, FieldText, FieldTextArea, PrimaryButton, classifyBackend, type BackendState, type Column } from '@hanzo/ui/product'

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

/** The three real ingest sources the UI drives (s3 stays CLI/API — no console form yet). */
type Source = 'upload' | 'github' | 'crawl'
const SOURCES: [Source, string, typeof Upload][] = [
  ['upload', 'Text', Upload],
  ['github', 'GitHub repo', Github],
  ['crawl', 'Website', Globe],
]

type Ingest =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; stats: IngestStats }

export function IngestView({ owner }: { owner: string }) {
  const router = useRouter()
  const [files, setFiles] = useState<FileRow[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)

  const [store, setStore] = useState('')
  const [source, setSource] = useState<Source>('upload')
  const [docName, setDocName] = useState('note.md')
  const [content, setContent] = useState('')
  const [repo, setRepo] = useState('')
  const [ref, setRef] = useState('')
  const [url, setUrl] = useState('')
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

  // Valid when the active source's required input is present.
  const canIngest =
    !!store &&
    ((source === 'upload' && !!content.trim()) ||
      (source === 'github' && !!repo.trim()) ||
      (source === 'crawl' && !!url.trim()))

  const runIngest = async () => {
    if (!canIngest) return
    setIngest({ phase: 'loading' })
    try {
      // One trigger, three real sources → the ONE /v1/docs/ingest endpoint. github/crawl
      // return a durable tasks workflow id (async); upload indexes inline. No bespoke job.
      const stats =
        source === 'github'
          ? await EmbeddingsApi.ingestGitHub(store, repo.trim(), ref.trim() || undefined)
          : source === 'crawl'
            ? await EmbeddingsApi.ingestCrawl(store, url.trim())
            : await EmbeddingsApi.ingestText(store, docName.trim() || 'note.md', content.trim())
      setIngest({ phase: 'ready', stats })
      if (source !== 'github') setContent('')
      void load()
    } catch (e) {
      setIngest({ phase: 'error', message: e instanceof Error ? e.message : 'Ingest failed' })
    }
  }

  const columns: Column<FileRow>[] = [
    { key: 'name', header: 'File', render: (f) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{f.name || '—'}</Text> },
    { key: 'store', header: 'Collection', width: 160, render: (f) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{f.store || '—'}</Text> },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (f) => (
        <XStack items="center" gap="$1.5">
          <YStack width={7} height={7} rounded="$10" bg={statusTone(f.status)} />
          <Text fontSize="$2" color="$color11">{f.status || '—'}</Text>
        </XStack>
      ),
    },
    { key: 'tokenCount', header: 'Tokens', width: 90, render: (f) => <Text fontSize="$3" color="$color11">{f.tokenCount != null ? f.tokenCount.toLocaleString() : '—'}</Text> },
    { key: 'createdTime', header: 'Created', width: 170, render: (f) => <Text fontSize="$3" color="$color11">{fmtDate(f.createdTime)}</Text> },
  ]

  const names = collections.map((c) => c.name)

  return (
    <YStack gap="$4">
      {/* ── Ingest documents (upload inline · github/crawl → durable task) ──── */}
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack items="center" gap="$2">
          <Upload size={16} />
          <Text fontSize="$5" fontWeight="800" color="$color12">
            Ingest into a collection
          </Text>
        </XStack>
        <Text fontSize="$2" color="$color10">
          Documents are parsed, chunked (code-aware for source files — whole functions per chunk),
          embedded, and indexed for semantic + keyword search. A repo or crawl runs as a durable
          task you can track in Tasks; pasted text indexes immediately.
        </Text>

        {/* Source selector — one row of tabs (Text · GitHub repo · Website). */}
        <XStack gap="$2" flexWrap="wrap">
          {SOURCES.map(([id, label, Icon]) => {
            const active = source === id
            return (
              <XStack
                key={id}
                items="center"
                gap="$1.5"
                px="$3"
                py="$2"
                rounded="$4"
                borderWidth={1}
                borderColor={active ? '$color8' : '$borderColor'}
                bg={active ? '$color4' : 'transparent'}
                cursor="pointer"
                hoverStyle={{ bg: '$color3' }}
                onPress={() => setSource(id)}
              >
                <Icon size={14} />
                <Text fontSize="$3" fontWeight={active ? '700' : '500'} color={active ? '$color12' : '$color11'}>
                  {label}
                </Text>
              </XStack>
            )
          })}
        </XStack>

        <FieldRow label="Into collection">
          {names.length ? (
            <FieldSelect value={store} options={names} onChange={setStore} />
          ) : (
            <Text fontSize="$3" color="$color11">Create a collection first.</Text>
          )}
        </FieldRow>

        {/* Source-specific inputs. */}
        {source === 'upload' ? (
          <>
            <FieldRow label="Document name">
              <FieldText value={docName} onChange={setDocName} placeholder="note.md" />
            </FieldRow>
            <FieldRow label="Content">
              <FieldTextArea value={content} onChange={setContent} rows={4} />
            </FieldRow>
          </>
        ) : source === 'github' ? (
          <>
            <FieldRow label="Repository">
              <FieldText value={repo} onChange={setRepo} placeholder="owner/name" />
            </FieldRow>
            <FieldRow label="Branch / tag / SHA">
              <FieldText value={ref} onChange={setRef} placeholder="default branch" />
            </FieldRow>
          </>
        ) : (
          <FieldRow label="URL">
            <FieldText value={url} onChange={setUrl} placeholder="https://docs.example.com" />
          </FieldRow>
        )}

        <XStack gap="$3" items="center" flexWrap="wrap">
          <PrimaryButton
            icon={<Upload size={15} />}
            disabled={!canIngest || ingest.phase === 'loading'}
            onPress={() => void runIngest()}
          >
            {source === 'upload' ? 'Ingest' : 'Start ingest'}
          </PrimaryButton>
          {ingest.phase === 'ready' ? (
            ingest.stats.async && ingest.stats.workflowId ? (
              // Durable workflow — the honest async surface is the ONE Tasks product.
              <XStack items="center" gap="$2" flexWrap="wrap">
                <Text fontSize="$2" color="$color11">
                  Indexing started as a durable task.
                </Text>
                <Text
                  fontSize="$2"
                  color="$color11"
                  cursor="pointer"
                  hoverStyle={{ color: '$color12' }}
                  onPress={() => router.push(`/tasks/${encodeURIComponent(owner)}/${encodeURIComponent(ingest.stats.workflowId!)}`)}
                >
                  Track in Tasks →
                </Text>
              </XStack>
            ) : (
              <Text fontSize="$2" color="$color11">
                {ingest.stats.documentsIndexed ?? 0} chunks indexed into {ingest.stats.store || store}
              </Text>
            )
          ) : ingest.phase === 'error' ? (
            <Text fontSize="$2" color="$red10" numberOfLines={2}>
              {ingest.message}
            </Text>
          ) : null}
        </XStack>
      </Card>

      {/* ── Indexed files (real collection contents from GET /v1/get-files) ─── */}
      <YStack gap="$2">
        <Text fontSize="$5" fontWeight="800" color="$color12">
          Indexed files
        </Text>
        {error ? (
          <BackendStateCard state={error} onRetry={() => void load()} hint="endpoint · GET /v1/get-files" />
        ) : !loading && files.length === 0 ? (
          <EmptyState
            icon={FileStack}
            title="No files indexed yet"
            description="Ingest text, a GitHub repo, or a website above. Each indexed file appears here with its chunk/embed status — Pending, Processing, Finished, or Error."
            bullets={['Repos and crawls run as durable tasks — track them in Tasks', 'Status updates as each file is chunked and embedded']}
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
