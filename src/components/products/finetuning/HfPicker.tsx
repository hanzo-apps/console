'use client'

/**
 * HuggingFace picker — browse/search Hub models or datasets and pick one. This is
 * the "HF-native" entry point: results come from the cloud broker's HF proxy
 * (`/training/hf/*`), which authenticates with a KMS-held token server-side, so
 * PRIVATE and gated repos appear for an org that configured a token — the browser
 * never sees the token. Picking a repo hands its id up; the actual weights/dataset
 * bytes are pulled in-cluster by the trainer's initializers at job time.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Search, Lock, Download, Heart, Check } from '@hanzogui/lucide-icons-2'

import { FinetuneApi, type HfModel, type HfDataset } from '~/lib/api/finetune'
import { FieldText } from '~/components/ui/Field'
import { humanCount, isGated, needsToken } from './logic'

type Row = { id: string; downloads?: number; likes?: number; private?: boolean; gated?: boolean | string; tag?: string }

function toRows(kind: 'model' | 'dataset', items: (HfModel | HfDataset)[]): Row[] {
  return items.map((it) => ({
    id: it.id,
    downloads: it.downloads,
    likes: it.likes,
    private: it.private,
    gated: it.gated,
    tag: kind === 'model' ? (it as HfModel).pipeline_tag : undefined,
  }))
}

export function HfPicker({
  kind,
  taskFilter,
  selected,
  initialQuery = '',
  ctaLabel = 'Use',
  onSelect,
}: {
  kind: 'model' | 'dataset'
  taskFilter?: string
  selected?: string
  initialQuery?: string
  ctaLabel?: string
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = useCallback(
    async (q: string) => {
      setLoading(true)
      setError(null)
      try {
        const items =
          kind === 'model'
            ? await FinetuneApi.searchModels(q, taskFilter, 24)
            : await FinetuneApi.searchDatasets(q, 24)
        setRows(toRows(kind, items))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed')
        setRows([])
      } finally {
        setLoading(false)
      }
    },
    [kind, taskFilter],
  )

  // Initial load: top repos (empty query returns most-downloaded).
  useEffect(() => {
    void search(initialQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  return (
    <YStack gap="$3">
      <XStack gap="$2" items="center">
        <YStack flex={1}>
          <FieldText
            value={query}
            onChange={setQuery}
            placeholder={kind === 'model' ? 'Search HuggingFace models (e.g. llama, qwen)…' : 'Search HuggingFace datasets…'}
          />
        </YStack>
        <Button icon={<Search size={16} />} onPress={() => void search(query)}>
          Search
        </Button>
      </XStack>

      {error ? (
        <Card borderWidth={1} borderColor="$borderColor" p="$3">
          <Text fontSize="$3" color="$red10">
            {error}
          </Text>
        </Card>
      ) : null}

      {loading ? (
        <XStack p="$5" justify="center">
          <Spinner size="large" color="$color11" />
        </XStack>
      ) : rows.length === 0 ? (
        <YStack p="$5" items="center" borderWidth={1} borderColor="$borderColor" rounded="$4">
          <Text color="$color11">No results. Try a different search.</Text>
        </YStack>
      ) : (
        <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
          {rows.map((r, i) => {
            const isSel = selected === r.id
            return (
              <XStack
                key={r.id}
                py="$2.5"
                px="$3"
                gap="$3"
                items="center"
                borderTopWidth={i === 0 ? 0 : 1}
                borderColor="$borderColor"
                bg={isSel ? '$color3' : undefined}
                hoverStyle={{ bg: '$color2' }}
              >
                <YStack flex={1} gap="$1">
                  <XStack gap="$2" items="center" flexWrap="wrap">
                    <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
                      {r.id}
                    </Text>
                    {needsToken(r) ? (
                      <XStack gap="$1" items="center">
                        <Lock size={11} color="$color10" />
                        <Text fontSize="$1" color="$color10">
                          {r.private ? 'private' : isGated(r.gated) ? 'gated' : ''}
                        </Text>
                      </XStack>
                    ) : null}
                  </XStack>
                  <XStack gap="$3" items="center">
                    {r.tag ? (
                      <Text fontSize="$1" color="$color10">
                        {r.tag}
                      </Text>
                    ) : null}
                    <XStack gap="$1" items="center">
                      <Download size={11} color="$color10" />
                      <Text fontSize="$1" color="$color10">
                        {humanCount(r.downloads)}
                      </Text>
                    </XStack>
                    <XStack gap="$1" items="center">
                      <Heart size={11} color="$color10" />
                      <Text fontSize="$1" color="$color10">
                        {humanCount(r.likes)}
                      </Text>
                    </XStack>
                  </XStack>
                </YStack>
                <Button
                  size="$2"
                  icon={isSel ? <Check size={14} /> : undefined}
                  bg={isSel ? '$color5' : undefined}
                  onPress={() => onSelect(r.id)}
                >
                  {isSel ? 'Selected' : ctaLabel}
                </Button>
              </XStack>
            )
          })}
        </YStack>
      )}
    </YStack>
  )
}
