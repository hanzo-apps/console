'use client'

/**
 * Prompts — versioned prompt management (ported from the old console's prompts
 * feature). The cloud gateway does not mount a `/v1/prompts` route yet (prompts
 * live in the console eval engine, reached today through the observability
 * surface and the prompt API), so this probes the forward-compatible endpoint:
 *   - On success it renders the REAL prompt list (name, version, type, labels).
 *   - On 404/405 it renders an honest card pointing at where prompts are managed
 *     today, and lights up automatically once the read route lands.
 * No prompts are ever fabricated.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, ExternalLink, FileText } from '@hanzogui/lucide-icons-2'

import { restGet, v1Url } from '~/lib/api/client'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'

const PROMPTS_SURFACE = 'https://insights.hanzo.ai'
const PROMPTS_DOCS = 'https://docs.hanzo.ai/prompts'

/** Prompt metadata (Langfuse prompt-meta shape; only surfaced fields typed). */
type PromptMeta = {
  name: string
  versions?: number[]
  type?: string
  labels?: string[]
  tags?: string[]
  lastUpdatedAt?: string
}

type State =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; rows: PromptMeta[] }

const fmtTime = (s?: string) => {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

const list = (xs?: string[]) => (xs && xs.length ? xs.join(', ') : '—')

const columns: Column<PromptMeta>[] = [
  { key: 'name', header: 'Name', render: (p) => (
    <Text fontSize="$3" fontWeight="600" numberOfLines={1}>{p.name}</Text>
  ) },
  { key: 'versions', header: 'Versions', width: 100, render: (p) => (
    <Text fontSize="$3" color="$color11">{p.versions?.length ?? '—'}</Text>
  ) },
  { key: 'type', header: 'Type', width: 90, render: (p) => (
    <Text fontSize="$3" color="$color11">{p.type || '—'}</Text>
  ) },
  { key: 'labels', header: 'Labels', render: (p) => (
    <Text fontSize="$3" color={p.labels?.length ? '$color11' : '$color10'} numberOfLines={1}>
      {list(p.labels)}
    </Text>
  ) },
  { key: 'lastUpdatedAt', header: 'Updated', width: 190, render: (p) => (
    <Text fontSize="$3" color="$color10">{fmtTime(p.lastUpdatedAt)}</Text>
  ) },
]

const openSurface = () => {
  if (typeof window !== 'undefined') window.open(PROMPTS_SURFACE, '_blank', 'noopener')
}

export function PromptsModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<State>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    restGet<{ data?: PromptMeta[] } | PromptMeta[]>(v1Url('prompts'))
      .then((res) => {
        const rows = Array.isArray(res) ? res : (res?.data ?? [])
        setState({ phase: 'ready', rows })
      })
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <>
      <PageHeader
        title="Prompts"
        subtitle="Versioned prompts with labels and history."
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Recheck
            </Button>
            <Button icon={<ExternalLink size={15} />} onPress={openSurface}>
              Open surface
            </Button>
          </XStack>
        }
      />

      {state.phase === 'error' ? (
        <YStack gap="$3">
          <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/prompts" />
          <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" bg="$color2" maxWidth={640}>
            <XStack gap="$2" items="center">
              <FileText size={18} />
              <Text fontSize="$4" fontWeight="700">Where prompts live today</Text>
            </XStack>
            <Text fontSize="$3" color="$color11">
              Prompt versions, labels, and history are managed in the observability surface and the
              prompt API until the in-console browser is wired to /v1/prompts. This page never shows
              placeholder prompts.
            </Text>
            <XStack gap="$2">
              <Button size="$2" iconAfter={<ExternalLink size={14} />} onPress={openSurface}>
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
          rows={state.phase === 'ready' ? state.rows : []}
          loading={state.phase === 'loading'}
          rowKey={(p) => p.name}
          empty="No prompts yet."
        />
      )}
    </>
  )
}
