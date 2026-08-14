'use client'

/**
 * Embeddings — generate, store, and search vector embeddings at scale.
 *
 * One product, six honest surfaces over the REAL `hanzoai/ai` `/v1` backend:
 *   Overview     the polished landing (hero + live metrics + interactive
 *                POST /v1/embeddings code samples + resources rail) over the shared
 *                ProductLanding kit, plus the real model mix + index health.
 *   Explore      top-K search over a collection (POST /v1/search).
 *   Collections  the org's knowledge stores (get-stores) as vector collections,
 *                each → the Qdrant/Search index `{owner}-{store}-docs`.
 *   Ingest       one surface, three real sources (text · GitHub repo · website) →
 *                POST /v1/docs/ingest; repos/crawls run as durable hanzoai/tasks
 *                workflows (tracked in Tasks), plus the store's real indexed files.
 *   Models       the gateway's embedding models (/v1/models) + generate (/v1/embeddings).
 *   Settings     org embedding defaults + the wiring this page depends on.
 *
 * Routing (tabs are unambiguous by segment count — see match-core):
 *   /embeddings                       → Overview
 *   /embeddings/<tab>                  → that tab
 *   /embeddings/collections/<name>     → edit one collection (reuses StoreEditView)
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug, subpageHref } from '~/lib/products/match'
import { useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import type { ComponentType } from 'react'
import {
  Boxes,
  Brain,
  LayoutDashboard,
  Plus,
  Search,
  Sparkles,
  SlidersHorizontal,
  Upload,
} from '@hanzogui/lucide-icons-2'

import { EmbeddingsApi } from '~/lib/api/embeddings'
import { ApiError } from '~/lib/api'
import { currentOrg } from '~/lib/org-scope'
import { StoreEditView } from './stores/StoreEditView'
import { newStore } from './stores/logic'
import { OverviewView } from './embeddings/OverviewView'
import { CollectionsView } from './embeddings/CollectionsView'
import { ExploreView } from './embeddings/ExploreView'
import { IngestView } from './embeddings/IngestView'
import { ModelsView } from './embeddings/ModelsView'
import { SettingsView } from './embeddings/SettingsView'
import { PageHeader, PrimaryButton } from '@hanzo/ui/product'

/** The tabs are DECLARED in the registry (`subpages`); this is only the union the
 *  module switches on. */
type Tab = '' | 'explore' | 'collections' | 'ingest' | 'models' | 'settings'

export function EmbeddingsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const owner = currentOrg()
  const [notice, setNotice] = useState<string | null>(null)

  // /embeddings/collections/<name> — edit one collection (the store editor).
  if (params.name) {
    return (
      <StoreEditView
        name={decodeURIComponent(params.name)}
        onDone={() => router.push('/embeddings/collections')}
      />
    )
  }

  const tab = productSubpageSlug('embeddings', params.tab) as Tab
  const go = (t: Tab) => router.push(subpageHref('embeddings', t))
  const openCollection = (name: string) => router.push(`/embeddings/collections/${encodeURIComponent(name)}`)

  // The ONE create path — used by the header action AND the Collections "New".
  const createCollection = async () => {
    setNotice(null)
    try {
      const s = newStore(owner)
      await EmbeddingsApi.addStore(s)
      openCollection(s.name)
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Failed to create collection')
    }
  }

  const Tabs: Record<Tab, ComponentType> = {
    '': () => (
      <OverviewView
        owner={owner}
        onOpenCollection={openCollection}
        onNew={createCollection}
        onExplore={() => go('explore')}
        onGenerate={() => go('models')}
      />
    ),
    explore: () => <ExploreView owner={owner} />,
    collections: () => <CollectionsView owner={owner} onOpen={openCollection} onNew={createCollection} />,
    ingest: () => <IngestView owner={owner} />,
    models: () => <ModelsView />,
    settings: () => <SettingsView owner={owner} />,
  }
  const Active = Tabs[tab]

  return (
    <YStack gap="$3">
      <PageHeader
        title="Embeddings"
        subtitle="Turn text into vectors, keep them in a collection, and search by meaning rather than by keyword."
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<Sparkles size={15} />} onPress={() => go('models')}>
              Generate embeddings
            </Button>
            <PrimaryButton size="$2" icon={<Plus size={15} />} onPress={() => void createCollection()}>
              Create collection
            </PrimaryButton>
          </XStack>
        }
      />

      <SubNav id="embeddings" />
      {notice ? (
        <Text fontSize="$2" color="$red10">
          {notice}
        </Text>
      ) : null}

      <Active />
    </YStack>
  )
}
