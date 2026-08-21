'use client'

/**
 * Edge — the network in front of every published site: which provider fronts it,
 * whether it can act, what it caches and for how long.
 *
 * Reads `GET /v1/projects/edge` through the same-origin `/v1` bearer BFF. `edge` names a
 * POSITION rather than a product, so it has no root of its own — the app that holds the
 * edge answers for it. The read is a STATE, not an inventory: this module used to ask for
 * a node list, an address nothing ever served, so the table of nodes is gone and what the
 * edge actually reports is shown instead.
 *
 * A 503 says a publish is not reaching readers promptly — a true statement about the
 * product, not a broken read — so it renders as "no edge yet", and only a genuine
 * transport failure gets the retry card.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, Radio } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { originV1Url, restGet } from '~/lib/api/client'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'
import { EmptyState, PageHeader, StatusTag } from '@hanzo/ui/product'

/** What `GET /v1/projects/edge` answers, on 200 and on 503 alike. */
type Edge = {
  provider?: string
  status?: string
  configured?: boolean
  freshness?: string
  reach?: string[]
  policy?: Record<string, string>
  error?: string
}

export function EdgeModule(_props: { params: Record<string, string> }) {
  const [edge, setEdge] = useState<Edge | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setEdge(await restGet<Edge>(originV1Url('projects/edge')))
      setLoadError(null)
    } catch (e) {
      setEdge(null)
      setLoadError(interpretPlatformError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const row = (label: string, value: string) => (
    <XStack key={label} py="$2" gap="$4" justify="space-between">
      <Text fontSize="$3" color="$color11">{label}</Text>
      <Text fontSize="$3" color="$color12" numberOfLines={1}>{value}</Text>
    </XStack>
  )

  return (
    <>
      <PageHeader
        title="Edge"
        subtitle="The network in front of every published site."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
        }
      />

      {loading ? (
        <XStack p="$6" justify="center">
          <Spinner size="large" color="$color11" />
        </XStack>
      ) : loadError && loadError.kind === 'error' ? (
        <PlatformStateCard error={loadError} onRetry={() => void load()} />
      ) : edge && edge.configured ? (
        <YStack>
          <XStack py="$2" gap="$4" justify="space-between" items="center">
            <Text fontSize="$3" color="$color11">Status</Text>
            <StatusTag status={edge.status ?? 'unknown'} />
          </XStack>
          {row('Provider', edge.provider || '—')}
          {row('Freshness', edge.freshness || '—')}
          {row('Reach', edge.reach?.length ? edge.reach.join(' · ') : '—')}
          {Object.entries(edge.policy ?? {}).map(([kind, cacheControl]) => row(`Cache · ${kind}`, cacheControl))}
          {edge.error ? row('Blocked by', edge.error) : null}
        </YStack>
      ) : (
        <EmptyState
          icon={Radio}
          title="No edge in front of your sites yet"
          description={
            edge?.error ||
            'The edge purges a publish so readers see it immediately. Until one holds credentials, a publish is live as soon as caches expire on their own.'
          }
          bullets={[
            'A publish is invalidated by cache-tag, on every apex it is served from',
            'Documents revalidate; fingerprinted assets are immutable',
          ]}
          primary={{ label: 'Edge docs', href: `${config.docsUrl}/docs/edge` }}
        />
      )}
    </>
  )
}
