'use client'

/**
 * Embeddings · Explore — the embedding explorer over the REAL `POST /v1/search`.
 *
 * The search API takes the COLLECTION's own embedding config (not a query-time
 * model/dimension), plus `mode` (hybrid|vector|fulltext) and a top-K `limit`. So
 * the functional controls are Collection · Query · Mode · Top-K; the collection's
 * embedding model and its published dimension are shown read-only (honest — they
 * are not query-time choices). Hits carry no per-hit similarity score (the backend
 * RRF-merges and drops it), so the score reads "—" rather than a fabricated value.
 *
 * Vector-inspect: the API exposes no point-level vector lookup, so it is honest-
 * empty and points at the Models tab (the one place that generates a vector).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Search } from '@hanzogui/lucide-icons-2'

import { EmbeddingsApi, type EmbeddingHit, type SearchMode } from '~/lib/api/embeddings'
import { embeddingModelDimension, type Collection } from './logic'
import { BackendStateCard, FieldRow, FieldSelect, FieldSlider, FieldTextArea, PrimaryButton, classifyBackend, type BackendState } from '@hanzo/ui/product'

type Sub = 'search' | 'inspect'
type Results =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; hits: EmbeddingHit[] }

function SubTab({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Button size="$2" bg={active ? '$color5' : 'transparent'} borderWidth={1} borderColor="$borderColor" onPress={onPress}>
      {label}
    </Button>
  )
}

export function ExploreView({ owner }: { owner: string }) {
  const [sub, setSub] = useState<Sub>('search')
  const [collections, setCollections] = useState<Collection[]>([])
  const [store, setStore] = useState('')
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('hybrid')
  const [topK, setTopK] = useState(8)
  const [docs, setDocs] = useState<number | undefined>(undefined)
  const [results, setResults] = useState<Results>({ phase: 'idle' })

  useEffect(() => {
    let live = true
    EmbeddingsApi.collections(owner)
      .then((cols) => {
        if (!live) return
        setCollections(cols)
        setStore((cur) => cur || cols[0]?.name || '')
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [owner])

  // Best-effort indexed-doc count for the picked collection ("≈ vectors").
  useEffect(() => {
    if (!store) return
    let live = true
    setDocs(undefined)
    EmbeddingsApi.indexStats(store).then((s) => {
      if (live) setDocs(s.documentCount)
    })
    return () => {
      live = false
    }
  }, [store])

  const selected = useMemo(() => collections.find((c) => c.name === store), [collections, store])
  const dim = selected ? embeddingModelDimension(selected.model) : undefined

  const runSearch = useCallback(async () => {
    if (!store || !query.trim()) return
    setResults({ phase: 'loading' })
    try {
      const hits = await EmbeddingsApi.search({ store, query: query.trim(), topK, mode })
      setResults({ phase: 'ready', hits })
    } catch (e) {
      setResults({ phase: 'error', error: classifyBackend(e) })
    }
  }, [store, query, topK, mode])

  const names = collections.map((c) => c.name)

  return (
    <YStack gap="$3">
      <XStack gap="$1.5">
        <SubTab active={sub === 'search'} label="Search" onPress={() => setSub('search')} />
        <SubTab active={sub === 'inspect'} label="Vector-inspect" onPress={() => setSub('inspect')} />
      </XStack>

      {sub === 'inspect' ? (
        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={640}>
          <Text fontSize="$4" fontWeight="700">
            Vector-inspect
          </Text>
          <Text fontSize="$3" color="$color11">
            The search API exposes no point-level vector lookup, so there is nothing to fetch by id here. To
            generate and inspect the embedding vector for any text, use the Models tab — it calls
            POST /v1/embeddings and shows the dimension, token usage, and the vector.
          </Text>
        </Card>
      ) : (
        <XStack gap="$3" flexWrap="wrap" items="flex-start">
          {/* ── Search form ─────────────────────────────────────────────── */}
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" width={380} minW={320} flex={1}>
            <FieldRow label="Search in">
              {names.length ? (
                <YStack gap="$1">
                  <FieldSelect value={store} options={names} onChange={setStore} />
                  <Text fontSize="$1" color="$color10">
                    {docs != null ? `${docs.toLocaleString()} indexed documents` : 'vector count —'}
                    {selected ? ` · ${selected.collection}` : ''}
                  </Text>
                </YStack>
              ) : (
                <Text fontSize="$3" color="$color11">
                  No collections yet — create one first.
                </Text>
              )}
            </FieldRow>

            <FieldRow label="Query">
              <FieldTextArea value={query} onChange={setQuery} rows={4} />
            </FieldRow>

            <FieldRow label="Model">
              <Text fontSize="$3" color="$color11">
                {selected?.model || '—'}
              </Text>
            </FieldRow>
            <FieldRow label="Dimension">
              <Text fontSize="$3" color="$color11">
                {dim ?? '—'}
              </Text>
            </FieldRow>

            <FieldRow label="Mode">
              <FieldSelect value={mode} options={['hybrid', 'vector', 'fulltext']} onChange={(v) => setMode(v as SearchMode)} />
            </FieldRow>
            <FieldRow label="Top-K">
              <FieldSlider value={topK} min={1} max={25} step={1} onChange={setTopK} />
            </FieldRow>

            <PrimaryButton
              icon={<Search size={15} />}
              disabled={!store || !query.trim() || results.phase === 'loading'}
              onPress={() => void runSearch()}
            >
              Search
            </PrimaryButton>
          </Card>

          {/* ── Results ─────────────────────────────────────────────────── */}
          <YStack gap="$2" flex={1} minW={320}>
            {results.phase === 'idle' ? (
              <Card borderWidth={1} borderColor="$borderColor" borderStyle="dashed" p="$5" items="center">
                <Text fontSize="$3" color="$color11" text="center">
                  Enter a query and search to see the top-{topK} matching chunks.
                </Text>
              </Card>
            ) : results.phase === 'loading' ? (
              <XStack p="$6" justify="center">
                <Spinner size="large" color="$color11" />
              </XStack>
            ) : results.phase === 'error' ? (
              <BackendStateCard state={results.error} onRetry={() => void runSearch()} hint="endpoint · POST /v1/search" />
            ) : results.hits.length === 0 ? (
              <Card borderWidth={1} borderColor="$borderColor" p="$5" items="center">
                <Text fontSize="$3" color="$color11">
                  No matches for this query.
                </Text>
              </Card>
            ) : (
              results.hits.map((h) => (
                <Card key={h.id} p="$3.5" gap="$1.5" borderWidth={1} borderColor="$borderColor">
                  <XStack justify="space-between" gap="$3" items="flex-start">
                    <Text fontSize="$3" fontWeight="700" color="$color12" flex={1} numberOfLines={1}>
                      {h.title}
                    </Text>
                    <Text fontSize="$2" color="$color10">
                      score {h.score != null ? h.score.toFixed(3) : '—'}
                    </Text>
                  </XStack>
                  {h.path ? (
                    <Text fontSize="$1" color="$color10" numberOfLines={1}>
                      {h.path}
                    </Text>
                  ) : null}
                  <Text fontSize="$2" color="$color11" numberOfLines={3}>
                    {h.snippet}
                  </Text>
                </Card>
              ))
            )}
          </YStack>
        </XStack>
      )}
    </YStack>
  )
}
