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
 *   /models/routing          → Routing (model-route list)
 *   /models/routing/new      → create a route
 *   /models/routing/<name>   → edit a route
 */
import { useRouter } from 'next/navigation'
import { Button, XStack, YStack } from '@hanzo/gui'
import { Library, Waypoints } from '@hanzogui/lucide-icons-2'
import type { ComponentType } from 'react'

import { ModelCatalogModule } from './ModelCatalogModule'
import { ModelRouteListView } from './models/ModelRouteListView'
import { ModelRouteEditView } from './models/ModelRouteEditView'

type Tab = 'catalog' | 'routing'

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

  const tab: Tab = params.tab === 'routing' ? 'routing' : 'catalog'

  return (
    <YStack gap="$3">
      <XStack gap="$1.5">
        <TabButton active={tab === 'catalog'} label="Catalog" Icon={Library} onPress={() => router.push('/models')} />
        <TabButton active={tab === 'routing'} label="Routing" Icon={Waypoints} onPress={() => router.push('/models/routing')} />
      </XStack>

      {tab === 'catalog' ? (
        <ModelCatalogModule params={params} />
      ) : (
        <ModelRouteListView
          onOpen={(r) => router.push(`/models/routing/${encodeURIComponent(r.modelName ?? '')}`)}
          onNew={() => router.push('/models/routing/new')}
        />
      )}
    </YStack>
  )
}
