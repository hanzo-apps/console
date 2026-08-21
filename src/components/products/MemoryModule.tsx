'use client'

/**
 * Memory — the user's personal memory, unified into the console.
 *
 * List + search (kind filter + text query) at `/memory`; one memory's detail +
 * edit at `/memory/<id>` (the `:id` route param selects the view, like
 * ProvidersModule). Reads/writes the per-user `/v1/ai/memory` backend through
 * MemoryApi; tenancy is server-side, so the browser sends cookie credentials
 * only. Until that Go backend deploys the routes 404 and we render an honest
 * "initializing" state — never fabricated memories. Mutations report through the
 * shared toast.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import { Plus, Trash, Search, ArrowLeft, Save, RefreshCw } from '@hanzogui/lucide-icons-2'

import { MemoryApi, MEMORY_KINDS, type Memory, type MemoryKind } from '~/lib/api'
import { useToast } from '~/components/ui/Toast'
import { BackendStateCard, DataTable, FieldRow, FieldSelect, FieldTextArea, PageHeader, classifyBackend, type BackendState, type Column } from '@hanzo/ui/product'

/** Per-kind tone, so every memory list reads the same. */
const KIND_TONE: Record<MemoryKind, { bg: '$color5' | '$color4' | '$color3'; fg: '$color12' | '$color11' }> = {
  user: { bg: '$color5', fg: '$color12' },
  feedback: { bg: '$color4', fg: '$color12' },
  project: { bg: '$color5', fg: '$color12' },
  reference: { bg: '$color3', fg: '$color11' },
  fact: { bg: '$color4', fg: '$color12' },
}

function KindBadge({ kind }: { kind: MemoryKind }) {
  const tone = KIND_TONE[kind] ?? { bg: '$color3' as const, fg: '$color11' as const }
  return (
    <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg={tone.bg} color={tone.fg}>
      {kind}
    </Text>
  )
}

const fmtDate = (v?: string): string => {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

/** The honest "backend not ready" card, with memory-specific guidance. */
function NotReady({ state, onRetry }: { state: BackendState; onRetry: () => void }) {
  return (
    <BackendStateCard
      state={state}
      onRetry={onRetry}
      hint="The per-user memory backend (/v1/ai/memory) is being deployed. Your memories — what you've told the assistant to remember — appear here automatically once it is live."
    />
  )
}

// ── List + search + add ───────────────────────────────────────────────────

const KIND_OPTIONS = ['all', ...MEMORY_KINDS] as const

function MemoryListView({ onOpen }: { onOpen: (m: Memory) => void }) {
  const toast = useToast()

  const [rows, setRows] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<BackendState | null>(null)

  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<(typeof KIND_OPTIONS)[number]>('all')

  // Add form.
  const [draftKind, setDraftKind] = useState<MemoryKind>('user')
  const [draftContent, setDraftContent] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const k = kind === 'all' ? undefined : kind
    try {
      const data = query.trim() ? await MemoryApi.search(query.trim(), k) : await MemoryApi.list(k)
      setRows(data)
      setState(null)
    } catch (e) {
      setState(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [query, kind])

  useEffect(() => {
    void load()
  }, [load])

  const onCreate = async () => {
    const content = draftContent.trim()
    if (!content) return
    setSaving(true)
    try {
      await MemoryApi.remember({ kind: draftKind, content })
      toast.success('Remembered', 'Your memory was stored.')
      setDraftContent('')
      await load()
    } catch (e) {
      const s = classifyBackend(e)
      toast.error('Could not save memory', s.message)
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (m: Memory) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this memory?')) return
    try {
      await MemoryApi.remove(m.id)
      setRows((rs) => rs.filter((r) => r.id !== m.id))
      toast.success('Deleted')
    } catch (e) {
      toast.error('Could not delete that memory', classifyBackend(e).message)
    }
  }

  const columns: Column<Memory>[] = [
    {
      key: 'content',
      header: 'Memory',
      render: (m) => (
        <Text fontSize="$3" color="$color12" numberOfLines={2} onPress={() => onOpen(m)} cursor="pointer">
          {m.content}
        </Text>
      ),
    },
    { key: 'kind', header: 'Kind', width: 120, render: (m) => <KindBadge kind={m.kind} /> },
    {
      key: 'createdAt',
      header: 'Created',
      width: 190,
      render: (m) => (
        <Text fontSize="$3" color="$color11">
          {fmtDate(m.createdAt)}
        </Text>
      ),
    },
    {
      key: 'action',
      header: '',
      width: 110,
      render: (m) => (
        <XStack gap="$2" justify="flex-end" flex={1}>
          <Button size="$2" onPress={() => onOpen(m)}>
            Open memory
          </Button>
          <Button size="$2" icon={<Trash size={14} />} onPress={() => void onDelete(m)} />
        </XStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Memory"
        subtitle="Everything you've asked the assistant to remember — searchable, in one place."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
        }
      />

      {state ? (
        <NotReady state={state} onRetry={() => void load()} />
      ) : (
        <>
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$5" fontWeight="700">
              Remember something
            </Text>
            <FieldRow label="Kind">
              <FieldSelect
                value={draftKind}
                options={[...MEMORY_KINDS]}
                onChange={(v) => setDraftKind(v as MemoryKind)}
              />
            </FieldRow>
            <FieldRow label="Content">
              <FieldTextArea value={draftContent} onChange={setDraftContent} rows={3} />
            </FieldRow>
            <XStack>
              <Button
                theme="light"
                icon={<Plus size={16} />}
                disabled={saving || !draftContent.trim()}
                onPress={() => void onCreate()}
              >
                {saving ? 'Saving…' : 'Remember'}
              </Button>
            </XStack>
          </Card>

          <XStack gap="$2" items="center" flexWrap="wrap">
            <XStack flex={1} minW={240} items="center" gap="$2">
              <Input
                flex={1}
                value={query}
                onChangeText={setQuery}
                placeholder="Search memories…"
                autoCapitalize="none"
                onSubmitEditing={() => void load()}
              />
              <Button icon={<Search size={16} />} onPress={() => void load()}>
                Search
              </Button>
            </XStack>
            <XStack width={220}>
              <FieldSelect
                value={kind}
                options={[...KIND_OPTIONS]}
                onChange={(v) => setKind(v as (typeof KIND_OPTIONS)[number])}
              />
            </XStack>
          </XStack>

          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(m) => m.id}
            empty={query.trim() ? 'No memories match your search.' : 'No memories yet. Add one above.'}
          />
        </>
      )}
    </>
  )
}

// ── Detail + edit ─────────────────────────────────────────────────────────

function MemoryDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const toast = useToast()
  const [memory, setMemory] = useState<Memory | null>(null)
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<BackendState | null>(null)
  const [notFound, setNotFound] = useState(false)

  const [kind, setKind] = useState<MemoryKind>('user')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  // No GET-by-id route in the contract; the per-user list is small, so resolve
  // the one memory from it. Honest "not found" when it isn't there.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const all = await MemoryApi.list()
      const found = all.find((m) => m.id === id) ?? null
      setMemory(found)
      setNotFound(!found)
      if (found) {
        setKind(found.kind)
        setContent(found.content)
      }
      setState(null)
    } catch (e) {
      setState(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const onSave = async () => {
    if (!content.trim()) return
    setSaving(true)
    try {
      await MemoryApi.update({ id, kind, content: content.trim() })
      toast.success('Saved')
      await load()
    } catch (e) {
      toast.error('Could not save this memory', classifyBackend(e).message)
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this memory?')) return
    try {
      await MemoryApi.remove(id)
      toast.success('Deleted')
      onBack()
    } catch (e) {
      toast.error('Could not delete this memory', classifyBackend(e).message)
    }
  }

  return (
    <>
      <PageHeader
        title="Memory"
        subtitle="View and edit one memory."
        actions={
          <Button icon={<ArrowLeft size={16} />} onPress={onBack}>
            Back
          </Button>
        }
      />

      {state ? (
        <NotReady state={state} onRetry={() => void load()} />
      ) : loading ? (
        <Text color="$color11">Loading…</Text>
      ) : notFound ? (
        <Card p="$4" borderWidth={1} borderColor="$borderColor">
          <Text color="$color11">This memory no longer exists.</Text>
        </Card>
      ) : memory ? (
        <>
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
            <FieldRow label="Kind">
              <FieldSelect value={kind} options={[...MEMORY_KINDS]} onChange={(v) => setKind(v as MemoryKind)} />
            </FieldRow>
            <FieldRow label="Content">
              <FieldTextArea value={content} onChange={setContent} rows={6} />
            </FieldRow>
            {memory.createdAt ? (
              <FieldRow label="Created">
                <Text fontSize="$3" color="$color11" pt="$2">
                  {fmtDate(memory.createdAt)}
                </Text>
              </FieldRow>
            ) : null}
            <XStack gap="$2">
              <Button
                theme="light"
                icon={<Save size={16} />}
                disabled={saving || !content.trim()}
                onPress={() => void onSave()}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button theme="red" icon={<Trash size={16} />} onPress={() => void onDelete()}>
                Delete memory
              </Button>
            </XStack>
          </Card>

          {memory.metadata && Object.keys(memory.metadata).length > 0 ? (
            <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
              <Text fontSize="$5" fontWeight="700">
                Metadata
              </Text>
              <Text
                fontSize="$2"
                color="$color11"
                px="$3"
                py="$2"
                bg="$color2"
                rounded="$3"
                borderWidth={1}
                borderColor="$borderColor"
              >
                {JSON.stringify(memory.metadata, null, 2)}
              </Text>
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  )
}

export function MemoryModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const id = params.id
  if (id) {
    return <MemoryDetailView id={decodeURIComponent(id)} onBack={() => router.push('/memory')} />
  }
  return <MemoryListView onOpen={(m) => router.push(`/memory/${encodeURIComponent(m.id)}`)} />
}
