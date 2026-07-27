'use client'

/**
 * GPU tab bar — the ONE source of truth for the GPU product's sub-tabs, shared by
 * BOTH the admin fleet view (`AdminGpus`) and the customer view (`CustomerGpus`), so
 * the two role branches can never drift on the tab set, order, labels, or routes.
 *
 * `GPU_TABS` is the ordered tab list (id → registry `:tab` route). `GpuTabBar` is the
 * in-page segmented control: each button `router.push(t.path)`s (real navigation, the
 * thing that was broken for customers), and the active tab is highlighted. `active`
 * is the current `params.tab` (`''` = Overview), resolved by the caller from the route.
 */
import { useRouter } from 'next/navigation'
import { Button, XStack } from '@hanzo/gui'

import { useAccent } from '@hanzo/ui/product'

/** The GPU sub-tabs, in order. `id` matches the registry `:tab` segment; `path` is the
 *  absolute console route the tab navigates to. Overview is the empty `id`. */
export const GPU_TABS = [
  { id: '', label: 'Overview', path: '/gpus' },
  { id: 'gpus', label: 'GPUs', path: '/gpus/gpus' },
  { id: 'queue', label: 'Queue', path: '/gpus/queue' },
  { id: 'clusters', label: 'Clusters', path: '/gpus/clusters' },
  { id: 'pools', label: 'Pools', path: '/gpus/pools' },
  { id: 'pricing', label: 'Pricing', path: '/gpus/pricing' },
  { id: 'alerts', label: 'Alerts', path: '/gpus/alerts' },
  { id: 'settings', label: 'Settings', path: '/gpus/settings' },
] as const

/** Normalize an arbitrary `params.tab` to a known GPU tab id (unknown → Overview). */
export const gpuTabId = (tab?: string): string => (GPU_TABS.some((t) => t.id === tab) ? (tab ?? '') : '')

/**
 * The shared GPU sub-tab bar. Clicking a tab navigates (`router.push`) to its route,
 * so every tab is a real, distinct destination — resolved by the registry to the same
 * `GpusModule`/`GpusOverview` with a different `:tab`. Wraps on narrow viewports.
 */
export function GpuTabBar({ active }: { active: string }) {
  const router = useRouter()
  const { accent, contrast } = useAccent()
  return (
    <XStack gap="$1" flexWrap="wrap">
      {GPU_TABS.map((t) => {
        const isActive = t.id === active
        return (
          <Button
            key={t.id || 'overview'}
            size="$2"
            bg={isActive ? '$color5' : 'transparent'}
            // Custom org accent recolors the ACTIVE tab (Tamagui-native inline bg + text
            // color the label inherits); default monochrome when no accent.
            style={isActive && accent ? { backgroundColor: accent, color: contrast } : undefined}
            borderWidth={1}
            borderColor="$borderColor"
            onPress={() => router.push(t.path)}
          >
            {t.label}
          </Button>
        )
      })}
    </XStack>
  )
}
