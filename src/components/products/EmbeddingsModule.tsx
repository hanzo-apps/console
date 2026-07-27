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
import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { PageHeader } from '@hanzo/ui/product'
import { PrimaryButton } from '@hanzo/ui/product'
import { StoreEditView } from './stores/StoreEditView'
import { newStore } from './stores/logic'
import { OverviewView } from './embeddings/OverviewView'
import { CollectionsView } from './embeddings/CollectionsView'
import { ExploreView } from './embeddings/ExploreView'
import { IngestView } from './embeddings/IngestView'
import { ModelsView } from './embeddings/ModelsView'
import { SettingsView } from './embeddings/SettingsView'

const TABS = [
  ['overview', 'Overview', LayoutDashboard],
  ['explore', 'Explore', Search],
  ['collections', 'Collections', Boxes],
  ['ingest', 'Ingest', Upload],
  ['models', 'Models', Brain],
  ['settings', 'Settings', SlidersHorizontal],
] as const

type Tab = (typeof TABS)[number][0]

function TabBar({ active, onSelect }: { active: Tab; onSelect: (t: Tab) => void }) {
  return (
    <XStack gap="$1.5" flexWrap="wrap">
      {TABS.map(([id, label, Icon]) => (
        <Button
          key={id}
          size="$2"
          icon={<Icon size={15} />}
          bg={active === id ? '$color5' : 'transparent'}
          borderWidth={1}
          borderColor="$borderColor"
          onPress={() => onSelect(id)}
        >
          {label}
        </Button>
      ))}
    </XStack>
  )
}

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

  const tab: Tab = (TABS.find(([id]) => id === params.tab)?.[0] ?? 'overview') as Tab
  const go = (t: Tab) => router.push(t === 'overview' ? '/embeddings' : `/embeddings/${t}`)
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
    overview: () => (
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
        subtitle="Generate, store, and search vector embeddings at scale."
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

      <TabBar active={tab} onSelect={go} />
      {notice ? (
        <Text fontSize="$2" color="$red10">
          {notice}
        </Text>
      ) : null}

      <Active />
    </YStack>
  )
}
