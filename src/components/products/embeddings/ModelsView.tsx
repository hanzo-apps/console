'use client'

/**
 * Embeddings · Models — the gateway's embedding models (`GET /v1/models`, filtered
 * by id since the catalog carries no category), and a REAL generate panel over the
 * keyless `/ai` proxy (`POST /v1/embeddings`). The result shows the true vector
 * dimension, token usage, and a preview of the components — nothing fabricated;
 * gateway errors (402 add-credits, 401) surface verbatim.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, Sparkles } from '@hanzogui/lucide-icons-2'

import { EmbeddingsApi, type EmbeddingResult } from '~/lib/api/embeddings'
import { type CatalogModel, providerLabels } from '~/lib/api'
import { ErrorState, asApiError } from '~/components/ui/States'
import { embeddingModelDimension } from './logic'
import { DataTable, FieldRow, FieldSelect, FieldTextArea, PrimaryButton, type Column } from '@hanzo/ui/product'

const fmtPrice = (perM?: number): string => {
  if (perM == null) return '—'
  if (perM === 0) return 'Free'
  if (perM < 1) return `$${perM.toFixed(3)}`
  return `$${perM.toFixed(2)}`
}

type Load =
  | { phase: 'loading' }
  | { phase: 'error'; err: ReturnType<typeof asApiError> }
  | { phase: 'ready'; models: CatalogModel[] }

type Gen =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; dimension: number; tokens?: number; preview: number[] }

const columns: Column<CatalogModel>[] = [
  { key: 'id', header: 'Model', render: (m) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{m.id}</Text> },
  { key: 'owned_by', header: 'Provider', width: 170, render: (m) => <Text fontSize="$3" color="$color11">{providerLabels[m.owned_by] ?? m.owned_by}</Text> },
  {
    key: 'dimension',
    header: 'Dimension',
    width: 110,
    render: (m) => {
      const d = embeddingModelDimension(m.id)
      return <Text fontSize="$3" color="$color11">{d ?? '—'}</Text>
    },
  },
  { key: 'input', header: 'Price $/Mtok', width: 130, render: (m) => <Text fontSize="$3" color="$color11">{fmtPrice(m.pricing?.inputPerMillion)}</Text> },
]

export function ModelsView() {
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [model, setModel] = useState('')
  const [input, setInput] = useState('')
  const [gen, setGen] = useState<Gen>({ phase: 'idle' })

  const run = useCallback(() => {
    setLoad({ phase: 'loading' })
    EmbeddingsApi.models()
      .then((models) => {
        setLoad({ phase: 'ready', models })
        setModel((cur) => cur || models[0]?.id || '')
      })
      .catch((e) => setLoad({ phase: 'error', err: asApiError(e) }))
  }, [])

  useEffect(() => {
    run()
  }, [run])

  const models = load.phase === 'ready' ? load.models : []
  const modelIds = useMemo(() => models.map((m) => m.id), [models])

  const generate = async () => {
    if (!model || !input.trim()) return
    setGen({ phase: 'loading' })
    try {
      const r: EmbeddingResult = await EmbeddingsApi.generate(model, input.trim())
      if (r.error?.message) {
        setGen({ phase: 'error', message: r.error.message })
        return
      }
      const vec = r.data?.[0]?.embedding ?? []
      setGen({ phase: 'ready', dimension: vec.length, tokens: r.usage?.total_tokens, preview: vec.slice(0, 8) })
    } catch (e) {
      setGen({ phase: 'error', message: asApiError(e).message })
    }
  }

  return (
    <YStack gap="$4">
      {/* ── Generate ─────────────────────────────────────────────────────── */}
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack items="center" gap="$2">
          <Sparkles size={16} />
          <Text fontSize="$5" fontWeight="800" color="$color12">
            Generate embeddings
          </Text>
        </XStack>
        <FieldRow label="Model">
          {modelIds.length ? (
            <FieldSelect value={model} options={modelIds} onChange={setModel} />
          ) : (
            <Text fontSize="$3" color="$color11">No embedding models available on this deployment.</Text>
          )}
        </FieldRow>
        <FieldRow label="Input text">
          <FieldTextArea value={input} onChange={setInput} rows={3} />
        </FieldRow>
        <XStack gap="$3" items="center">
          <PrimaryButton
            icon={<Sparkles size={15} />}
            disabled={!model || !input.trim() || gen.phase === 'loading'}
            onPress={() => void generate()}
          >
            Generate
          </PrimaryButton>
          {gen.phase === 'ready' ? (
            <Text fontSize="$2" color="$color11">
              {gen.dimension}-dim vector{gen.tokens != null ? ` · ${gen.tokens} tokens` : ''}
            </Text>
          ) : gen.phase === 'error' ? (
            <Text fontSize="$2" color="$red10" numberOfLines={2}>
              {gen.message}
            </Text>
          ) : null}
        </XStack>
        {gen.phase === 'ready' && gen.preview.length ? (
          <YStack bg="$color2" p="$3" rounded="$3" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$1" color="$color10">
              [{gen.preview.map((n) => n.toFixed(4)).join(', ')}{gen.dimension > gen.preview.length ? ', …' : ''}]
            </Text>
          </YStack>
        ) : null}
      </Card>

      {/* ── Embedding models ─────────────────────────────────────────────── */}
      <YStack gap="$2">
        <XStack justify="space-between" items="center">
          <Text fontSize="$5" fontWeight="800" color="$color12">
            Embedding models
          </Text>
          <Button size="$2" icon={<RefreshCw size={15} />} onPress={run}>
            Refresh
          </Button>
        </XStack>
        {load.phase === 'error' ? (
          <ErrorState
            err={load.err}
            onRetry={run}
            copy={{ notFound: 'The model catalog (/v1/models) is not routed on this host yet. Embedding models appear once it is.' }}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={models}
            loading={load.phase === 'loading'}
            rowKey={(m) => m.id}
            empty="No embedding models exposed by the gateway on this deployment."
          />
        )}
      </YStack>
    </YStack>
  )
}
