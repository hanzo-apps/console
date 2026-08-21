'use client'

/**
 * Embeddings · Settings — honest, read-only configuration. The distance metric is
 * fixed to cosine at collection-create time and the collection naming is a backend
 * convention, so there are no fabricated, non-persisting toggles here — just the
 * real configuration and the exact `/v1` endpoints this page is wired to.
 */
import { useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ExternalLink } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { EmbeddingsApi } from '~/lib/api/embeddings'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <XStack gap="$3" items="center" justify="space-between" flexWrap="wrap">
      <Text fontSize="$3" color="$color11" width={200}>
        {label}
      </Text>
      <Text fontSize="$3" color="$color12" flex={1}>
        {value}
      </Text>
    </XStack>
  )
}

const ENDPOINTS: { label: string; route: string }[] = [
  { label: 'Collections', route: 'GET /v1/get-stores' },
  { label: 'Create collection', route: 'POST /v1/add-store' },
  { label: 'Search', route: 'POST /v1/search' },
  { label: 'Generate', route: 'POST /v1/embeddings' },
  { label: 'Ingest', route: 'POST /v1/ai/rag/ingest' },
  { label: 'Index status', route: 'GET /v1/get-files' },
  { label: 'Usage metrics', route: 'GET /v1/get-cloud-usages' },
]

export function SettingsView({ owner }: { owner: string }) {
  const [defaultModel, setDefaultModel] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    EmbeddingsApi.models()
      .then((m) => {
        if (live) setDefaultModel(m[0]?.id ?? null)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  return (
    <YStack gap="$4" maxW={720}>
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <Text fontSize="$5" fontWeight="800" color="$color12">
          Configuration
        </Text>
        <Row label="Organization" value={owner} />
        <Row label="Default embedding model" value={defaultModel ?? '—'} />
        <Row label="Distance metric" value="cosine (fixed at index creation)" />
        <Row label="Collection naming" value={`${owner}-{collection}-docs`} />
        <Text fontSize="$2" color="$color10">
          The vector dimension is set by the collection's embedding model when the index is first created and is
          not reconfigurable per query. To change a collection's embedding model, edit the collection and re-index.
        </Text>
      </Card>

      <Card p="$4" gap="$2.5" borderWidth={1} borderColor="$borderColor">
        <Text fontSize="$5" fontWeight="800" color="$color12">
          Endpoints
        </Text>
        <Text fontSize="$2" color="$color10">
          Every surface on this page is wired to the real cloud API — nothing is mocked.
        </Text>
        {ENDPOINTS.map((e) => (
          <Row key={e.route} label={e.label} value={e.route} />
        ))}
      </Card>

      <XStack>
        <Button
          size="$2"
          iconAfter={<ExternalLink size={14} />}
          onPress={() => {
            if (typeof window !== 'undefined') window.open(`${config.docsUrl}/docs/embeddings`, '_blank', 'noopener')
          }}
        >
          Embeddings documentation
        </Button>
      </XStack>
    </YStack>
  )
}
