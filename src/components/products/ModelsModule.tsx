'use client'

/**
 * Models — the AI model surface, catalog-first.
 *
 * The #1 "I don't see any models" trap was two near-identical nav items: "Models"
 * (route POLICY, empty until you add routes) and "Model Catalog" (the live, ~49
 * Zen models). The obvious click landed on the empty one. Fixed by MERGING: Models
 * opens the live Catalog by default, with route policy as a secondary "Routing" tab
 * — one product, the real models on the obvious click. The separate "Model Catalog"
 * nav entry is retired (its surface IS this default tab; one way, no duplicate).
 *
 * Routing:
 *   /models                  → Catalog (default — the live model list + pricing)
 *   /models/leaderboard      → Leaderboard (published benchmark corpus, ranked)
 *   /models/blend            → Blend (the org's enabled models + Enso tier preview)
 *   /models/routing          → Routing (model-route list)
 *   /models/routing/new      → create a route
 *   /models/routing/<name>   → edit a route
 *
 * The four tabs are one surface on purpose: they are the same question asked four
 * ways — what can I run (Catalog), what is any good (Leaderboard), what does MY org
 * run (Blend), and how is it routed (Routing, admin-only platform config).
 */
import { useRouter } from 'next/navigation'
import { Button, XStack, YStack } from '@hanzo/gui'
import { Boxes, Library, Trophy, Waypoints } from '@hanzogui/lucide-icons-2'
import type { ComponentType } from 'react'

import { ModelCatalogModule } from './ModelCatalogModule'
import { ModelRouteListView } from './models/ModelRouteListView'
import { ModelRouteEditView } from './models/ModelRouteEditView'
import { LeaderboardView } from './models/LeaderboardView'
import { BlendView } from './models/BlendView'

type Tab = 'catalog' | 'leaderboard' | 'blend' | 'routing'

const TABS: { tab: Tab; label: string; Icon: ComponentType<{ size?: number }>; path: string }[] = [
  { tab: 'catalog', label: 'Catalog', Icon: Library, path: '/models' },
  { tab: 'leaderboard', label: 'Leaderboard', Icon: Trophy, path: '/models/leaderboard' },
  { tab: 'blend', label: 'Blend', Icon: Boxes, path: '/models/blend' },
  { tab: 'routing', label: 'Routing', Icon: Waypoints, path: '/models/routing' },
]

/** The tab a `:tab` segment selects; anything unknown falls back to the catalog. */
function tabFor(seg: string | undefined): Tab {
  const hit = TABS.find((t) => t.tab === seg)
  return hit ? hit.tab : 'catalog'
}

function TabButton({
  active,
  label,
  Icon,
  onPress,
}: {
  active: boolean
  label: string
  Icon: ComponentType<{ size?: number }>
  onPress: () => void
}) {
  return (
    <Button
      size="$2"
      icon={<Icon size={15} />}
      bg={active ? '$color5' : 'transparent'}
      borderWidth={1}
      borderColor="$borderColor"
      onPress={onPress}
    >
      {label}
    </Button>
  )
}

export function ModelsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const name = params.name

  // /models/routing/<name|new> — edit or create a route.
  if (name !== undefined) {
    return (
      <ModelRouteEditView
        modelName={name === 'new' ? null : decodeURIComponent(name)}
        onDone={() => router.push('/models/routing')}
      />
    )
  }

  const tab: Tab = tabFor(params.tab)

  return (
    <YStack gap="$3">
      <XStack gap="$1.5" flexWrap="wrap">
        {TABS.map((t) => (
          <TabButton
            key={t.tab}
            active={tab === t.tab}
            label={t.label}
            Icon={t.Icon}
            onPress={() => router.push(t.path)}
          />
        ))}
      </XStack>

      {tab === 'catalog' ? (
        <ModelCatalogModule params={params} />
      ) : tab === 'leaderboard' ? (
        <LeaderboardView />
      ) : tab === 'blend' ? (
        <BlendView />
      ) : (
        <ModelRouteListView
          onOpen={(r) => router.push(`/models/routing/${encodeURIComponent(r.modelName ?? '')}`)}
          onNew={() => router.push('/models/routing/new')}
        />
      )}
    </YStack>
  )
}
