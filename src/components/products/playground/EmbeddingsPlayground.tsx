'use client'

/**
 * Embeddings tab — a real single-model embeddings run through the keyless `/ai`
 * proxy (`POST /v1/embeddings`). One input per line; the response shows each
 * vector's dimensionality + a preview, the token usage, and the latency. Honest
 * states throughout — nothing is fabricated when the endpoint is down.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Card, Separator, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Play, Binary, Clock, Layers } from '@hanzogui/lucide-icons-2'

import { PlaygroundApi, type EmbeddingsResponse } from '~/lib/api'
import { ModelSelect } from './ModelSelect'
import { useCatalog, defaultModels } from './useCatalog'
import { formatLatency, formatTokens } from './cost'
import { BackendStateCard, FieldRow, FieldTextArea, classifyBackend, type BackendState } from '@hanzo/ui/product'

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <YStack minW={120}>
      <Text fontSize="$1" color="$color10">
        {label}
      </Text>
      <Text fontSize="$3" color="$color12" fontWeight="600">
        {value}
      </Text>
    </YStack>
  )
}

export function EmbeddingsPlayground() {
  const catalog = useCatalog()
  const [model, setModel] = useState('')
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<BackendState | null>(null)
  const [res, setRes] = useState<EmbeddingsResponse | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)

  // Default to an embedding-named model if the catalog has one, else Zen/first.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || catalog.phase !== 'ready') return
    seeded.current = true
    const embed = catalog.ids.find((x) => /embed/i.test(x))
    setModel((m) => m || embed || defaultModels(catalog.ids, 1)[0] || '')
  }, [catalog.phase, catalog.ids])

  const run = async () => {
    const inputs = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!model.trim()) {
      setError({ kind: 'error', message: 'Choose a model.' })
      return
    }
    if (inputs.length === 0) {
      setError({ kind: 'error', message: 'Enter text to embed (one input per line).' })
      return
    }
    setRunning(true)
    setError(null)
    setRes(null)
    setLatencyMs(null)
    const start = now()
    try {
      const r = await PlaygroundApi.embeddings({ model: model.trim(), input: inputs.length === 1 ? inputs[0] : inputs })
      if (r.error?.message) setError({ kind: 'error', message: r.error.message })
      else {
        setRes(r)
        setLatencyMs(now() - start)
      }
    } catch (e) {
      setError(classifyBackend(e))
    } finally {
      setRunning(false)
    }
  }

  const vectors = res?.data ?? []
  const dims = vectors[0]?.embedding?.length ?? null

  return (
    <XStack gap="$4" flexWrap="wrap" items="flex-start">
      <YStack flex={1} minW={360} gap="$3">
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <FieldRow label="Model">
            <ModelSelect value={model} ids={catalog.ids} onChange={setModel} disabled={running} />
          </FieldRow>
          <FieldRow label="Input">
            <FieldTextArea value={text} onChange={setText} rows={8} />
          </FieldRow>
          <XStack justify="flex-end">
            <Button bg="$color5" icon={<Play size={16} />} disabled={running} onPress={() => void run()}>
              {running ? 'Embedding…' : 'Embed'}
            </Button>
          </XStack>
        </Card>
      </YStack>

      <YStack flex={1} minW={360} gap="$3">
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" minH={240}>
          <Text fontSize="$4" fontWeight="700">
            Vectors
          </Text>
          {running ? (
            <XStack gap="$2" items="center">
              <Spinner color="$color11" />
              <Text color="$color11">Embedding…</Text>
            </XStack>
          ) : error ? (
            <BackendStateCard state={error} onRetry={() => void run()} />
          ) : res ? (
            <YStack gap="$3">
              <XStack gap="$4" flexWrap="wrap">
                <Metric label="model" value={res.model ?? model} />
                <Metric label="vectors" value={String(vectors.length)} />
                <Metric label="dimensions" value={dims == null ? '—' : String(dims)} />
              </XStack>
              <Separator />
              <XStack gap="$4" flexWrap="wrap">
                <XStack gap="$1.5" items="center">
                  <Binary size={14} />
                  <Text fontSize="$2" color="$color11">
                    {formatTokens(res.usage?.prompt_tokens)} prompt · {formatTokens(res.usage?.total_tokens)} total tokens
                  </Text>
                </XStack>
                <XStack gap="$1.5" items="center">
                  <Clock size={14} />
                  <Text fontSize="$2" color="$color11">
                    {formatLatency(latencyMs)}
                  </Text>
                </XStack>
              </XStack>
              <Separator />
              <YStack gap="$2">
                {vectors.slice(0, 5).map((v, i) => (
                  <YStack key={i} gap="$1">
                    <XStack gap="$1.5" items="center">
                      <Layers size={13} />
                      <Text fontSize="$1" color="$color10">
                        vector {v.index ?? i} · {v.embedding?.length ?? 0} dims
                      </Text>
                    </XStack>
                    <Text fontSize="$2" color="$color11" numberOfLines={2}>
                      [{(v.embedding ?? []).slice(0, 8).map((n) => n.toFixed(4)).join(', ')}
                      {(v.embedding?.length ?? 0) > 8 ? ', …' : ''}]
                    </Text>
                  </YStack>
                ))}
                {vectors.length > 5 ? (
                  <Text fontSize="$1" color="$color10">
                    +{vectors.length - 5} more
                  </Text>
                ) : null}
              </YStack>
            </YStack>
          ) : (
            <Text fontSize="$3" color="$color10">
              Run to compute real embedding vectors. Nothing is shown until the gateway returns.
            </Text>
          )}
        </Card>
      </YStack>
    </XStack>
  )
}
