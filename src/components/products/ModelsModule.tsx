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
 *
 * Those four are DECLARED in the registry (`indexLabel: 'Catalog'` + three
 * sub-pages), not here — the sidebar's drill-down and `SubNav` render the same
 * declaration, and `productSubpageSlug` validates the URL against it. This module
 * only decides what each tab SHOWS.
 */
import { useRouter } from '~/lib/router'
import { YStack } from '@hanzo/gui'

import { productSubpageSlug } from '~/lib/products/match'
import { SubNav } from '~/components/ui/SubNav'
import { ModelCatalogModule } from './ModelCatalogModule'
import { ModelRouteListView } from './models/ModelRouteListView'
import { ModelRouteEditView } from './models/ModelRouteEditView'
import { LeaderboardView } from './models/LeaderboardView'
import { BlendView } from './models/BlendView'

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

  // Level 2 is the URL, validated against the ONE registry declaration.
  const tab = productSubpageSlug('models', params.tab)

  return (
    <YStack gap="$3">
      <SubNav id="models" />

      {tab === 'leaderboard' ? (
        <LeaderboardView />
      ) : tab === 'blend' ? (
        <BlendView />
      ) : tab === 'routing' ? (
        <ModelRouteListView
          onOpen={(r) => router.push(`/models/routing/${encodeURIComponent(r.modelName ?? '')}`)}
          onNew={() => router.push('/models/routing/new')}
        />
      ) : (
        <ModelCatalogModule params={params} />
      )}
    </YStack>
  )
}
